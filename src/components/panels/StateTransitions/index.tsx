/**
 * State transitions panel.
 *
 * One lane per chosen scalar field, drawn as coloured runs of constant value
 * with the value written on each run: a nav goal's status, a control mode, an
 * e-stop bool, a behaviour-tree node name. Click a run to seek to the moment
 * the state began.
 *
 * Data path mirrors the DiagnosticArray panel: the whole topic through
 * `useTopicMessages` (state topics are low-rate), run-length encoded by the
 * pure `buildSegments`, drawn on a canvas so a flapping signal with thousands
 * of changes stays cheap.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { alignedTimeFor, resolveBagEntry, useBagStore } from '../../../store/bagStore';
import { useBagLocalPlayhead } from '../../../hooks/useBagLocalPlayhead';
import { useTopicMessages } from '../../../hooks/useTopicMessages';
import { usePlayheadStore } from '../../../store/playheadStore';
import { useThemeStore } from '../../../store/themeStore';
import {
  DEFAULT_STATE_SETTINGS,
  useStatePanelStore,
} from '../../../store/panelUiStores';
import {
  buildSegments,
  defaultStateFields,
  readScalar,
  scalarFieldPaths,
  segmentIndexAt,
  stateColor,
  stateLabel,
  transitionCount,
  type Scalar,
  type Segment,
} from '../../../utils/stateSegments';
import { getTopicColor } from '../../../utils/color';
import { PanelShell } from '../PanelShell';
import { PanelEmptyState, PanelErrorState, PanelLoadingState } from '../shared/PanelStates';

interface Props {
  panelId: string;
  topicName: string;
  type: string;
  bagId?: string;
}

/** State topics are low-rate; this is far beyond any real one and bounds a runaway. */
const MESSAGE_LIMIT = 50_000;
const LANE_H = 38;
const LANE_GAP = 8;
const LABEL_W = 150;
const RIGHT_PAD = 8;
const MAX_CHIPS = 24;

interface Lane {
  field: string;
  segments: Segment[];
}

interface Hover {
  lane: number;
  index: number;
  x: number;
  y: number;
}

