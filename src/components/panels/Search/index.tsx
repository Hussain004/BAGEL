/**
 * Find panel: "when did <field> <condition>?".
 *
 * Streams the topic's decoded messages from the parser worker and runs a
 * `PredicateScanner` over each batch, so the scan never blocks the UI and the
 * results grow as it goes. Click a hit to seek there; "Mark on timeline" puts a
 * tick for every hit on the scrubber (the same ticks Bag Health uses).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { alignedTimeFor, resolveBagEntry, useBagStore } from '../../../store/bagStore';
import { usePlayheadStore } from '../../../store/playheadStore';
import { useAnnotationStore } from '../../../store/annotationStore';
import { DEFAULT_SEARCH_SETTINGS, useSearchPanelStore } from '../../../store/panelUiStores';
import { readDeserializedMessages, readMessageAtTime } from '../../../parsers';
import { getTopicColor } from '../../../utils/color';
import { MAX_AUTO_MARKS, type AutoMark } from '../../../utils/anomalies';
import {
  PREDICATE_OPS,
  PredicateScanner,
  parsePredicateValue,
  type Hit,
} from '../../../utils/predicate';
import { readScalar, scalarFieldPaths, stateLabel } from '../../../utils/stateSegments';
import { PanelShell } from '../PanelShell';
import { PanelEmptyState } from '../shared/PanelStates';

interface Props {
  panelId: string;
  topicName: string;
  type: string;
  bagId?: string;
}

/** Rows rendered at once; the full count is still reported and marked. */
const MAX_ROWS = 500;

type ScanState =
  | { status: 'idle' }
  | { status: 'scanning'; scanned: number }
  | { status: 'done'; scanned: number; hits: Hit[]; truncated: boolean; ranFor: string }
  | { status: 'error'; message: string };

