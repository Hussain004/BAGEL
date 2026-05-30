import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useBagStore, resolveBagEntry } from '../../../store/bagStore';
import { useBagLocalPlayhead } from '../../../hooks/useBagLocalPlayhead';
import { useTopicMessages } from '../../../hooks/useTopicMessages';
import { flattenNumeric } from '../../../utils/messages';
import { PanelShell } from '../PanelShell';
import { getTopicColor } from '../../../utils/color';
import {
  DEFAULT_TIMESERIES_SETTINGS,
  useTimeSeriesPanelStore,
} from '../../../store/panelUiStores';

/**
 * Series palette used when the topic doesn't fall into a known category.
 * Picked for high contrast on the dark theme.
 */
const SERIES_PALETTE = [
  '#3b82f6',
  '#06b6d4',
  '#10b981',
  '#f59e0b',
  '#f43f5e',
  '#8b5cf6',
  '#ec4899',
  '#84cc16',
  '#0ea5e9',
  '#a855f7',
];

interface TimeSeriesPlotProps {
  panelId: string;
  topicName: string;
  type: string;
  bagId?: string;
}

/**
 * Cap on eager message loads per plot panel.
 *
 * The plot needs every numeric value to draw the time series, but for huge
 * topics (10k+ msgs at 100 Hz over many minutes) loading everything stalls
 * the UI thread for ages. 50,000 is enough for 8 minutes at 100 Hz; beyond
 * that we surface a clear "showing first N of M" hint so the user knows
 * they're looking at a window, not the full bag.
 */
const PLOT_MESSAGE_LIMIT = 50_000;

