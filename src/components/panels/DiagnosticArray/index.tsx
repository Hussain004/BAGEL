/**
 * DiagnosticArray panel (v1.0).
 *
 * Renders `diagnostic_msgs/DiagnosticArray` as:
 *   - Top half: swimlane canvas. One row per (hardware_id, name) component.
 *     Each row is coloured by status across time (OK=green, WARN=yellow,
 *     ERROR=red, STALE=grey). The playhead is a vertical line.
 *   - Bottom half: at-playhead inspector. Every component with non-OK
 *     status, showing its `message` field + KeyValue pairs.
 *
 * Filters: status checkboxes (hide OK / hide WARN / ...) and a per-component
 * name search.
 *
 * Data path: `useTopicMessages` for the full history (DiagnosticArray is
 * persistent — we need every status report to draw the swimlane). Per-message
 * cost is small (each frame has ~10s of statuses, not 100k points), so the
 * memory cost is bounded.
 *
 * Schema reference (both ROS1 and ROS2):
 *   diagnostic_msgs/DiagnosticArray
 *     Header header
 *     DiagnosticStatus[] status
 *       byte level           // 0=OK, 1=WARN, 2=ERROR, 3=STALE
 *       string name
 *       string message
 *       string hardware_id
 *       KeyValue[] values
 */

import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import {
  useBagStore,
  resolveBagEntry,
  alignedTimeFor,
} from '../../../store/bagStore';
import { useBagLocalPlayhead } from '../../../hooks/useBagLocalPlayhead';
import {
  useTopicMessages,
  type DecodedMessage,
} from '../../../hooks/useTopicMessages';
import { usePlayheadStore } from '../../../store/playheadStore';
import { nsToSeconds } from '../../../utils/time';
import { PanelShell } from '../PanelShell';
import { PanelLoadingState, PanelErrorState, PanelEmptyState } from '../shared/PanelStates';
import { getTopicColor } from '../../../utils/color';
import { nearestMessageIndex } from '../../../utils/messages';

interface DiagnosticArrayPanelProps {
  panelId: string;
  topicName: string;
  type: string;
  bagId?: string;
}

interface DiagnosticStatus {
  level: number;
  name: string;
  message: string;
  hardware_id: string;
  values: Array<{ key: string; value: string }>;
}

const LEVELS = [0, 1, 2, 3] as const;
type Level = (typeof LEVELS)[number];
const LEVEL_NAMES: Record<Level, string> = {
  0: 'OK',
  1: 'WARN',
  2: 'ERROR',
  3: 'STALE',
};
const LEVEL_COLORS: Record<Level, string> = {
  0: '#10b981', // emerald — OK
  1: '#eab308', // amber — WARN
  2: '#ef4444', // red — ERROR
  3: '#94a3b8', // slate — STALE
};

interface ComponentTrack {
  key: string;
  hardwareId: string;
  name: string;
  /** Per-message level at the index of `messages` where this component was reported. */
  events: Array<{ msgIndex: number; level: Level }>;
}

/**
 * Build per-component event tracks from a stream of DiagnosticArray messages.
 * Component key = `${hardware_id}::${name}` — the canonical identity per the
 * diagnostic_msgs spec.
 */
function buildTracks(
  messages: readonly DecodedMessage[],
): { tracks: ComponentTrack[]; statusByMsg: Array<DiagnosticStatus[]> } {
  const tracks = new Map<string, ComponentTrack>();
  const statusByMsg: Array<DiagnosticStatus[]> = [];
  for (let i = 0; i < messages.length; i++) {
    const value = messages[i].value as { status?: DiagnosticStatus[] } | null;
    const statuses = (value?.status ?? []).filter(
      (s): s is DiagnosticStatus =>
        !!s && typeof s.level === 'number' && typeof s.name === 'string',
    );
    statusByMsg.push(statuses);
    for (const status of statuses) {
      const hwId = status.hardware_id ?? '';
      const key = `${hwId}::${status.name}`;
      let track = tracks.get(key);
      if (!track) {
        track = { key, hardwareId: hwId, name: status.name, events: [] };
        tracks.set(key, track);
      }
      const level = (
        status.level >= 0 && status.level <= 3 ? status.level : 3
      ) as Level;
      track.events.push({ msgIndex: i, level });
    }
  }
  // Sort tracks alphabetically by name for stable presentation.
  const sorted = Array.from(tracks.values()).sort((a, b) => {
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.hardwareId.localeCompare(b.hardwareId);
  });
  return { tracks: sorted, statusByMsg };
}

/**
 * Binary-search a track's events for the last event with `msgIndex <=
 * targetIdx`. Returns null when none exist (component hadn't reported yet).
 */
