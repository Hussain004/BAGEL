/**
 * Log panel (v1.0).
 *
 * Reads `rcl_interfaces/Log` (ROS2) or `rosgraph_msgs/Log` (ROS1) and
 * renders a searchable, filterable, severity-aware log view:
 *   - Severity checkboxes (DEBUG / INFO / WARN / ERROR / FATAL)
 *   - Node-name + full-text search
 *   - Click a row → seek the playhead to that timestamp
 *   - Auto-scroll: the row closest to the playhead is highlighted; when the
 *     user hasn't manually scrolled, the playhead row is brought into view
 *
 * Virtualisation: a hand-rolled windowed list (no `react-virtuoso` dep). At
 * 50 k log entries a fixed 28-pixel row works out to a ~1.4 MB scroll
 * container; we only render the visible band + a small buffer, so React
 * never sees more than ~30 nodes in the tree at once.
 *
 * Why two level encodings: ROS1 uses bit flags (1/2/4/8/16 = DEBUG/INFO/
 * WARN/ERROR/FATAL); ROS2 uses 10/20/30/40/50. We normalise to the ROS2
 * scheme internally so the filter UI doesn't care which bag format produced
 * the log.
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
import { getTopicColor } from '../../../utils/color';
import { nearestMessageIndex } from '../../../utils/messages';

interface LogPanelProps {
  panelId: string;
  topicName: string;
  type: string;
  bagId?: string;
}

type Severity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
const SEVERITY_ORDER: Severity[] = ['DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const SEVERITY_COLORS: Record<Severity, string> = {
  DEBUG: '#94a3b8', // slate
  INFO: '#3b82f6', // blue
  WARN: '#eab308', // amber
  ERROR: '#ef4444', // red
  FATAL: '#a855f7', // violet
};

/**
 * Map a raw level value to a canonical severity.
 *
 * ROS2 spec: 10/20/30/40/50 = DEBUG/INFO/WARN/ERROR/FATAL.
 * ROS1 spec: 1/2/4/8/16 = DEBUG/INFO/WARN/ERROR/FATAL (bit flags).
 *
 * Anything else falls back to DEBUG so the row still renders (and surfaces
 * the unrecognised value to the user via the level badge).
 */
function severityForLevel(level: number): Severity {
  switch (level) {
    case 10:
    case 1:
      return 'DEBUG';
    case 20:
    case 2:
      return 'INFO';
    case 30:
    case 4:
      return 'WARN';
    case 40:
    case 8:
      return 'ERROR';
    case 50:
    case 16:
      return 'FATAL';
    default:
      return 'DEBUG';
  }
}

interface LogEntry {
  /** Bag-local timestamp in ns. */
  timestamp: bigint;
  severity: Severity;
  node: string;
  msg: string;
  file?: string;
  function?: string;
  line?: number;
}

