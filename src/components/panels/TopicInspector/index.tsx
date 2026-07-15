import { useState, useMemo } from 'react';
import { useBagStore, type BagEntry } from '../../../store/bagStore';
import { TopicRow } from './TopicRow';
import type { TopicInfo } from '../../../types/bag';

/**
 * TopicInspector — Main panel showing all topics in every loaded bag.
 *
 * Features search/filter, sorting, and summary stats. v0.9 multi-bag groups
 * topics by bag with collapsible per-bag headers (one section per loaded
 * bag). Single-bag setups keep the flat list — no extra chrome.
 */
export function TopicInspector() {
  const bag = useBagStore((s) => s.bag);
  const bags = useBagStore((s) => s.bags);
  const bagOrder = useBagStore((s) => s.bagOrder);
  const focusBagId = useBagStore((s) => s.focusBagId);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'count' | 'frequency'>('name');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Per-bag filtered + sorted topic lists. The empty-state below counts the
  // total across every bag for the "no matches" message.
  const sections = useMemo(() => {
    if (bagOrder.length === 0) return [];
    return bagOrder
      .map((id) => bags.get(id))
      .filter((e): e is BagEntry => !!e)
      .map((entry) => {
        let topics = entry.summary.topics;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          topics = topics.filter(
            (t) => t.name.toLowerCase().includes(q) || t.type.toLowerCase().includes(q),
          );
        }
        switch (sortBy) {
          case 'name':
            topics = [...topics].sort((a, b) => a.name.localeCompare(b.name));
            break;
          case 'count':
            topics = [...topics].sort((a, b) => b.messageCount - a.messageCount);
            break;
          case 'frequency':
            topics = [...topics].sort((a, b) => (b.frequency ?? 0) - (a.frequency ?? 0));
            break;
        }
        return { entry, topics };
      });
  }, [bags, bagOrder, searchQuery, sortBy]);

  if (!bag || sections.length === 0) return null;

  const multi = bagOrder.length > 1;
  const totalActive = sections.reduce(
    (acc, s) => acc + s.entry.summary.topics.filter((t) => t.messageCount > 0).length,
    0,
  );
  const totalAll = sections.reduce((acc, s) => acc + s.entry.summary.topics.length, 0);
  const totalShown = sections.reduce((acc, s) => acc + s.topics.length, 0);

  return (
    <div className="flex-1 flex flex-col min-h-0 animate-fade-in-scale">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-text-primary">Topics</h2>
            <span className="badge badge-blue">{totalActive} active</span>
            {totalAll !== totalActive && (
              <span className="text-text-muted text-xs">/ {totalAll} total</span>
            )}
          </div>

          {/* Sort buttons */}
          <div className="flex items-center gap-1">
            <SortButton label="Name" active={sortBy === 'name'} onClick={() => setSortBy('name')} />
            <SortButton label="Count" active={sortBy === 'count'} onClick={() => setSortBy('count')} />
            <SortButton
              label="Hz"
              active={sortBy === 'frequency'}
              onClick={() => setSortBy('frequency')}
            />
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter topics or types… (T)"
            className="w-full pl-10 pr-9 py-2 rounded-lg bg-surface border border-border text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-accent-blue/50 focus:ring-1 focus:ring-accent-blue/20 transition-colors"
            id="topic-search-input"
            aria-label="Filter topics"
            aria-controls="topic-list"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Topic List */}
      <div
        className="flex-1 overflow-y-auto px-4 py-2 min-h-0"
        id="topic-list"
        role="list"
        aria-label={`${totalShown} topics`}
      >
        {totalShown > 0 ? (
          sections.map(({ entry, topics }) => {
            const isCollapsed = collapsed[entry.id] === true;
            return (
              <div key={entry.id} className="mb-2">
                {multi && (
                  <button
                    onClick={() =>
                      setCollapsed((c) => ({ ...c, [entry.id]: !isCollapsed }))
                    }
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors sticky top-0 z-10 bg-bg-secondary/95 backdrop-blur-sm border-b border-border ${
                      entry.id === focusBagId
                        ? 'text-text-primary'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                    title={`${entry.summary.fileName} — ${topics.length} topic${
                      topics.length === 1 ? '' : 's'
                    } visible`}
                  >
                    <svg
                      className={`w-3 h-3 transition-transform ${
                        isCollapsed ? '' : 'rotate-90'
                      }`}
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M8.59 16.34l4.58-4.59-4.58-4.59L10 5.75l6 6-6 6z" />
                    </svg>
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: entry.color }}
                    />
                    <span className="mono font-medium truncate flex-1 text-left">
                      {entry.summary.fileName}
                    </span>
                    <span className="text-text-muted text-[10px] flex-shrink-0">
                      {topics.length}
                    </span>
                  </button>
                )}
                {!isCollapsed && (
                  <div className="space-y-0.5 mt-1">
                    {topics.map((topic: TopicInfo, i: number) => (
                      <TopicRow
                        key={`${entry.id}::${topic.name}`}
                        topic={topic}
                        index={i}
                        bagId={multi ? entry.id : undefined}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="flex items-center justify-center h-32 text-text-muted text-sm">
            {searchQuery
              ? `No topics matching "${searchQuery}"`
              : 'No topics found in any loaded bag'}
          </div>
        )}
      </div>

      {/* Footer with result count */}
      {searchQuery && totalShown > 0 && (
        <div className="px-6 py-2 border-t border-border text-text-muted text-xs">
          Showing {totalShown} of {totalAll} topics
        </div>
      )}
    </div>
  );
}

/** Sort toggle button */
function SortButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
        active
          ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/20'
          : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover border border-transparent'
      }`}
    >
      {label}
    </button>
  );
}
