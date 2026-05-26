import { useState, useMemo } from 'react';
import { useBagStore } from '../../../store/bagStore';
import { TopicRow } from './TopicRow';

/**
 * TopicInspector — Main panel showing all topics in the loaded bag file.
 * Features search/filter, sorting, and summary stats.
 */
export function TopicInspector() {
  const { bag } = useBagStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'count' | 'frequency'>('name');

  const filteredTopics = useMemo(() => {
    if (!bag) return [];

    let topics = bag.topics;

    // Filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      topics = topics.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.type.toLowerCase().includes(q)
      );
    }

    // Sort
    switch (sortBy) {
      case 'name':
        topics = [...topics].sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'count':
        topics = [...topics].sort((a, b) => b.messageCount - a.messageCount);
        break;
      case 'frequency':
        topics = [...topics].sort(
          (a, b) => (b.frequency ?? 0) - (a.frequency ?? 0)
        );
        break;
    }

    return topics;
  }, [bag, searchQuery, sortBy]);

  if (!bag) return null;

  const activeTopicCount = bag.topics.filter((t) => t.messageCount > 0).length;

  return (
    <div className="flex-1 flex flex-col min-h-0 animate-fade-in-scale">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-text-primary">Topics</h2>
            <span className="badge badge-blue">
              {activeTopicCount} active
            </span>
            {bag.topics.length !== activeTopicCount && (
              <span className="text-text-muted text-xs">
                / {bag.topics.length} total
              </span>
            )}
          </div>

          {/* Sort buttons */}
          <div className="flex items-center gap-1">
            <SortButton
              label="Name"
              active={sortBy === 'name'}
              onClick={() => setSortBy('name')}
            />
            <SortButton
              label="Count"
              active={sortBy === 'count'}
              onClick={() => setSortBy('count')}
            />
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
            placeholder="Filter topics or types... (T)"
            className="w-full pl-10 pr-9 py-2 rounded-lg bg-surface border border-border text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-accent-blue/50 focus:ring-1 focus:ring-accent-blue/20 transition-all"
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
        className="flex-1 overflow-y-auto px-4 py-2 space-y-0.5"
        id="topic-list"
        role="list"
        aria-label={`${filteredTopics.length} topics`}
      >
        {filteredTopics.length > 0 ? (
          filteredTopics.map((topic, i) => (
            <TopicRow key={topic.name} topic={topic} index={i} />
          ))
        ) : (
          <div className="flex items-center justify-center h-32 text-text-muted text-sm">
            {searchQuery
              ? `No topics matching "${searchQuery}"`
              : 'No topics found in this bag file'}
          </div>
        )}
      </div>

      {/* Footer with result count */}
      {searchQuery && filteredTopics.length > 0 && (
        <div className="px-6 py-2 border-t border-border text-text-muted text-xs">
          Showing {filteredTopics.length} of {bag.topics.length} topics
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
      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
        active
          ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/20'
          : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover border border-transparent'
      }`}
    >
      {label}
    </button>
  );
}