export function TimeSeriesPlot({ panelId, topicName, type, bagId }: TimeSeriesPlotProps) {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const bag = entry?.summary ?? null;
  const { messages, loading, progress, error } = useTopicMessages(
    topicName,
    PLOT_MESSAGE_LIMIT,
    true,
    bagId,
  );
  const totalMessages = useMemo(
    () => bag?.topics.find((t) => t.name === topicName)?.messageCount ?? 0,
    [bag, topicName],
  );
  const truncated = messages != null && totalMessages > messages.length;

  // Numeric series extracted from the messages: dict of field-path → values aligned with time array.
  const series = useMemo(() => {
    if (!messages || messages.length === 0) return null;

    const firstFlat = flattenNumeric(messages[0].value);
    const fieldNames = Object.keys(firstFlat);
    if (fieldNames.length === 0) return null;

    // Use bag startTime (or first message timestamp) as t=0 for the x axis.
    const baseNs = messages[0].timestamp;

    const time: number[] = new Array(messages.length);
    const values: Record<string, (number | null)[]> = {};
    for (const f of fieldNames) values[f] = new Array(messages.length).fill(null);

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      time[i] = Number(m.timestamp - baseNs) / 1e9;
      const flat = flattenNumeric(m.value);
      for (const f of fieldNames) {
        if (f in flat) values[f][i] = flat[f];
      }
    }

    return { time, values, fieldNames, baseNs };
  }, [messages]);

  // Per-panel UI state — visibility toggles + saved x-axis zoom range.
  // Lives in a store so a dock-induced remount (v0.7) doesn't reset what
  // the user just clicked / dragged. Settings keyed by `panelId` survive
  // close + reopen of the same panel too.
  const settings = useTimeSeriesPanelStore(
    (s) => s.byId[panelId] ?? DEFAULT_TIMESERIES_SETTINGS,
  );
  const updateSettings = useTimeSeriesPanelStore((s) => s.update);
  const visibility = settings.visibility;
  const setVisibility = (next: Record<string, boolean>) =>
    updateSettings(panelId, { visibility: next });

  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  // Latest series stashed for the mount effect's closure — the mount only
  // re-runs when the field set changes, but it needs whatever series we
  // have at that moment to build initial opts/data.
  const seriesRef = useRef(series);
  seriesRef.current = series;
  // Mirror saved xRange in a ref so the mouseup handler can read the latest
  // scale state without needing to be reattached on every settings change.
  const savedXRangeRef = useRef(settings.xRange);
  savedXRangeRef.current = settings.xRange;

  // Stable key over the set of fields. Re-mount uPlot only when this
  // changes; during streaming the fields are stable from the first batch
  // so the plot mounts once and grows in place via `setData` below.
  const fieldNamesKey = useMemo(
    () => series?.fieldNames.join('|') ?? '',
    [series],
  );

  // Mount / unmount effect: depends only on fieldNamesKey so the chart
  // canvas isn't torn down every time a streaming batch arrives.
  useEffect(() => {
    if (!fieldNamesKey || !containerRef.current) return;
    const current = seriesRef.current;
    if (!current) return;

    const colors = current.fieldNames.map(
      (_, i) => SERIES_PALETTE[i % SERIES_PALETTE.length],
    );

    const data: uPlot.AlignedData = [
      current.time,
      ...current.fieldNames.map((f) => current.values[f] as (number | null)[]),
    ];

    // Pre-mount restoration of saved x-axis zoom (after a dock-induced
    // remount, after close+reopen, or on a hash-restore session). If
    // `xRange` is null the user has not zoomed, so we leave it unset and
    // let uPlot auto-fit to the streamed data.
    const initialXRange = savedXRangeRef.current;

    const opts: uPlot.Options = {
      width: containerRef.current.clientWidth,
      height: Math.max(220, containerRef.current.clientHeight - 110),
      cursor: { drag: { x: true, y: false, uni: 50 } },
      scales: {
        x: initialXRange
          ? { time: false, min: initialXRange.min, max: initialXRange.max }
          : { time: false },
      },
      axes: [
        {
          stroke: '#94a3b8',
          grid: { stroke: 'rgba(255,255,255,0.05)' },
          ticks: { stroke: 'rgba(255,255,255,0.1)' },
          values: (_u, ticks) => ticks.map((t) => `${t.toFixed(2)}s`),
        },
        {
          stroke: '#94a3b8',
          grid: { stroke: 'rgba(255,255,255,0.05)' },
          ticks: { stroke: 'rgba(255,255,255,0.1)' },
        },
      ],
      series: [
        { label: 't' },
        ...current.fieldNames.map((f, i) => ({
          label: f,
          stroke: colors[i],
          width: 1.5,
          points: { show: false },
          show: visibility[f] !== false,
        })),
      ],
      legend: { show: false },
    };

    const u = new uPlot(opts, data, containerRef.current);
    plotRef.current = u;

    // Persist the x-axis range *only* on user-driven gestures. uPlot fires
    // `setScale` on every data update (the streaming path is constant),
    // so naively storing on every scale change would overwrite the user's
    // zoom on the very next batch. Listening to native pointerup/dblclick
    // on the container filters out programmatic updates — those don't
    // generate any input events.
    const container = containerRef.current;
    const handlePointerUp = () => {
      if (!plotRef.current) return;
      const sx = plotRef.current.scales.x;
      if (sx.min == null || sx.max == null) return;
      const next = { min: sx.min, max: sx.max };
      const prev = savedXRangeRef.current;
      if (prev && prev.min === next.min && prev.max === next.max) return;
      updateSettings(panelId, { xRange: next });
    };
    const handleDblClick = () => {
      // Reset zoom: clear the saved range and let uPlot auto-fit to data.
      updateSettings(panelId, { xRange: null });
      if (plotRef.current && seriesRef.current) {
        const s = seriesRef.current;
        const lo = s.time[0] ?? 0;
        const hi = s.time[s.time.length - 1] ?? 0;
        plotRef.current.setScale('x', { min: lo, max: hi });
      }
    };
    container.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('dblclick', handleDblClick);

    // No-op guard: ResizeObserver can fire spuriously (e.g. during the
    // panel mount animation, or when a sibling layout change ripples
    // without actually changing this container). Without the early-out,
    // calling setSize with unchanged dims still triggers a uPlot redraw
    // and another ResizeObserver tick — visible as a noticeable hitch
    // during streaming when batches are landing every frame.
    let lastW = 0;
    let lastH = 0;
    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current || !plotRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = Math.max(220, containerRef.current.clientHeight - 110);
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      plotRef.current.setSize({ width: w, height: h });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('dblclick', handleDblClick);
      u.destroy();
      plotRef.current = null;
    };
    // visibility / panelId / updateSettings intentionally excluded —
    // visibility is applied via setSeries below; panelId is stable; the
    // store action ref is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldNamesKey]);

  // In-place data update: runs every time series identity changes, but
  // doesn't tear down the canvas. `setData` triggers uPlot's internal
  // redraw with the new arrays — orders of magnitude cheaper than a
  // remount during the streaming decode.
  useEffect(() => {
    if (!plotRef.current || !series) return;
    const data: uPlot.AlignedData = [
      series.time,
      ...series.fieldNames.map((f) => series.values[f] as (number | null)[]),
    ];
    plotRef.current.setData(data);
  }, [series]);

  // Toggle series visibility without rebuilding the plot.
  useEffect(() => {
    if (!plotRef.current || !series) return;
    series.fieldNames.forEach((f, i) => {
      plotRef.current!.setSeries(i + 1, { show: visibility[f] !== false });
    });
  }, [visibility, series]);

  // Sync the cursor line with the global playhead (bag-local for multi-bag).
  const playheadNs = useBagLocalPlayhead(bagId);
  useEffect(() => {
    if (!plotRef.current || !series) return;
    const xSec = Number(playheadNs - series.baseNs) / 1e9;
    const left = plotRef.current.valToPos(xSec, 'x');
    plotRef.current.setCursor({ left, top: 0 }, false);
  }, [playheadNs, series]);

  return (
    <PanelShell
      panelId={panelId}
      kind="plot"
      topicName={topicName}
      type={type}
      accentColor={getTopicColor(topicName, type)}
      bagId={bagId}
    >
      {loading && (
        <PanelLoadingState
          message={
            totalMessages > 0
              ? `Decoded ${progress.toLocaleString()} of ${Math.min(
                  totalMessages,
                  PLOT_MESSAGE_LIMIT,
                ).toLocaleString()} messages…`
              : `Decoded ${progress.toLocaleString()} messages…`
          }
        />
      )}
      {error && <PanelErrorState message={error} />}
      {!loading && !error && (!series || messages?.length === 0) && (
        <PanelEmptyState
          message={
            !messages || messages.length === 0
              ? 'No messages on this topic.'
              : 'No numeric fields found in this message type.'
          }
        />
      )}
      {series && (
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* min-w-0 + no horizontal padding on the uPlot host: clientWidth
              includes padding, and feeding padded clientWidth into uPlot's
              setSize was part of the single-panel "extends to the right"
              amplification — even with min-w-0 above, each measurement
              would still grow by the padding amount per tick. pt-2 stays
              for top breathing room; horizontal spacing comes from the
              panel border. */}
          <div ref={containerRef} className="flex-1 min-h-[240px] pt-2 min-w-0" />
          <div className="px-4 py-2 border-t border-border flex flex-wrap gap-2 max-h-24 overflow-y-auto">
            {series.fieldNames.map((f, i) => {
              const color = SERIES_PALETTE[i % SERIES_PALETTE.length];
              const visible = visibility[f] !== false;
              return (
                <button
                  key={f}
                  onClick={() =>
                    setVisibility({ ...visibility, [f]: !visible })
                  }
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs mono transition-all border ${
                    visible
                      ? 'bg-surface border-border text-text-primary'
                      : 'bg-transparent border-transparent text-text-muted'
                  } hover:border-border-hover`}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: visible ? color : '#475569' }}
                  />
                  {f}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {bag && (
        <div className="px-4 py-1.5 border-t border-border text-text-muted text-xs mono flex items-center justify-between gap-3">
          <span>
            {messages?.length.toLocaleString() ?? 0} samples
            {truncated && (
              <span
                className="text-accent-amber ml-2"
                title={`Topic has ${totalMessages.toLocaleString()} messages; only the first ${PLOT_MESSAGE_LIMIT.toLocaleString()} are plotted.`}
              >
                (first {PLOT_MESSAGE_LIMIT.toLocaleString()} of {totalMessages.toLocaleString()})
              </span>
            )}
          </span>
          <span>relative t in seconds from first message</span>
        </div>
      )}
    </PanelShell>
  );
}

function PanelLoadingState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
      <svg className="w-6 h-6 text-accent-blue animate-spin-slow" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-text-secondary text-sm">{message}</span>
    </div>
  );
}

function PanelErrorState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="text-accent-rose text-sm font-medium">Failed to load messages</div>
      <div className="text-text-secondary text-xs max-w-md">{message}</div>
    </div>
  );
}

function PanelEmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-text-muted text-sm p-8">
      {message}
    </div>
  );
}