export function StateTransitions({ panelId, topicName, type, bagId }: Props) {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const bag = entry?.summary ?? null;
  const { messages, loading, progress, error } = useTopicMessages(topicName, MESSAGE_LIMIT, true, bagId);
  const settings = useStatePanelStore((s) => s.byId[panelId]) ?? DEFAULT_STATE_SETTINGS;
  const updateSettings = useStatePanelStore((s) => s.update);
  const playheadNs = useBagLocalPlayhead(bagId);
  const seek = usePlayheadStore((s) => s.seek);
  const theme = useThemeStore((s) => s.theme);

  const startNs = bag?.startTime ?? 0n;
  const durationSec = bag ? Number(bag.endTime - bag.startTime) / 1e9 : 0;

  // Fields come from the first message that has any, since one topic has one schema.
  const available = useMemo(() => {
    for (const m of messages ?? []) {
      const paths = scalarFieldPaths(m.value);
      if (paths.length > 0) {
        // header.* last: constant frame ids and stamps are rarely the point.
        return [...paths.filter((p) => !p.startsWith('header.')), ...paths.filter((p) => p.startsWith('header.'))];
      }
    }
    return [];
  }, [messages]);

  const selected = useMemo(() => {
    const chosen = settings.fields ?? defaultStateFields(available);
    return chosen.filter((f) => available.includes(f));
  }, [settings.fields, available]);

  const lanes = useMemo<Lane[]>(() => {
    if (!messages || messages.length === 0) return [];
    const times = messages.map((m) => Number(m.timestamp - startNs) / 1e9);
    return selected.map((field) => ({
      field,
      segments: buildSegments(
        times,
        messages.map((m) => readScalar(m.value, field)),
        durationSec,
      ),
    }));
  }, [messages, selected, startNs, durationSec]);

  const playheadSec = Number(playheadNs - startNs) / 1e9;
  const currentValues = useMemo(
    () =>
      lanes.map((l) => {
        const i = segmentIndexAt(l.segments, playheadSec);
        return i >= 0 ? l.segments[i]!.value : null;
      }),
    [lanes, playheadSec],
  );

  const toggleField = (field: string) => {
    const next = selected.includes(field) ? selected.filter((f) => f !== field) : [...selected, field];
    updateSettings(panelId, { fields: next });
  };

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<Hover | null>(null);
  const drawH = Math.max(LANE_H, lanes.length * (LANE_H + LANE_GAP));

  // The wrapper only exists once there is something to draw, so re-measure then.
  const hasLanes = lanes.length > 0;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.max(120, el.clientWidth));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [hasLanes]);

  const plotW = Math.max(20, width - LABEL_W - RIGHT_PAD);
  const xOf = useCallback((sec: number) => LABEL_W + (durationSec > 0 ? (sec / durationSec) * plotW : 0), [durationSec, plotW]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || lanes.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(drawH * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, drawH);

    // Theme tokens the canvas cannot get from Tailwind classes; `theme` is in
    // the deps so a flip re-reads them.
    const root = getComputedStyle(document.documentElement);
    const laneFill = root.getPropertyValue('--color-overlay').trim() || 'rgba(255,255,255,0.03)';
    const textPrimary = root.getPropertyValue('--color-text-primary').trim() || '#f1f5f9';
    const textMuted = root.getPropertyValue('--color-text-muted').trim() || '#94a3b8';
    const mono = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

    lanes.forEach((lane, row) => {
      const y = row * (LANE_H + LANE_GAP);
      ctx.fillStyle = laneFill;
      ctx.fillRect(LABEL_W, y, plotW, LANE_H);

      ctx.textBaseline = 'middle';
      ctx.font = `11px ${mono}`;
      ctx.fillStyle = textMuted;
      const name = lane.field.length > 22 ? `…${lane.field.slice(-21)}` : lane.field;
      ctx.fillText(name, 4, y + LANE_H / 2 - 7);
      ctx.font = `600 12px ${mono}`;
      ctx.fillStyle = textPrimary;
      const cur = stateLabel(currentValues[row] ?? null);
      ctx.fillText(cur.length > 20 ? `${cur.slice(0, 19)}…` : cur, 4, y + LANE_H / 2 + 8);

      ctx.font = `11px ${mono}`;
      for (const seg of lane.segments) {
        const x0 = xOf(seg.start);
        const w = Math.max(1, xOf(seg.end) - x0);
        ctx.fillStyle = stateColor(seg.value);
        ctx.globalAlpha = 0.85;
        ctx.fillRect(x0, y + 2, w, LANE_H - 4);
        ctx.globalAlpha = 1;
        // Write the value on a run only if it fits; a 1px sliver gets no label.
        const label = stateLabel(seg.value);
        if (w > 14) {
          const fit = Math.floor((w - 8) / 6.6);
          if (fit >= 2) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x0, y, w, LANE_H);
            ctx.clip();
            ctx.fillStyle = '#0b0f19';
            ctx.fillText(label.length > fit ? `${label.slice(0, fit - 1)}…` : label, x0 + 4, y + LANE_H / 2);
            ctx.restore();
          }
        }
      }
    });

    // Playhead last so it sits above every lane.
    if (playheadSec >= 0 && playheadSec <= durationSec) {
      ctx.fillStyle = 'rgba(59, 130, 246, 0.9)';
      ctx.fillRect(xOf(playheadSec) - 0.5, 0, 1.5, drawH);
    }
  }, [lanes, width, drawH, plotW, durationSec, playheadSec, currentValues, theme, xOf]);

  const secAtClientX = (clientX: number): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const x = clientX - canvas.getBoundingClientRect().left;
    if (x < LABEL_W || x > LABEL_W + plotW) return null;
    return ((x - LABEL_W) / plotW) * durationSec;
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const sec = secAtClientX(e.clientX);
    if (sec === null || !entry) return;
    const row = Math.floor((e.clientY - e.currentTarget.getBoundingClientRect().top) / (LANE_H + LANE_GAP));
    const lane = lanes[row];
    // Clicking a run seeks to where that state BEGAN: "when did it go to X".
    const idx = lane ? segmentIndexAt(lane.segments, sec) : -1;
    const targetSec = idx >= 0 ? lane!.segments[idx]!.start : sec;
    const local = startNs + BigInt(Math.round(targetSec * 1e9));
    seek(alignedTimeFor(entry, local, useBagStore.getState().alignment));
  };

  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const sec = secAtClientX(e.clientX);
    const rect = e.currentTarget.getBoundingClientRect();
    const row = Math.floor((e.clientY - rect.top) / (LANE_H + LANE_GAP));
    const lane = lanes[row];
    const idx = sec !== null && lane ? segmentIndexAt(lane.segments, sec) : -1;
    if (!lane || idx < 0) {
      if (hover) setHover(null);
      return;
    }
    if (!hover || hover.lane !== row || hover.index !== idx) {
      setHover({ lane: row, index: idx, x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  };

  const hoveredSeg = hover ? lanes[hover.lane]?.segments[hover.index] : null;
  const totalChanges = lanes.reduce((n, l) => n + transitionCount(l.segments), 0);

  return (
    <PanelShell
      panelId={panelId}
      kind="state"
      topicName={topicName}
      type={type}
      accentColor={getTopicColor(topicName, type)}
      bagId={bagId}
    >
      {loading && !messages && <PanelLoadingState message={`Decoded ${progress.toLocaleString()} messages…`} />}
      {error && <PanelErrorState title="Failed to load messages" message={error} schemaTarget={{ typeName: type, topicName, panelKind: 'state', bagId }} />}
      {!loading && !error && (!messages || messages.length === 0) && (
        <PanelEmptyState message="No messages on this topic." />
      )}
      {!loading && !error && messages && messages.length > 0 && available.length === 0 && (
        <PanelEmptyState message="No scalar fields (string, boolean, or number) in this message type." />
      )}
      {messages && available.length > 0 && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-border flex flex-wrap gap-1.5 max-h-20 overflow-y-auto flex-shrink-0">
            {available.slice(0, MAX_CHIPS).map((f) => {
              const on = selected.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => toggleField(f)}
                  aria-pressed={on}
                  className={`px-2 py-0.5 rounded-md text-xs mono border transition-colors ${
                    on
                      ? 'bg-surface border-border text-text-primary'
                      : 'bg-transparent border-transparent text-text-muted hover:border-border-hover'
                  }`}
                >
                  {f}
                </button>
              );
            })}
            {available.length > MAX_CHIPS && (
              <span className="px-1 py-0.5 text-xs text-text-muted">+{available.length - MAX_CHIPS} more</span>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto p-2">
            {lanes.length === 0 ? (
              <PanelEmptyState message="Pick a field above to draw its states." />
            ) : (
              <div ref={wrapRef} className="w-full relative">
                <canvas
                  ref={canvasRef}
                  style={{ width, height: drawH, display: 'block', cursor: 'pointer' }}
                  onClick={onClick}
                  onMouseMove={onMove}
                  onMouseLeave={() => setHover(null)}
                  role="img"
                  aria-label={`State timeline for ${lanes.map((l) => l.field).join(', ')}. Click a state to seek to when it began.`}
                  data-testid="state-canvas"
                />
                {hover && hoveredSeg && (
                  <div
                    className="pointer-events-none absolute z-10 bg-bg-primary border border-border rounded-md px-2 py-1 text-xs mono shadow-lg whitespace-nowrap"
                    style={{ left: Math.min(hover.x + 12, width - 180), top: hover.y + 14 }}
                    data-testid="state-tooltip"
                  >
                    <span style={{ color: stateColor(hoveredSeg.value) }}>{stateLabel(hoveredSeg.value)}</span>
                    <span className="text-text-muted">
                      {' '}
                      {hoveredSeg.start.toFixed(2)}s to {hoveredSeg.end.toFixed(2)}s ({(hoveredSeg.end - hoveredSeg.start).toFixed(2)}s,{' '}
                      {hoveredSeg.count} msg{hoveredSeg.count === 1 ? '' : 's'})
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          <table className="sr-only">
            <caption>State summary for {topicName}</caption>
            <thead>
              <tr><th>Field</th><th>Changes</th><th>Current</th></tr>
            </thead>
            <tbody>
              {lanes.map((l, i) => (
                <tr key={l.field}>
                  <td>{l.field}</td>
                  <td>{transitionCount(l.segments)}</td>
                  <td>{stateLabel((currentValues[i] ?? null) as Scalar | null)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="px-4 py-1.5 border-t border-border text-text-muted text-xs mono flex items-center justify-between flex-shrink-0">
            <span>
              {messages.length.toLocaleString()} msgs
              {bag && bag.topics.find((t) => t.name === topicName)!.messageCount > messages.length && (
                <span className="text-accent-amber ml-2">(first {MESSAGE_LIMIT.toLocaleString()})</span>
              )}
            </span>
            <span>{totalChanges.toLocaleString()} state change{totalChanges === 1 ? '' : 's'}</span>
          </div>
        </div>
      )}
    </PanelShell>
  );
}