function decodeLogs(messages: readonly DecodedMessage[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (const m of messages) {
    const v = m.value as
      | {
          level?: number;
          name?: string;
          msg?: string;
          file?: string;
          function?: string;
          line?: number;
        }
      | null;
    if (!v) continue;
    const level = Number(v.level ?? 0);
    out.push({
      timestamp: m.timestamp,
      severity: severityForLevel(level),
      node: String(v.name ?? ''),
      msg: String(v.msg ?? ''),
      file: typeof v.file === 'string' ? v.file : undefined,
      function: typeof v.function === 'string' ? v.function : undefined,
      line: typeof v.line === 'number' ? v.line : undefined,
    });
  }
  return out;
}

const ROW_HEIGHT = 28;
const RENDER_BUFFER = 6;
const MAX_RENDERED_ROWS = 5000; // hard cap on filter+match result count

export function Log({ panelId, topicName, type, bagId }: LogPanelProps) {
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

  const allLogs = useMemo(() => decodeLogs(messages ?? []), [messages]);

  // Filter UI
  const [hiddenSeverities, setHiddenSeverities] = useState<Set<Severity>>(new Set());
  const [search, setSearch] = useState('');
  const [nodeFilter, setNodeFilter] = useState('');
  const [autoFollow, setAutoFollow] = useState(true);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const nq = nodeFilter.trim().toLowerCase();
    const out: LogEntry[] = [];
    for (const e of allLogs) {
      if (hiddenSeverities.has(e.severity)) continue;
      if (nq && !e.node.toLowerCase().includes(nq)) continue;
      if (q && !e.msg.toLowerCase().includes(q) && !e.node.toLowerCase().includes(q))
        continue;
      out.push(e);
      if (out.length >= MAX_RENDERED_ROWS) break;
    }
    return out;
  }, [allLogs, hiddenSeverities, search, nodeFilter]);

  // Find the filtered-list index closest to the playhead — anchors auto-scroll
  // and the highlighted row indicator.
  const playheadIdx = useMemo(() => {
    if (filteredLogs.length === 0) return -1;
    // nearestMessageIndex expects { timestamp: bigint }, so use a tiny adapter.
    const arr = filteredLogs.map((e) => ({ timestamp: e.timestamp }));
    return nearestMessageIndex(
      arr as unknown as Parameters<typeof nearestMessageIndex>[0],
      playheadBagLocalNs,
    );
  }, [filteredLogs, playheadBagLocalNs]);

  // Unique node list for the node-filter suggestion text. We don't render
  // them as a dropdown to keep the bar simple; users type to narrow.
  const uniqueNodes = useMemo(() => {
    const s = new Set<string>();
    for (const e of allLogs) {
      if (e.node) s.add(e.node);
      if (s.size > 50) break;
    }
    return s.size;
  }, [allLogs]);

  // Scroll container + viewport tracking for windowed rendering.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(400);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const resize = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    resize.observe(el);
    setViewportHeight(el.clientHeight);
    return () => resize.disconnect();
  }, []);

  // Auto-follow: scroll the playhead row into view as the playhead advances,
  // but only when the user hasn't recently scrolled manually. A scroll event
  // toggles autoFollow off; the user re-enables it via the checkbox.
  const lastAutoScrollRef = useRef(0);
  useEffect(() => {
    if (!autoFollow) return;
    if (playheadIdx < 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const target = playheadIdx * ROW_HEIGHT - viewportHeight / 2 + ROW_HEIGHT / 2;
    const clamped = Math.max(
      0,
      Math.min(
        filteredLogs.length * ROW_HEIGHT - viewportHeight,
        Math.floor(target),
      ),
    );
    lastAutoScrollRef.current = clamped;
    el.scrollTop = clamped;
  }, [autoFollow, playheadIdx, viewportHeight, filteredLogs.length]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const next = el.scrollTop;
    // Disable auto-follow when the user scrolls a meaningful amount away
    // from the last programmatic position. Without this guard, the auto-
    // follow effect would fight the user's manual gesture.
    if (Math.abs(next - lastAutoScrollRef.current) > 8 && autoFollow) {
      setAutoFollow(false);
    }
    setScrollTop(next);
  }, [autoFollow]);

  // Compute the rendered slice.
  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - RENDER_BUFFER);
  const visibleCount = Math.ceil(viewportHeight / ROW_HEIGHT) + RENDER_BUFFER * 2;
  const endIdx = Math.min(filteredLogs.length, startIdx + visibleCount);
  const renderedRows = filteredLogs.slice(startIdx, endIdx);

  return (
    <PanelShell
      panelId={panelId}
      kind="log"
      topicName={topicName}
      type={type}
      accentColor={getTopicColor(topicName, type)}
      bagId={bagId}
    >
      {error && !messages && <ErrorState message={error} />}
      {loading && !messages && <Loading progress={progress} />}
      {messages && messages.length === 0 && !loading && (
        <EmptyState message="No log messages on this topic." />
      )}
      {messages && messages.length > 0 && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Filter bar */}
          <FilterBar
            hiddenSeverities={hiddenSeverities}
            onToggleSeverity={(s) =>
              setHiddenSeverities((curr) => {
                const next = new Set(curr);
                if (next.has(s)) next.delete(s);
                else next.add(s);
                return next;
              })
            }
            search={search}
            onSearch={setSearch}
            nodeFilter={nodeFilter}
            onNodeFilter={setNodeFilter}
            autoFollow={autoFollow}
            onToggleAutoFollow={() => setAutoFollow((v) => !v)}
            uniqueNodeCount={uniqueNodes}
            total={allLogs.length}
            shown={filteredLogs.length}
          />

          {/* Virtualised log list */}
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="flex-1 min-h-0 overflow-y-auto bg-bg-secondary/40"
            role="list"
            aria-label="Log entries"
          >
            <div
              style={{
                height: filteredLogs.length * ROW_HEIGHT,
                position: 'relative',
              }}
            >
              {renderedRows.map((entry, i) => {
                const idx = startIdx + i;
                return (
                  <LogRow
                    key={idx}
                    entry={entry}
                    top={idx * ROW_HEIGHT}
                    isPlayhead={idx === playheadIdx}
                    onClick={() => {
                      if (!bag) return;
                      const aligned = entryToAligned(entry, bagId);
                      seek(aligned);
                    }}
                    bagStartNs={bag?.startTime ?? 0n}
                    searchTerm={search.trim()}
                  />
                );
              })}
              {filteredLogs.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-text-muted text-xs mono">
                  No log entries match the current filter.
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 py-1.5 border-t border-border flex items-center justify-between text-text-muted text-xs mono">
            <span>
              {filteredLogs.length === allLogs.length
                ? `${filteredLogs.length.toLocaleString()} entries`
                : `${filteredLogs.length.toLocaleString()} of ${allLogs.length.toLocaleString()} entries`}
              {filteredLogs.length >= MAX_RENDERED_ROWS && (
                <span className="ml-2 text-accent-amber">
                  (capped at {MAX_RENDERED_ROWS.toLocaleString()} — narrow your filter to see more)
                </span>
              )}
            </span>
            {playheadIdx >= 0 && bag && filteredLogs[playheadIdx] && (
              <span>
                t ={' '}
                {nsToSeconds(
                  filteredLogs[playheadIdx].timestamp - bag.startTime,
                ).toFixed(3)}
                s
              </span>
            )}
          </div>
        </div>
      )}
    </PanelShell>
  );
}

