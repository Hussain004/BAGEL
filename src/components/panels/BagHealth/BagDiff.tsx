import { useMemo, useState } from 'react';
import type { BagEntry } from '../../../store/bagStore';
import { useLayoutStore } from '../../../store/layoutStore';
import { diffBags, diffKindLabel, diffToMarkdown, type DiffKind, type DiffRow } from '../../../utils/bagDiff';
import { suggestPanelKind } from '../../../utils/panelOptions';
import type { TopicInfo } from '../../../types/bag';

const KIND_STYLE: Record<DiffKind, string> = {
  'only-a': 'bg-accent-rose/10 text-accent-rose border-accent-rose/30',
  'only-b': 'bg-accent-amber/10 text-accent-amber border-accent-amber/30',
  type: 'bg-accent-violet/10 text-accent-violet border-accent-violet/30',
  rate: 'bg-accent-blue/10 text-accent-blue border-accent-blue/30',
  same: 'bg-surface text-text-muted border-border',
};

interface Props {
  a: BagEntry;
  b: BagEntry;
}

/**
 * What differs between two loaded bags: topics in only one, retyped topics,
 * and topics whose publish rate changed. Computed from the summaries alone.
 */
export function BagDiff({ a, b }: Props) {
  const openPanel = useLayoutStore((s) => s.openPanel);
  const [showSame, setShowSame] = useState(false);
  const [copied, setCopied] = useState(false);
  const diff = useMemo(() => diffBags(a.summary, b.summary), [a, b]);
  const differing = diff.rows.length - diff.counts.same;
  const rows = showSame ? diff.rows : diff.rows.filter((r) => r.kind !== 'same');

  const open = (t: TopicInfo | null, bagId: string) => {
    if (!t) return;
    openPanel({ kind: suggestPanelKind(t), topicName: t.name, type: t.type, bagId });
  };

  const copyReport = () => {
    void navigator.clipboard
      .writeText(diffToMarkdown(diff, a.summary.fileName, b.summary.fileName))
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => undefined);
  };

  const badge = (r: DiffRow) => (
    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] whitespace-nowrap ${KIND_STYLE[r.kind]}`}>
      {diffKindLabel(r.kind)}
    </span>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="bag-diff">
      <div className="px-3 py-2 border-b border-border text-xs flex flex-wrap items-center gap-x-4 gap-y-1 flex-shrink-0">
        <span className="mono">
          <span style={{ color: a.color }}>A</span> {a.summary.fileName} · {diff.durationA.toFixed(1)}s
        </span>
        <span className="mono">
          <span style={{ color: b.color }}>B</span> {b.summary.fileName} · {diff.durationB.toFixed(1)}s
        </span>
        <span className="text-text-muted ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} />
            show {diff.counts.same} matching
          </label>
          <button
            type="button"
            onClick={copyReport}
            className="px-2 py-0.5 rounded border border-border text-text-secondary hover:text-text-primary hover:border-border-hover transition-colors"
          >
            {copied ? 'Copied' : 'Copy report'}
          </button>
        </span>
      </div>

      {differing === 0 && !showSame && (
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm p-6" data-testid="diff-empty">
          No differences across {diff.counts.same} shared topics.
        </div>
      )}

      {rows.length > 0 && (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-surface/95 z-10">
              <tr className="border-b border-border text-text-muted text-left">
                <th className="py-2 px-3 font-medium">Topic</th>
                <th className="py-2 px-3 font-medium">Difference</th>
                <th className="py-2 px-3 font-medium">Detail</th>
                <th className="py-2 px-3 font-medium text-right">Open</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.topic} className="border-b border-border/50 hover:bg-surface-hover/40">
                  <td className="py-1.5 px-3 mono">{r.topic}</td>
                  <td className="py-1.5 px-3">{badge(r)}</td>
                  <td className="py-1.5 px-3 text-text-secondary">{r.detail}</td>
                  <td className="py-1.5 px-3 text-right whitespace-nowrap">
                    <button
                      type="button"
                      disabled={!r.a}
                      onClick={() => open(r.a, a.id)}
                      aria-label={`Open ${r.topic} from A`}
                      className="px-1.5 py-0.5 rounded border border-border text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      A
                    </button>{' '}
                    <button
                      type="button"
                      disabled={!r.b}
                      onClick={() => open(r.b, b.id)}
                      aria-label={`Open ${r.topic} from B`}
                      className="px-1.5 py-0.5 rounded border border-border text-text-muted hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      B
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
