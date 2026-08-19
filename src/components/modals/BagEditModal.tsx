import { useEffect, useMemo, useRef, useState } from 'react';
import { ModalShell } from './ModalShell';
import { useUiStore } from '../../store/uiStore';
import { useBagStore } from '../../store/bagStore';
import {
  editBag,
  estimateEditCount,
  getResolvableTopicsDb3,
} from '../../parsers';
import { downloadText } from '../../utils/export';
import { nsToSeconds } from '../../utils/time';
import { formatFileSize } from '../../utils/bytes';
import type { TopicInfo } from '../../types/bag';

/**
 * BagEditModal: v1.1 banner feature, extended to every format in v1.2.
 *
 * Trims a loaded bag to a `[start, end]` window and (optionally) prunes the
 * topic set, then writes a fresh MCAP `Uint8Array` and triggers a browser
 * download. Output is always MCAP regardless of input format - v1.2 reads
 * MCAP, ROS1 `.bag`, and ROS2 `.db3` via format-specific edit pipelines and
 * funnels them all through the same MCAP writer.
 *
 * Surface limitations the UI still surfaces:
 *   - Output is always uncompressed MCAP. fzstd is decompress-only so we
 *     can't write zstd chunks yet; output bags reload identically and just
 *     weigh a bit more on disk.
 *   - `.db3` topics whose type isn't in the bundled registry are flagged
 *     as "schema missing" and unchecked by default. Users can opt them in,
 *     in which case the bytes are written with a schema-less channel.
 */
export function BagEditModal() {
  const close = () => useUiStore.getState().setModal(null);
  const focusBagId = useBagStore((s) => s.focusBagId);
  const bags = useBagStore((s) => s.bags);
  const entry = focusBagId ? bags.get(focusBagId) : undefined;

  if (!entry) {
    // No bag focused (edge case: the toolbar button is hidden in that case
    // but routing the modal through a global slot means we still defend).
    return (
      <ModalShell title="Edit bag" onClose={close} width="md">
        <div className="px-6 py-6 text-sm text-text-secondary">
          Load a bag first, then re-open this dialog.
        </div>
      </ModalShell>
    );
  }

  if (entry.kind === 'live') {
    return (
      <ModalShell title="Edit bag" onClose={close} width="md">
        <div className="px-6 py-6 text-sm text-text-secondary">
          Clip export is not available for live connections.
        </div>
      </ModalShell>
    );
  }

  return <BagEditForm entry={entry} onClose={close} />;
}

interface FormProps {
  entry: NonNullable<ReturnType<ReturnType<typeof useBagStore.getState>['bags']['get']>>;
  onClose: () => void;
}