export function SearchPanel({ panelId, topicName, type, bagId }: Props) {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const settings = useSearchPanelStore((s) => s.byId[panelId]) ?? DEFAULT_SEARCH_SETTINGS;
  const update = useSearchPanelStore((s) => s.update);
  const seek = usePlayheadStore((s) => s.seek);
  const setAutoMarks = useAnnotationStore((s) => s.setAutoMarks);
  const clearAutoMarks = useAnnotationStore((s) => s.clearAutoMarks);
  const marksOnTimeline = useAnnotationStore((s) => (entry ? s.autoMarks[entry.id] : undefined));

  const [fields, setFields] = useState<{ topic: string; names: string[] } | null>(null);
  const [scan, setScan] = useState<ScanState>({ status: 'idle' });
  const runRef = useRef(0);

  const bag = entry?.summary ?? null;
  const total = bag?.topics.find((t) => t.name === topicName)?.messageCount ?? 0;
  const isLive = entry?.kind === 'live';

  // Field list from the topic's first message: one topic has one schema.
  useEffect(() => {
    if (!entry || isLive || !entry.source) return;
    let cancelled = false;
    readMessageAtTime(entry.id, entry.source, entry.summary.format, topicName, entry.summary.startTime)
      .then((m) => {
        if (!cancelled) setFields({ topic: topicName, names: scalarFieldPaths(m?.value) });
      })
      .catch(() => {
        if (!cancelled) setFields({ topic: topicName, names: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [entry, isLive, topicName]);

  const names = useMemo(() => (fields?.topic === topicName ? fields.names : []), [fields, topicName]);
  // Default to a state-ish field, else the first non-header one.
  const defaultField = useMemo(
    () => names.find((n) => /(^|\.)(data|status|state|mode|level|percentage|voltage)$/.test(n)) ?? names.find((n) => !n.startsWith('header.')) ?? names[0] ?? '',
    [names],
  );
  const field = names.includes(settings.field) ? settings.field : defaultField;
  const opInfo = PREDICATE_OPS.find((o) => o.op === settings.op)!;
  const canRun = !!entry && !isLive && !!field && (!opInfo.needsValue || settings.valueText.trim() !== '') && scan.status !== 'scanning';

  const startNs = bag?.startTime ?? 0n;

  // Cancel any scan in flight when the panel goes away.
  useEffect(
    () => () => {
      runRef.current++;
    },
    [],
  );

  const run = useCallback(async () => {
    if (!entry || !entry.source || !field) return;
    const id = ++runRef.current;
    const predicate = { op: settings.op, value: opInfo.needsValue ? parsePredicateValue(settings.valueText) : null };
    const scanner = new PredicateScanner(predicate, { edge: settings.edge });
    const label = `${field} ${opInfo.label}${opInfo.needsValue ? ` ${settings.valueText.trim()}` : ''}`;
    setScan({ status: 'scanning', scanned: 0 });
    try {
      await readDeserializedMessages(
        entry.id,
        entry.source,
        entry.summary.format,
        topicName,
        undefined,
        (n) => {
          if (runRef.current === id) setScan({ status: 'scanning', scanned: n });
        },
        (batch) => {
          if (runRef.current !== id) return;
          for (const m of batch) scanner.push(Number(m.timestamp - startNs) / 1e9, readScalar(m.value, field));
        },
      );
      if (runRef.current !== id) return;
      // Batches arrive in order per decode, but sort so a multi-part bag with
      // overlapping parts still lists hits chronologically.
      const hits = [...scanner.hits].sort((a, b) => a.timeSec - b.timeSec);
      setScan({ status: 'done', scanned: scanner.scanned, hits, truncated: scanner.truncated, ranFor: label });
    } catch (err) {
      if (runRef.current === id) setScan({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }, [entry, field, settings.op, settings.valueText, settings.edge, opInfo, topicName, startNs]);

  const cancel = () => {
    runRef.current++;
    setScan({ status: 'idle' });
  };

  const seekTo = (timeSec: number) => {
    if (!entry) return;
    const local = startNs + BigInt(Math.round(timeSec * 1e9));
    seek(alignedTimeFor(entry, local, useBagStore.getState().alignment));
  };

  const markAll = () => {
    if (!entry || scan.status !== 'done') return;
    const marks: AutoMark[] = scan.hits.slice(0, MAX_AUTO_MARKS).map((h, i) => ({
      id: `auto-search-${entry.id}-${i}`,
      localNs: startNs + BigInt(Math.round(h.timeSec * 1e9)),
      label: `${scan.ranFor}: ${stateLabel(h.value)}`,
      kind: 'search',
      weight: 1,
    }));
    setAutoMarks(entry.id, marks);
  };

  const inputCls =
    'bg-surface border border-border rounded-md px-2 py-1 text-xs mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/60';

  return (
    <PanelShell
      panelId={panelId}
      kind="search"
      topicName={topicName}
      type={type}
      accentColor={getTopicColor(topicName, type)}
      bagId={bagId}
    >
      {isLive ? (
        <PanelEmptyState message="Search scans a recording, so it is not available for a live connection. Stop and record, then open the file." />
      ) : names.length === 0 && fields ? (
        <PanelEmptyState message="No scalar fields (string, boolean, or number) to search in this message type." />
      ) : (
        <div className="flex-1 flex flex-col min-h-0">
          <form
            className="px-3 py-2 border-b border-border flex flex-wrap items-center gap-2 flex-shrink-0"
            onSubmit={(e) => {
              e.preventDefault();
              if (canRun) void run();
            }}
          >
            <span className="text-xs text-text-muted">when</span>
            <select
              aria-label="Field"
              value={field}
              onChange={(e) => update(panelId, { field: e.target.value })}
              className={`${inputCls} max-w-[200px]`}
            >
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <select
              aria-label="Condition"
              value={settings.op}
              onChange={(e) => update(panelId, { op: e.target.value as typeof settings.op })}
              className={inputCls}
            >
              {PREDICATE_OPS.map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </select>
            {opInfo.needsValue && (
              <input
                aria-label="Value"
                value={settings.valueText}
                onChange={(e) => update(panelId, { valueText: e.target.value })}
                placeholder={settings.op === 'contains' ? 'text' : 'value'}
                className={`${inputCls} w-28`}
              />
            )}
            {settings.op !== 'changes' && (
              <label
                className="flex items-center gap-1 text-xs text-text-muted cursor-pointer"
                title="Report where the condition becomes true, not every sample while it stays true"
              >
                <input type="checkbox" checked={settings.edge} onChange={(e) => update(panelId, { edge: e.target.checked })} />
                only when it starts
              </label>
            )}
            {scan.status === 'scanning' ? (
              <button type="button" onClick={cancel} className="px-2.5 py-1 rounded-md text-xs border border-border text-text-secondary hover:border-border-hover">
                Cancel
              </button>
            ) : (
              <button
                type="submit"
                disabled={!canRun}
                className="px-2.5 py-1 rounded-md text-xs bg-accent-blue/10 border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Find
              </button>
            )}
          </form>

          <div className="px-3 py-1.5 border-b border-border text-xs text-text-muted flex flex-wrap items-center gap-x-3 gap-y-1 flex-shrink-0" role="status" aria-live="polite">
            {scan.status === 'idle' && <span>{total.toLocaleString()} messages on this topic.</span>}
            {scan.status === 'scanning' && (
              <span>
                Scanning… {scan.scanned.toLocaleString()} of {total.toLocaleString()} messages
              </span>
            )}
            {scan.status === 'error' && <span className="text-accent-rose">{scan.message}</span>}
            {scan.status === 'done' && (
              <>
                <span data-testid="search-summary">
                  {scan.hits.length.toLocaleString()} match{scan.hits.length === 1 ? '' : 'es'} in {scan.scanned.toLocaleString()} messages
                  {scan.truncated && <span className="text-accent-amber ml-1">(stopped at the first {scan.hits.length.toLocaleString()})</span>}
                </span>
                {scan.hits.length > 0 &&
                  (marksOnTimeline ? (
                    <button type="button" onClick={() => entry && clearAutoMarks(entry.id)} className="px-2 py-0.5 rounded border border-border hover:border-border-hover text-text-secondary">
                      Clear timeline marks
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={markAll}
                      title={`Add a tick on the timeline for each match (first ${MAX_AUTO_MARKS}). Replaces any marks already there.`}
                      className="px-2 py-0.5 rounded border border-accent-rose/50 text-accent-rose hover:bg-accent-rose/10"
                    >
                      Mark on timeline
                    </button>
                  ))}
              </>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {scan.status === 'done' && scan.hits.length === 0 && (
              <div className="p-6 text-center text-sm text-text-muted">No message matched {scan.ranFor}.</div>
            )}
            {scan.status === 'done' && scan.hits.length > 0 && (
              <ul className="text-xs mono" data-testid="search-results">
                {scan.hits.slice(0, MAX_ROWS).map((h, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => seekTo(h.timeSec)}
                      className="w-full flex items-center justify-between gap-4 px-3 py-1.5 border-b border-border/50 hover:bg-surface-hover/50 text-left"
                    >
                      <span className="text-text-primary tabular-nums">{h.timeSec.toFixed(3)}s</span>
                      <span className="text-text-secondary truncate">{stateLabel(h.value)}</span>
                    </button>
                  </li>
                ))}
                {scan.hits.length > MAX_ROWS && (
                  <li className="px-3 py-2 text-text-muted">
                    Showing the first {MAX_ROWS} of {scan.hits.length.toLocaleString()}. All are marked if you use Mark on timeline.
                  </li>
                )}
              </ul>
            )}
          </div>
        </div>
      )}
    </PanelShell>
  );
}