function lastEventAt(track: ComponentTrack, targetIdx: number): Level | null {
  const events = track.events;
  if (events.length === 0 || events[0].msgIndex > targetIdx) return null;
  let lo = 0;
  let hi = events.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (events[mid].msgIndex <= targetIdx) lo = mid;
    else hi = mid - 1;
  }
  return events[lo].level;
}

const ROW_HEIGHT = 22;
const ROW_GAP = 2;

export function DiagnosticArray({
  panelId,
  topicName,
  type,
  bagId,
}: DiagnosticArrayPanelProps) {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const bag = entry?.summary ?? null;
  const playheadBagLocalNs = useBagLocalPlayhead(bagId);
  const { messages, loading, error, progress } = useTopicMessages(
    topicName,
    undefined,
    true,
    bagId,
  );
  const seek = usePlayheadStore((s) => s.seek);

  // Filter state
  const [hiddenLevels, setHiddenLevels] = useState<Set<Level>>(new Set());
  const [search, setSearch] = useState('');

  const { tracks, statusByMsg } = useMemo(
    () => buildTracks(messages ?? []),
    [messages],
  );

  // Filtered tracks (name search). Status filter is applied at render time
  // so the user can re-enable a hidden level without re-running buildTracks.
  const filteredTracks = useMemo(() => {
    if (!search.trim()) return tracks;
    const q = search.toLowerCase();
    return tracks.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.hardwareId.toLowerCase().includes(q),
    );
  }, [tracks, search]);

  // Find the message index nearest the playhead — anchors the swimlane
  // playhead line + the inspector list.
  const currentMsgIdx = useMemo(() => {
    if (!messages || messages.length === 0) return -1;
    return nearestMessageIndex(messages, playheadBagLocalNs);
  }, [messages, playheadBagLocalNs]);

  return (
    <PanelShell
      panelId={panelId}
      kind="diagnostic"
      topicName={topicName}
      type={type}
      accentColor={getTopicColor(topicName, type)}
      bagId={bagId}
    >
      {error && !messages && (
        <PanelErrorState
          title="Failed to load diagnostics"
          message={error}
          schemaTarget={{ typeName: type, topicName, panelKind: 'diagnostic', bagId }}
        />
      )}
      {loading && !messages && (
        <PanelLoadingState message={`Loading diagnostics… (${progress} reports decoded)`} />
      )}
      {messages && messages.length === 0 && !loading && (
        <PanelEmptyState message="This topic has no messages." />
      )}
      {messages && messages.length > 0 && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Filter bar */}
          <FilterBar
            hiddenLevels={hiddenLevels}
            onToggleLevel={(l) =>
              setHiddenLevels((s) => {
                const next = new Set(s);
                if (next.has(l)) next.delete(l);
                else next.add(l);
                return next;
              })
            }
            search={search}
            onSearch={setSearch}
            componentCount={filteredTracks.length}
            totalComponents={tracks.length}
          />

          {/* Swimlane timeline (top half) */}
          <div className="flex-1 min-h-0 overflow-hidden">
            <Swimlane
              tracks={filteredTracks}
              messages={messages}
              hiddenLevels={hiddenLevels}
              startNs={bag?.startTime ?? 0n}
              endNs={bag?.endTime ?? 0n}
              currentMsgIdx={currentMsgIdx}
              onSeek={(bagLocalNs) => {
                if (!entry) return;
                // Translate bag-local back to aligned so the global playhead
                // lands at the right cell across every bag's view.
                const aligned = alignedTimeFor(
                  entry,
                  bagLocalNs,
                  useBagStore.getState().alignment,
                );
                seek(aligned);
              }}
            />
          </div>

          {/* Inspector (bottom half) */}
          <div className="border-t border-border flex-1 min-h-0 overflow-y-auto">
            <Inspector
              tracks={filteredTracks}
              statusByMsg={statusByMsg}
              currentMsgIdx={currentMsgIdx}
              hiddenLevels={hiddenLevels}
            />
          </div>

          {/* Footer */}
          <div className="px-4 py-1.5 border-t border-border flex items-center justify-between text-text-muted text-xs mono">
            <span>
              {tracks.length} component{tracks.length === 1 ? '' : 's'} ·{' '}
              {messages.length} reports
            </span>
            {currentMsgIdx >= 0 && bag && (
              <span>
                t ={' '}
                {nsToSeconds(messages[currentMsgIdx].timestamp - bag.startTime).toFixed(
                  3,
                )}
                s
              </span>
            )}
          </div>
        </div>
      )}
    </PanelShell>
  );
}