function BagEditForm({ entry, onClose }: FormProps) {
  const summary = entry.summary;
  // entry.kind is always 'file' | 'url' here (live guard in BagEditModal)
  const source = entry.source!;
  const bagDurationSec = nsToSeconds(summary.endTime - summary.startTime);

  // Trim window kept in bag-local seconds for the slider, converted to ns at
  // submit time. Keeping the slider in seconds avoids BigInt drift in the
  // intermediate state and the user reads "0.0s - 30.0s" instead of raw ns.
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(bagDurationSec);

  // .db3 pre-flight: which topics can the bundled registry actually resolve?
  // Topics with no resolvable schema are still listed and selectable, but
  // unchecked by default and rendered with a "schema missing" chip. The
  // user can opt them in; their bytes get written into the output with a
  // schema-less MCAP channel.
  const [unresolvedTopics, setUnresolvedTopics] = useState<Set<string>>(
    () => new Set(),
  );
  const [resolutionLoading, setResolutionLoading] = useState(
    summary.format === 'db3',
  );

  useEffect(() => {
    if (summary.format !== 'db3') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUnresolvedTopics(new Set());
      setResolutionLoading(false);
      return;
    }
    let cancelled = false;
    setResolutionLoading(true);
    void getResolvableTopicsDb3(entry.id, source)
      .then((resolutions) => {
        if (cancelled) return;
        const unresolved = new Set<string>();
        for (const r of resolutions) {
          if (!r.resolvable) unresolved.add(r.topic);
        }
        setUnresolvedTopics(unresolved);
      })
      .catch(() => {
        // If the pre-flight fails, fall back to letting the user submit
        // without warnings - editDb3 will skip unresolved topics with a
        // console warning regardless.
        if (!cancelled) setUnresolvedTopics(new Set());
      })
      .finally(() => {
        if (!cancelled) setResolutionLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.id, source, summary.format]);

  // Topic selection. Default: every topic with messages AND with a resolvable
  // schema (for .db3) is included. Empty-count topics are still listed (some
  // bags advertise topics with zero published messages) so users can drop
  // them if they want, but they're unchecked-by-default to match the
  // practical "keep what matters" expectation.
  const initialSelected = useMemo(() => {
    const set = new Set<string>();
    for (const t of summary.topics) {
      if (t.messageCount === 0) continue;
      if (unresolvedTopics.has(t.name)) continue;
      set.add(t.name);
    }
    return set;
  }, [summary.topics, unresolvedTopics]);
  const [selected, setSelected] = useState<Set<string>>(initialSelected);
  // Reset the selection when the unresolved-set finishes loading so the
  // .db3 pre-flight result actually narrows the default.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(initialSelected);
  }, [initialSelected]);
  const [topicFilterQ, setTopicFilterQ] = useState('');

  const [filename, setFilename] = useState(() => defaultEditedFilename(summary.fileName));
  const [estimateMsgs, setEstimateMsgs] = useState<number | null>(null);
  const [writing, setWriting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<null | {
    bytes: number;
    messages: number;
    durationSec: number;
  }>(null);

  // Re-estimate whenever the trim window or topic selection changes, so the
  // user gets a live "~N messages, ~Y MB" hint and doesn't have to start the
  // edit just to find out the cut is empty. Estimates are debounced (300 ms)
  // so dragging the slider doesn't fire a worker round-trip per pixel.
  const debounceTimerRef = useRef<number | null>(null);
  useEffect(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEstimateMsgs(null);
    debounceTimerRef.current = window.setTimeout(() => {
      const topics = selected.size === summary.topics.length ? null : Array.from(selected);
      const startNs =
        summary.startTime + BigInt(Math.round(startSec * 1_000_000_000));
      const endNs = summary.startTime + BigInt(Math.round(endSec * 1_000_000_000));
      if (endNs <= startNs) {
        setEstimateMsgs(0);
        return;
      }
      void estimateEditCount(
        entry.id,
        source,
        summary.format,
        startNs,
        endNs,
        topics,
      )
        .then(setEstimateMsgs)
        .catch(() => setEstimateMsgs(null));
    }, 300);
    return () => {
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
    };
  }, [
    entry.id,
    source,
    summary.format,
    summary.startTime,
    summary.topics.length,
    startSec,
    endSec,
    selected,
  ]);

  const filteredTopics = useMemo(() => {
    const q = topicFilterQ.trim().toLowerCase();
    if (!q) return summary.topics;
    return summary.topics.filter(
      (t) =>
        t.name.toLowerCase().includes(q) || t.type.toLowerCase().includes(q),
    );
  }, [summary.topics, topicFilterQ]);

  const onToggleTopic = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const onSelectAll = () => {
    setSelected(new Set(summary.topics.map((t) => t.name)));
  };
  const onSelectNone = () => setSelected(new Set());
  const onSelectVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const t of filteredTopics) next.add(t.name);
      return next;
    });
  };

  const trimInvalid = endSec <= startSec;
  const noTopics = selected.size === 0;
  const submitDisabled = writing || trimInvalid || noTopics;

  const onSubmit = async () => {
    setError(null);
    setDone(null);
    setProgress(0);
    setWriting(true);
    try {
      const topics = selected.size === summary.topics.length ? null : Array.from(selected);
      // .db3 only: the subset of `topics` that we know are schema-less.
      // The worker writes those with `schemaId: 0` instead of skipping.
      const includeUnresolvedTopics =
        summary.format === 'db3'
          ? Array.from(selected).filter((t) => unresolvedTopics.has(t))
          : undefined;
      const startNs =
        summary.startTime + BigInt(Math.round(startSec * 1_000_000_000));
      const endNs = summary.startTime + BigInt(Math.round(endSec * 1_000_000_000));
      const result = await editBag(
        entry.id,
        source,
        summary.format,
        startNs,
        endNs,
        topics,
        includeUnresolvedTopics,
        (written: number) => setProgress(written),
      );
      // Hand the bytes to the browser as a download. We can't reuse
      // `downloadText` directly (it wraps a string), so we drop down to a
      // Blob here. The MCAP MIME type isn't standardised; `application/mcap`
      // matches what `mcap convert` writes when piping through HTTP.
      //
      // Cast through `BlobPart` because newer TS dom libs widen
      // `Uint8Array['buffer']` to `ArrayBufferLike` (which includes
      // `SharedArrayBuffer`); the worker only ever transfers a real
      // `ArrayBuffer` so the cast is sound.
      const blob = new Blob([result.bytes as unknown as BlobPart], {
        type: 'application/mcap',
      });
      const url = URL.createObjectURL(blob);
      try {
        const a = document.createElement('a');
        a.href = url;
        a.download = sanitiseFilename(filename) || 'edited.mcap';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      }
      const dur = Number(result.endNs - result.startNs) / 1e9;
      setDone({
        bytes: result.bytes.byteLength,
        messages: result.messageCount,
        durationSec: Number.isFinite(dur) && dur > 0 ? dur : 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setWriting(false);
    }
  };

  // Silence the `downloadText` import-not-used warning. Keep it imported so
  // future "Save edit script" variants can reuse the same code path.
  void downloadText;

  return (
    <ModalShell
      title="Edit bag"
      subtitle={`${summary.fileName} (${formatFileSize(summary.fileSize)})`}
      onClose={onClose}
      width="lg"
    >
      <div className="px-6 py-4 space-y-5 text-sm">
        <p className="text-text-secondary leading-relaxed">
          Trim the time range, drop topics you don't need, then download the
          result as a fresh{' '}
          <code className="mono text-text-primary">.mcap</code>. Output is
          uncompressed but fully indexed so it re-opens here (or in any other
          MCAP tool) with no further processing.
        </p>
        {summary.format === 'bag' && (
          <p className="text-xs text-text-tertiary leading-relaxed">
            Reading a ROS1{' '}
            <code className="mono text-text-secondary">.bag</code>: schemas
            from the bag's connection records flow through as{' '}
            <code className="mono text-text-secondary">ros1msg</code> in the
            output, and message bytes copy through with{' '}
            <code className="mono text-text-secondary">messageEncoding: ros1</code>.
          </p>
        )}
        {summary.format === 'db3' && (
          <p className="text-xs text-text-tertiary leading-relaxed">
            Reading a ROS2{' '}
            <code className="mono text-text-secondary">.db3</code>: schemas
            come from BAGEL's bundled type registry (plus any custom schemas
            you've pasted). Topics whose type isn't in the registry are
            flagged below and excluded by default; tick the checkbox to
            include them anyway with a schema-less channel.
          </p>
        )}

        <section>
          <SectionHeader
            title="Trim window"
            hint={`Full bag: 0.00s – ${bagDurationSec.toFixed(2)}s`}
          />
          <div className="grid grid-cols-2 gap-3 mt-2">
            <NumericField
              label="Start (s)"
              value={startSec}
              min={0}
              max={Math.max(0, endSec - 0.01)}
              max_={bagDurationSec}
              step={0.05}
              onChange={(v) => setStartSec(Math.max(0, Math.min(v, bagDurationSec)))}
            />
            <NumericField
              label="End (s)"
              value={endSec}
              min={Math.min(bagDurationSec, startSec + 0.01)}
              max={bagDurationSec}
              max_={bagDurationSec}
              step={0.05}
              onChange={(v) =>
                setEndSec(Math.max(0, Math.min(v, bagDurationSec)))
              }
            />
          </div>
          <RangeBar
            full={bagDurationSec}
            start={startSec}
            end={endSec}
            onChange={(a, b) => {
              setStartSec(a);
              setEndSec(b);
            }}
          />
          {trimInvalid && (
            <p className="text-xs text-accent-rose mt-1">
              End must be after start.
            </p>
          )}
        </section>

        <section>
          <SectionHeader
            title={`Topics to keep (${selected.size}/${summary.topics.length})`}
            hint="Toggle to include/exclude. Excluded topics are dropped wholesale from the output."
          />
          <div className="mt-2 flex items-center gap-2">
            <input
              value={topicFilterQ}
              onChange={(e) => setTopicFilterQ(e.target.value)}
              placeholder="Filter…"
              className="flex-1 px-2 py-1 rounded-md bg-bg-primary border border-border focus:border-accent-blue/60 focus:ring-1 focus:ring-accent-blue/30 focus:outline-none text-xs mono text-text-primary placeholder:text-text-muted"
            />
            <button
              type="button"
              onClick={onSelectAll}
              className="px-2 py-1 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-border"
            >
              All
            </button>
            <button
              type="button"
              onClick={onSelectNone}
              className="px-2 py-1 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-border"
            >
              None
            </button>
            {topicFilterQ && (
              <button
                type="button"
                onClick={onSelectVisible}
                className="px-2 py-1 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-border"
                title="Add every topic matching the current filter"
              >
                + Visible
              </button>
            )}
          </div>
          {summary.format === 'db3' && resolutionLoading && (
            <p className="text-[10px] text-text-muted mt-1 mono">
              Checking topic schemas against the registry...
            </p>
          )}
          <ul className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border bg-bg-primary/40 divide-y divide-border/60">
            {filteredTopics.map((t) => (
              <TopicRow
                key={t.name}
                topic={t}
                checked={selected.has(t.name)}
                onToggle={() => onToggleTopic(t.name)}
                schemaMissing={unresolvedTopics.has(t.name)}
              />
            ))}
            {filteredTopics.length === 0 && (
              <li className="px-3 py-3 text-xs text-text-tertiary text-center">
                No topics match "{topicFilterQ}".
              </li>
            )}
          </ul>
          {noTopics && (
            <p className="text-xs text-accent-rose mt-1">
              Pick at least one topic to keep.
            </p>
          )}
        </section>

        <section>
          <SectionHeader title="Output filename" />
          <div className="mt-2 flex items-center gap-2">
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="flex-1 px-2 py-1 rounded-md bg-bg-primary border border-border focus:border-accent-blue/60 focus:ring-1 focus:ring-accent-blue/30 focus:outline-none text-xs mono text-text-primary placeholder:text-text-muted"
              placeholder="edited.mcap"
            />
          </div>
        </section>

        <section className="rounded-md border border-border bg-bg-primary/40 px-3 py-2 text-xs text-text-tertiary">
          <div className="flex items-center justify-between gap-3">
            <span>
              Estimated output:{' '}
              <span className="text-text-primary mono">
                {estimateMsgs === null
                  ? 'computing…'
                  : `~${estimateMsgs.toLocaleString()} messages`}
              </span>
            </span>
            <span className="text-text-muted">
              window {(endSec - startSec).toFixed(2)}s · {selected.size} of{' '}
              {summary.topics.length} topics
            </span>
          </div>
        </section>

        {writing && (
          <div className="rounded-md border border-accent-blue/30 bg-accent-blue/5 px-3 py-2">
            <div className="flex items-center justify-between text-xs text-accent-blue">
              <span>Writing…</span>
              <span className="mono">
                {progress.toLocaleString()}
                {estimateMsgs ? ` / ~${estimateMsgs.toLocaleString()}` : ''}
              </span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-bg-primary overflow-hidden">
              <div
                className="h-full bg-accent-blue/70 transition-colors"
                style={{
                  width: estimateMsgs
                    ? `${Math.min(100, (progress / Math.max(1, estimateMsgs)) * 100)}%`
                    : '40%',
                }}
              />
            </div>
          </div>
        )}

        {done && !writing && (
          <div className="rounded-md border border-accent-emerald/30 bg-accent-emerald/5 px-3 py-2 text-xs text-accent-emerald">
            Wrote {done.messages.toLocaleString()} messages across{' '}
            {done.durationSec.toFixed(2)}s ({formatFileSize(done.bytes)}). The
            download should be in your browser's Downloads folder.
          </div>
        )}

        {error && (
          <div className="px-3 py-2 rounded-md border border-accent-rose/30 bg-accent-rose/10 text-accent-rose text-xs mono whitespace-pre-wrap break-words">
            {error}
          </div>
        )}
      </div>
      <footer className="px-6 py-3 border-t border-border bg-surface/40 flex items-center justify-end gap-2 flex-shrink-0">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
        >
          {done ? 'Close' : 'Cancel'}
        </button>
        <button
          onClick={onSubmit}
          disabled={submitDisabled}
          className="px-3 py-1.5 rounded-md text-sm bg-accent-blue/15 text-accent-blue border border-accent-blue/40 hover:bg-accent-blue/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {writing && <Spinner />}
          {writing ? 'Writing…' : 'Edit & download'}
        </button>
      </footer>
    </ModalShell>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
        {title}
      </h3>
      {hint && <span className="text-[10px] text-text-muted mono">{hint}</span>}
    </div>
  );
}

interface NumericFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** Hard cap so the input's `max` attribute caps typing too. */
  max_: number;
  step: number;
  onChange: (v: number) => void;
}
function NumericField({ label, value, min, max, max_, step, onChange }: NumericFieldProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] text-text-tertiary uppercase tracking-wide">
        {label}
      </span>
      <input
        type="number"
        value={value.toFixed(2)}
        min={min}
        max={max_}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        className="px-2 py-1 rounded-md bg-bg-primary border border-border focus:border-accent-blue/60 focus:ring-1 focus:ring-accent-blue/30 focus:outline-none text-sm mono tabular-nums text-text-primary"
      />
    </label>
  );
}