/** Translate a log entry's bag-local timestamp into aligned-time for the playhead. */
function entryToAligned(entry: LogEntry, bagId: string | undefined): bigint {
  const state = useBagStore.getState();
  const bagEntry = resolveBagEntry(state, bagId);
  if (!bagEntry) return entry.timestamp;
  return alignedTimeFor(bagEntry, entry.timestamp, state.alignment);
}

interface FilterBarProps {
  hiddenSeverities: Set<Severity>;
  onToggleSeverity: (s: Severity) => void;
  search: string;
  onSearch: (s: string) => void;
  nodeFilter: string;
  onNodeFilter: (s: string) => void;
  autoFollow: boolean;
  onToggleAutoFollow: () => void;
  uniqueNodeCount: number;
  total: number;
  shown: number;
}
function FilterBar({
  hiddenSeverities,
  onToggleSeverity,
  search,
  onSearch,
  nodeFilter,
  onNodeFilter,
  autoFollow,
  onToggleAutoFollow,
  uniqueNodeCount,
}: FilterBarProps) {
  return (
    <div className="px-4 py-2 border-b border-border flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1 text-xs">
        {SEVERITY_ORDER.map((s) => {
          const hidden = hiddenSeverities.has(s);
          return (
            <button
              key={s}
              onClick={() => onToggleSeverity(s)}
              className={`flex items-center gap-1 px-1.5 py-1 rounded-md border mono transition-all ${
                hidden
                  ? 'border-border text-text-muted bg-transparent line-through opacity-60'
                  : 'border-border-hover text-text-primary bg-surface'
              }`}
              title={`${hidden ? 'Show' : 'Hide'} ${s} entries`}
              aria-pressed={!hidden}
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: SEVERITY_COLORS[s] }}
              />
              <span>{s}</span>
            </button>
          );
        })}
      </div>
      <input
        type="text"
        value={nodeFilter}
        onChange={(e) => onNodeFilter(e.target.value)}
        placeholder={`Node filter (${uniqueNodeCount}+ nodes)`}
        className="w-[180px] px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary placeholder:text-text-muted text-xs mono focus:outline-none focus:border-accent-blue/50 focus:ring-1 focus:ring-accent-blue/20 transition-all"
        aria-label="Filter logs by node name"
      />
      <input
        type="text"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search message text…"
        className="flex-1 min-w-[140px] px-3 py-1.5 rounded-md bg-surface border border-border text-text-primary placeholder:text-text-muted text-xs mono focus:outline-none focus:border-accent-blue/50 focus:ring-1 focus:ring-accent-blue/20 transition-all"
        aria-label="Search log messages"
      />
      <button
        onClick={onToggleAutoFollow}
        className={`px-2 py-1 rounded-md text-[10px] mono border transition-all ${
          autoFollow
            ? 'bg-accent-blue/15 border-accent-blue/40 text-accent-blue'
            : 'bg-surface border-border text-text-muted hover:text-text-primary'
        }`}
        title={
          autoFollow
            ? 'Stop following the playhead (manual scroll re-enabled).'
            : 'Follow the playhead — auto-scroll so the current row stays in view.'
        }
        aria-pressed={autoFollow}
      >
        {autoFollow ? 'Following' : 'Follow'}
      </button>
    </div>
  );
}

