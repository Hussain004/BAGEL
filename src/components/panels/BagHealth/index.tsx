import { useEffect, useMemo, useState } from 'react';
import { useBagStore, resolveBagEntry } from '../../../store/bagStore';
import { getParserClient } from '../../../workers/parserClient';
import { computeAllTopicHealth, type TopicHealth } from '../../../utils/topicStats';
import { detectNonMonotonicStamps } from '../../../utils/anomalies';
import type { AllTopicStats } from '../../../types/bag';
import { PanelShell } from '../PanelShell';

interface Props {
  panelId: string;
  topicName: string;
  type: string;
  bagId?: string;
}

type SortKey = 'topic' | 'count' | 'meanHz' | 'jitterMs' | 'gaps' | 'bwKBs';
type SortDir = 'asc' | 'desc';

export function BagHealth({ panelId, topicName, type, bagId }: Props) {
  const bagState = useBagStore((s) => s);
  const bags = useBagStore((s) => s.bags);
  const bagOrder = useBagStore((s) => s.bagOrder);
  const panelEntry = resolveBagEntry(bagState, bagId);

  // viewBagId overrides which bag's health stats are shown; null = use panel's assigned bag.
  const [viewBagId, setViewBagId] = useState<string | null>(null);

  const [stats, setStats] = useState<AllTopicStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('topic');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Non-live bags available for comparison.
  const nonLiveBags = useMemo(
    () => bagOrder.map((id) => bags.get(id)).filter((e) => e && e.kind !== 'live') as NonNullable<ReturnType<typeof bags.get>>[],
    [bags, bagOrder],
  );

  // If viewBagId is set and that bag still exists, use it; otherwise fall back to panel's bag.
  const entry = useMemo(() => {
    if (viewBagId) {
      const overrideEntry = bags.get(viewBagId);
      if (overrideEntry && overrideEntry.kind !== 'live') return overrideEntry;
    }
    return panelEntry ?? null;
  }, [viewBagId, bags, panelEntry]);

  // Reset viewBagId if the selected bag disappears.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (viewBagId && !bags.has(viewBagId)) setViewBagId(null);
  }, [bags, viewBagId]);

  const effectiveBagId = entry?.id ?? null;

  useEffect(() => {
    if (!entry || entry.kind === 'live' || !entry.source) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    setStats(null);
    const client = getParserClient(entry.id);
    client
      .readAllMessageStats(entry.source, entry.summary.format)
      .then(setStats)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBagId]);

  const healths = useMemo(() => (stats ? computeAllTopicHealth(stats) : []), [stats]);

  const nonMonotonic = useMemo(
    () => (stats ? detectNonMonotonicStamps(stats) : []),
    [stats],
  );

  const sorted = useMemo(() => {
    const list = [...healths];
    list.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'topic':   cmp = a.topic.localeCompare(b.topic); break;
        case 'count':   cmp = a.count - b.count; break;
        case 'meanHz':  cmp = a.meanHz - b.meanHz; break;
        case 'jitterMs': cmp = a.jitterSec - b.jitterSec; break;
        case 'gaps':    cmp = a.gapCount - b.gapCount; break;
        case 'bwKBs':   cmp = a.bandwidthBytesPerSec - b.bandwidthBytesPerSec; break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [healths, sortKey, sortDir]);

  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('desc'); }
  };

  const activeBagId = entry?.id ?? viewBagId ?? bagId ?? null;

  return (
    <PanelShell
      panelId={panelId}
      kind="health"
      topicName={topicName}
      type={type}
      bagId={bagId}
    >
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Bag selector - only shown when more than one non-live bag is loaded */}
        {nonLiveBags.length > 1 && (
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border flex-shrink-0 overflow-x-auto">
            {nonLiveBags.map((e) => {
              const isActive = e.id === activeBagId;
              return (
                <button
                  key={e.id}
                  onClick={() => setViewBagId(e.id === panelEntry?.id ? null : e.id)}
                  title={e.summary.fileName}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs transition-colors flex-shrink-0 ${
                    isActive
                      ? 'bg-surface-hover text-text-primary ring-1 ring-border'
                      : 'text-text-muted hover:text-text-primary hover:bg-surface-hover/50'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: e.color }}
                  />
                  <span className="max-w-[120px] truncate mono">
                    {e.summary.fileName}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {!entry && (
          <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
            No bag loaded.
          </div>
        )}
        {entry && loading && (
          <div className="flex-1 flex items-center justify-center gap-3 text-text-muted text-sm">
            <Spinner />
            Scanning message timestamps...
          </div>
        )}
        {entry && error && (
          <div className="flex-1 flex items-center justify-center text-accent-rose text-sm p-4 text-center">
            {error}
          </div>
        )}
        {entry && !loading && !error && stats && (
          <div className="flex-1 flex flex-col min-h-0">
            {nonMonotonic.length > 0 && (
              <div className="px-3 py-2 bg-accent-amber/10 border-b border-accent-amber/30 flex items-center gap-2 text-xs text-accent-amber flex-shrink-0">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                {nonMonotonic.length} non-monotonic timestamp{nonMonotonic.length > 1 ? 's' : ''} detected
                {nonMonotonic.length <= 3 && (
                  <span className="text-text-muted">{' '}- {nonMonotonic.map(a => a.topic).join(', ')}</span>
                )}
              </div>
            )}
            <div className="flex-1 overflow-auto">
              <table className="w-full text-xs border-collapse">
                <thead className="sticky top-0 bg-surface/95 backdrop-blur-sm z-10">
                  <tr className="border-b border-border">
                    <Th label="Topic" sortKey="topic" current={sortKey} dir={sortDir} onSort={onSort} left />
                    <Th label="Msgs" sortKey="count" current={sortKey} dir={sortDir} onSort={onSort} />
                    <Th label="Hz" sortKey="meanHz" current={sortKey} dir={sortDir} onSort={onSort} />
                    <Th label="Jitter" sortKey="jitterMs" current={sortKey} dir={sortDir} onSort={onSort} />
                    <Th label="Gaps" sortKey="gaps" current={sortKey} dir={sortDir} onSort={onSort} />
                    <Th label="BW" sortKey="bwKBs" current={sortKey} dir={sortDir} onSort={onSort} />
                    <th className="py-2 px-3 text-text-muted font-medium text-right">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((h) => (
                    <HealthRow key={h.topic} health={h} />
                  ))}
                </tbody>
              </table>
              {sorted.length === 0 && (
                <div className="flex items-center justify-center p-8 text-text-muted text-xs">
                  No topics found.
                </div>
              )}
            </div>
            <div className="px-3 py-1.5 border-t border-border text-xs text-text-muted flex-shrink-0">
              {healths.length} topics
            </div>
          </div>
        )}
      </div>
    </PanelShell>
  );
}

function Th({
  label, sortKey, current, dir, onSort, left,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  left?: boolean;
}) {
  const active = current === sortKey;
  return (
    <th
      className={`py-2 px-3 text-text-muted font-medium cursor-pointer hover:text-text-primary select-none whitespace-nowrap ${left ? 'text-left' : 'text-right'}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active && <SortArrow dir={dir} />}
    </th>
  );
}

function SortArrow({ dir }: { dir: SortDir }) {
  return (
    <span className="ml-1 text-accent-blue">
      {dir === 'asc' ? '↑' : '↓'}
    </span>
  );
}

function HealthRow({ health }: { health: TopicHealth }) {
  const { topic, count, meanHz, jitterSec, gapCount, bandwidthBytesPerSec, rateOverTime } = health;
  const jitterMs = jitterSec * 1000;
  const bwKBs = bandwidthBytesPerSec / 1024;

  const hasGaps = gapCount > 0;
  const highJitter = jitterMs > 10 && meanHz > 1;

  return (
    <tr className="border-b border-border/50 hover:bg-surface-hover/40 transition-colors">
      <td className="py-1.5 px-3 mono text-text-secondary truncate max-w-[220px]" title={topic}>
        {topic}
      </td>
      <td className="py-1.5 px-3 text-right tabular-nums text-text-primary">
        {count.toLocaleString('en-US')}
      </td>
      <td className="py-1.5 px-3 text-right tabular-nums text-text-primary">
        {meanHz >= 1 ? meanHz.toFixed(1) : meanHz.toFixed(3)}
      </td>
      <td className={`py-1.5 px-3 text-right tabular-nums ${highJitter ? 'text-accent-amber' : 'text-text-primary'}`}>
        {jitterMs < 1 ? `${(jitterMs * 1000).toFixed(0)}us` : `${jitterMs.toFixed(1)}ms`}
      </td>
      <td className={`py-1.5 px-3 text-right tabular-nums ${hasGaps ? 'text-accent-rose' : 'text-text-muted'}`}>
        {hasGaps ? gapCount : '-'}
      </td>
      <td className="py-1.5 px-3 text-right tabular-nums text-text-primary">
        {bwKBs >= 1000 ? `${(bwKBs / 1024).toFixed(1)} MB/s` : `${bwKBs.toFixed(1)} KB/s`}
      </td>
      <td className="py-1.5 px-3 text-right">
        <Sparkline t={rateOverTime.t} hz={rateOverTime.hz} />
      </td>
    </tr>
  );
}

function Sparkline({ t, hz }: { t: Float64Array; hz: Float64Array }) {
  if (t.length < 2) return <span className="text-text-muted">-</span>;

  const W = 64, H = 20;
  const maxHz = Math.max(...Array.from(hz), 0.001);

  const pts = Array.from({ length: hz.length }, (_, i) => {
    const x = (i / (hz.length - 1)) * W;
    const y = H - (hz[i] / maxHz) * (H - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <svg width={W} height={H} className="inline-block">
      <polyline
        points={pts}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        className="text-accent-blue/70"
      />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="w-4 h-4 animate-spin text-accent-blue" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}