interface RangeBarProps {
  full: number;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}
/**
 * Mini-timeline showing the bag duration with two draggable handles. Click on
 * the track snaps the nearer handle; dragging a handle past the other one
 * swaps them (matches the v0.5 timeline behaviour).
 */
function RangeBar({ full, start, end, onChange }: RangeBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<'start' | 'end' | null>(null);

  const startPct = full > 0 ? (start / full) * 100 : 0;
  const endPct = full > 0 ? (end / full) * 100 : 100;

  const eventToSec = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return fraction * full;
  };

  // Two flat handlers (rather than a `(handle) => (e) => ...` curry called
  // inline in JSX) so the ref write only ever happens inside an event
  // handler, never as a side effect of a function invoked during render.
  const onPointerDownStart = (e: React.PointerEvent) => {
    draggingRef.current = 'start';
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerDownEnd = (e: React.PointerEvent) => {
    draggingRef.current = 'end';
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const sec = eventToSec(e.clientX);
    if (draggingRef.current === 'start') {
      onChange(Math.min(sec, end - 0.01), end);
    } else {
      onChange(start, Math.max(sec, start + 0.01));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  return (
    <div
      ref={trackRef}
      className="relative mt-3 h-6 cursor-pointer select-none"
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-surface" />
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-accent-blue/40"
        style={{ left: `${startPct}%`, right: `${100 - endPct}%` }}
      />
      <button
        type="button"
        aria-label="Trim start"
        onPointerDown={onPointerDownStart}
        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 -ml-2 rounded-full bg-bg-primary border-2 border-accent-blue shadow-glow-blue hover:scale-110 transition-transform"
        style={{ left: `${startPct}%` }}
      />
      <button
        type="button"
        aria-label="Trim end"
        onPointerDown={onPointerDownEnd}
        className="absolute top-1/2 -translate-y-1/2 w-4 h-4 -ml-2 rounded-full bg-bg-primary border-2 border-accent-blue shadow-glow-blue hover:scale-110 transition-transform"
        style={{ left: `${endPct}%` }}
      />
    </div>
  );
}

function TopicRow({
  topic,
  checked,
  onToggle,
  schemaMissing,
}: {
  topic: TopicInfo;
  checked: boolean;
  onToggle: () => void;
  schemaMissing?: boolean;
}) {
  return (
    <li>
      <label className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-surface-hover">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="accent-accent-blue"
        />
        <span className="mono text-xs text-text-primary truncate flex-1">
          {topic.name}
        </span>
        {schemaMissing && (
          <span
            className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent-amber/40 bg-accent-amber/10 text-accent-amber shrink-0"
            title="This topic's type isn't in BAGEL's bundled registry. Checking includes the bytes anyway with a schema-less channel."
          >
            schema missing
          </span>
        )}
        <span className="text-[10px] text-text-tertiary mono shrink-0">
          {topic.type}
        </span>
        <span className="text-[10px] text-text-muted mono tabular-nums w-16 text-right shrink-0">
          {topic.messageCount.toLocaleString()}
        </span>
      </label>
    </li>
  );
}

function Spinner() {
  return (
    <svg className="w-3.5 h-3.5 animate-spin-slow" fill="none" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function defaultEditedFilename(original: string): string {
  // Strip the extension, append `__edited`, re-append `.mcap`. Works for
  // input bags whose extension wasn't `.mcap` (URL loads sometimes lack
  // one, falling back to "<name>__edited.mcap").
  const stem = original.replace(/\.[^./\\]+$/, '');
  return `${stem || 'bag'}__edited.mcap`;
}

function sanitiseFilename(name: string): string {
  // Strip any path separators a user might paste in. The browser also
  // strips slashes from the `download` attr but doing it here makes the
  // visible value match what gets saved.
  const stripped = name.replace(/[/\\]+/g, '_').trim();
  if (!stripped) return '';
  // Ensure the `.mcap` suffix so external tools (and the OS) treat the file
  // as MCAP. Users can still type a different extension on purpose.
  return /\.[^.]+$/.test(stripped) ? stripped : `${stripped}.mcap`;
}