interface LogRowProps {
  entry: LogEntry;
  top: number;
  isPlayhead: boolean;
  bagStartNs: bigint;
  searchTerm: string;
  onClick: () => void;
}
function LogRow({ entry, top, isPlayhead, bagStartNs, searchTerm, onClick }: LogRowProps) {
  return (
    <div
      role="listitem"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      title={
        entry.file
          ? `${entry.file}:${entry.line} (${entry.function})`
          : entry.function
      }
      className={`absolute left-0 right-0 flex items-center gap-2 px-3 mono text-xs cursor-pointer border-b border-border/40 transition-colors ${
        isPlayhead ? 'bg-accent-blue/10' : 'hover:bg-surface-hover'
      }`}
      style={{ top, height: ROW_HEIGHT }}
    >
      <span
        className="w-1 h-4 rounded-sm flex-shrink-0"
        style={{ backgroundColor: SEVERITY_COLORS[entry.severity] }}
      />
      <span
        className="text-[10px] mono w-12 flex-shrink-0"
        style={{ color: SEVERITY_COLORS[entry.severity] }}
      >
        {entry.severity}
      </span>
      <span className="text-text-muted tabular-nums flex-shrink-0 w-16 text-right">
        {nsToSeconds(entry.timestamp - bagStartNs).toFixed(2)}s
      </span>
      <span
        className="text-text-secondary truncate flex-shrink-0 max-w-[160px]"
        title={entry.node}
      >
        {entry.node}
      </span>
      <span className="text-text-primary truncate flex-1 min-w-0">
        {searchTerm ? highlight(entry.msg, searchTerm) : entry.msg}
      </span>
    </div>
  );
}

/** Render a string with `term` highlighted. Returns an array of React nodes. */
function highlight(text: string, term: string): React.ReactNode[] {
  if (!term) return [text];
  const tLower = term.toLowerCase();
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = text.toLowerCase().indexOf(tLower, i);
    if (hit < 0) {
      out.push(text.slice(i));
      break;
    }
    if (hit > i) out.push(text.slice(i, hit));
    out.push(
      <mark
        key={hit}
        className="bg-accent-amber/30 text-text-primary px-0.5 rounded-sm"
      >
        {text.slice(hit, hit + term.length)}
      </mark>,
    );
    i = hit + term.length;
  }
  return out;
}

function Loading({ progress }: { progress: number }) {
  return (
    <div className="flex-1 flex items-center justify-center text-text-secondary text-sm p-8">
      Loading logs… ({progress.toLocaleString()} entries decoded)
    </div>
  );
}
function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="text-accent-rose text-sm font-medium">
        Failed to load logs
      </div>
      <div className="text-text-secondary text-xs max-w-md">{message}</div>
    </div>
  );
}
function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-text-muted text-sm p-8">
      {message}
    </div>
  );
}