interface FilterBarProps {
  hiddenLevels: Set<Level>;
  onToggleLevel: (level: Level) => void;
  search: string;
  onSearch: (s: string) => void;
  componentCount: number;
  totalComponents: number;
}
function FilterBar({
  hiddenLevels,
  onToggleLevel,
  search,
  onSearch,
  componentCount,
  totalComponents,
}: FilterBarProps) {
  return (
    <div className="px-4 py-2 border-b border-border flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 text-xs">
        {LEVELS.map((level) => {
          const hidden = hiddenLevels.has(level);
          return (
            <button
              key={level}
              onClick={() => onToggleLevel(level)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md border mono transition-[background-color,border-color,color,opacity] ${
                hidden
                  ? 'border-border text-text-muted bg-transparent line-through opacity-60'
                  : 'border-border-hover text-text-primary bg-surface'
              }`}
              title={`${hidden ? 'Show' : 'Hide'} ${LEVEL_NAMES[level]} entries`}
              aria-pressed={!hidden}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: LEVEL_COLORS[level] }}
              />
              <span>{LEVEL_NAMES[level]}</span>
            </button>
          );
        })}
      </div>
      <div className="flex-1 min-w-[180px] relative">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Filter by component name or hardware id…"
          className="w-full px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary placeholder:text-text-muted text-xs mono focus:outline-none focus:border-accent-blue/50 focus:ring-1 focus:ring-accent-blue/20 transition-colors"
          aria-label="Filter components"
        />
      </div>
      <span className="text-text-muted text-xs mono flex-shrink-0">
        {componentCount === totalComponents
          ? `${componentCount} components`
          : `${componentCount} / ${totalComponents}`}
      </span>
    </div>
  );
}

interface SwimlaneProps {
  tracks: ComponentTrack[];
  messages: readonly DecodedMessage[];
  hiddenLevels: Set<Level>;
  startNs: bigint;
  endNs: bigint;
  currentMsgIdx: number;
  onSeek: (bagLocalNs: bigint) => void;
}

function Swimlane({
  tracks,
  messages,
  hiddenLevels,
  startNs,
  endNs,
  currentMsgIdx,
  onSeek,
}: SwimlaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 600, h: 200 });

  // Measure container.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(60, r.width), h: Math.max(60, r.height) });
    });
    observer.observe(el);
    const r0 = el.getBoundingClientRect();
    setSize({ w: Math.max(60, r0.width), h: Math.max(60, r0.height) });
    return () => observer.disconnect();
  }, []);

  // Render the swimlane each time size / data / filters change. Canvas
  // rendering keeps it cheap even on 50k-message bags.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(size.w * dpr));
    canvas.height = Math.max(1, Math.floor(size.h * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size.w, size.h);

    if (tracks.length === 0 || messages.length === 0) return;

    const labelW = 180; // width of the left label column
    const plotW = Math.max(20, size.w - labelW - 8);
    const rangeNs = Number(endNs - startNs);
    if (rangeNs <= 0) return;

    // Per-row rendering: walk events left→right, fill spans up to the next event.
    // For the last event, extend to the bag end. Outside hiddenLevels.
    const visibleTracks = tracks.slice(0, Math.floor(size.h / (ROW_HEIGHT + ROW_GAP)));

    for (let row = 0; row < visibleTracks.length; row++) {
      const track = visibleTracks[row];
      const y = row * (ROW_HEIGHT + ROW_GAP);

      // Background lane
      ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.fillRect(labelW, y, plotW, ROW_HEIGHT);

      // Label
      ctx.fillStyle = '#cbd5e1'; // text-secondary
      ctx.font =
        '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
      ctx.textBaseline = 'middle';
      const label = track.hardwareId
        ? `${track.name} · ${track.hardwareId}`
        : track.name;
      const truncated =
        label.length > 24 ? label.slice(0, 22) + '…' : label;
      ctx.fillText(truncated, 4, y + ROW_HEIGHT / 2);

      // Event spans
      const events = track.events;
      for (let i = 0; i < events.length; i++) {
        const level = events[i].level;
        if (hiddenLevels.has(level)) continue;
        const tStart = messages[events[i].msgIndex].timestamp;
        const tEnd =
          i + 1 < events.length
            ? messages[events[i + 1].msgIndex].timestamp
            : endNs;
        const xStart =
          labelW + ((Number(tStart - startNs) / rangeNs) * plotW);
        const xEnd = labelW + ((Number(tEnd - startNs) / rangeNs) * plotW);
        ctx.fillStyle = LEVEL_COLORS[level];
        ctx.fillRect(xStart, y + 2, Math.max(1, xEnd - xStart), ROW_HEIGHT - 4);
      }
    }

    // Playhead vertical line — drawn last so it sits on top of every lane.
    if (currentMsgIdx >= 0) {
      const playheadTs = messages[currentMsgIdx].timestamp;
      const x =
        labelW + ((Number(playheadTs - startNs) / rangeNs) * plotW);
      ctx.fillStyle = 'rgba(59, 130, 246, 0.85)'; // accent-blue
      ctx.fillRect(x - 0.5, 0, 1.5, size.h);
    }
  }, [size, tracks, messages, hiddenLevels, startNs, endNs, currentMsgIdx]);

  // Click-to-seek on the lane area
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const labelW = 180;
      const x = e.clientX - rect.left;
      if (x < labelW) return;
      const plotW = Math.max(20, rect.width - labelW - 8);
      const fraction = (x - labelW) / plotW;
      if (fraction < 0 || fraction > 1) return;
      const rangeNs = Number(endNs - startNs);
      const targetNs = startNs + BigInt(Math.floor(fraction * rangeNs));
      onSeek(targetNs);
    },
    [endNs, startNs, onSeek],
  );

  return (
    <div ref={wrapRef} className="w-full h-full relative">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, display: 'block', cursor: 'pointer' }}
        onClick={onClick}
        aria-label="Diagnostic status timeline — click to seek"
      />
    </div>
  );
}

interface InspectorProps {
  tracks: ComponentTrack[];
  statusByMsg: Array<DiagnosticStatus[]>;
  currentMsgIdx: number;
  hiddenLevels: Set<Level>;
}

function Inspector({
  tracks,
  statusByMsg,
  currentMsgIdx,
  hiddenLevels,
}: InspectorProps) {
  if (currentMsgIdx < 0 || tracks.length === 0) {
    return (
      <div className="p-4 text-text-muted text-xs mono">
        No diagnostic data at the current playhead.
      </div>
    );
  }
  // Resolve the latest status for every visible component as of currentMsgIdx.
  // Walking the per-message statuses is O(N*S); a single playhead tick is
  // cheap enough that we don't precompute — the swimlane already covers
  // visual density.
  const rows: Array<{
    track: ComponentTrack;
    level: Level;
    statusForFrame: DiagnosticStatus | null;
  }> = [];
  for (const track of tracks) {
    const level = lastEventAt(track, currentMsgIdx);
    if (level === null) continue;
    if (hiddenLevels.has(level)) continue;
    // Find the most recent status object emitted for this component up to
    // currentMsgIdx, so we can show its message + values.
    let mostRecent: DiagnosticStatus | null = null;
    for (let i = currentMsgIdx; i >= 0; i--) {
      const statuses = statusByMsg[i];
      const hit = statuses.find(
        (s) =>
          s.name === track.name &&
          (s.hardware_id ?? '') === track.hardwareId,
      );
      if (hit) {
        mostRecent = hit;
        break;
      }
    }
    rows.push({ track, level, statusForFrame: mostRecent });
  }

  // Sort: ERROR first, then WARN, then STALE, then OK. Within a level,
  // alphabetical.
  const levelOrder = (l: Level): number => (l === 2 ? 0 : l === 1 ? 1 : l === 3 ? 2 : 3);
  rows.sort((a, b) => {
    const byLevel = levelOrder(a.level) - levelOrder(b.level);
    if (byLevel !== 0) return byLevel;
    return a.track.name.localeCompare(b.track.name);
  });

  if (rows.length === 0) {
    return (
      <div className="p-4 text-text-muted text-xs mono">
        No components match the current filter at this time.
      </div>
    );
  }

  return (
    <div className="p-2 space-y-1">
      {rows.map(({ track, level, statusForFrame }) => (
        <div
          key={track.key}
          className="rounded-md border border-border bg-surface/40 p-2"
        >
          <div className="flex items-center gap-2 mb-1">
            <span
              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: LEVEL_COLORS[level] }}
            />
            <span className="badge mono" style={{ color: LEVEL_COLORS[level] }}>
              {LEVEL_NAMES[level]}
            </span>
            <span className="mono text-xs text-text-primary truncate">
              {track.name}
            </span>
            {track.hardwareId && (
              <span className="mono text-[10px] text-text-muted truncate">
                · {track.hardwareId}
              </span>
            )}
          </div>
          {statusForFrame?.message && (
            <div className="text-xs text-text-secondary pl-4 mb-1">
              {statusForFrame.message}
            </div>
          )}
          {statusForFrame?.values && statusForFrame.values.length > 0 && (
            <div className="pl-4 space-y-0.5">
              {statusForFrame.values.map((kv, i) => (
                <div
                  key={i}
                  className="flex gap-2 text-[11px] mono text-text-tertiary"
                >
                  <span className="text-text-muted min-w-[120px] truncate">
                    {kv.key}
                  </span>
                  <span className="text-text-secondary truncate">{kv.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
