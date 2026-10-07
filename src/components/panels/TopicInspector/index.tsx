import { useState, useMemo } from 'react';
import { useBagStore, type BagEntry } from '../../../store/bagStore';
import { useUiStore } from '../../../store/uiStore';
import { TopicRow } from './TopicRow';
import { TopicGroupRow } from './TopicGroupRow';
import {
  buildTopicTree,
  flattenTopicTree,
  type TopicTreeNode,
  type TopicTreeRow,
} from '../../../utils/topicTree';
import {
  countByCategory,
  topicCategoryOf,
  type CategoryCount,
} from '../../../utils/topicCategory';
import type { TopicInfo } from '../../../types/bag';

type SortBy = 'name' | 'count' | 'frequency';

/**
 * TopicInspector - Main panel showing all topics in every loaded bag.
 *
 * Features search/filter, sorting, type chips, and two views:
 *  - **flat** (the v0.9 list): every topic in one list, sorted as chosen.
 *  - **tree** (v1.8): topics grouped by namespace with single-child chains
 *    collapsed (`/robot1/sensors/lidar` is one row), group counts and Hz rolled
 *    up so a dead namespace is obvious at a glance.
 *
 * The view toggle and expansion state persist across sessions. A type-chip
 * filter applies to both views, and an active text search always renders a
 * flat list, since a tree of "the 4 topics containing 'imu'" is harder to
 * scan than the list it replaces.
 */
export function TopicInspector() {
  const bag = useBagStore((s) => s.bag);
  const bags = useBagStore((s) => s.bags);
  const bagOrder = useBagStore((s) => s.bagOrder);
  const focusBagId = useBagStore((s) => s.focusBagId);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const viewMode = useUiStore((s) => s.topicViewMode);
  const setViewMode = useUiStore((s) => s.setTopicViewMode);
  const expanded = useUiStore((s) => s.expandedTreeNodes);
  const toggleNode = useUiStore((s) => s.toggleTreeNode);
  const typeFilter = useUiStore((s) => s.topicTypeFilter);
  const setTypeFilter = useUiStore((s) => s.setTopicTypeFilter);

  // Type chips count against the unfiltered bag, not the current filter, so
  // the numbers always describe the bag rather than the filter's own result.
  const categoryCounts: CategoryCount[] = useMemo(() => {
    const all = bagOrder
      .map((id) => bags.get(id))
      .filter((e): e is BagEntry => !!e)
      .flatMap((e) => e.summary.topics);
    return countByCategory(all);
  }, [bags, bagOrder]);

  // Per-bag filtered + sorted topic lists.
  const sections = useMemo(() => {
    if (bagOrder.length === 0) return [];
    return bagOrder
      .map((id) => bags.get(id))
      .filter((e): e is BagEntry => !!e)
      .map((entry) => {
        let topics = entry.summary.topics;
        if (typeFilter) {
          topics = topics.filter((t) => topicCategoryOf(t) === typeFilter);
        }
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
  }, [bags, bagOrder, searchQuery, sortBy, typeFilter]);

  // Tree rows, one set per bag section, flattened against the persisted
  // expansion state. Built only in tree mode, so the flat view pays nothing.
  const treeSections = useMemo(() => {
    if (viewMode !== 'tree') return null;
    const compare = treeComparator(sortBy);
    return sections.map(({ entry, topics }) => ({
      entry,
      rows: flattenTopicTree(buildTopicTree(topics), expanded, compare),
    }));
  }, [viewMode, sections, expanded, sortBy]);

  if (!bag || sections.length === 0) return null;

  const multi = bagOrder.length > 1;
  const searching = searchQuery.trim().length > 0;
  // Search always renders flat: grouping a filtered handful of topics by
  // namespace makes a 4-result list harder to scan, not easier.
  const showTree = viewMode === 'tree' && !searching;
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
              aria-label="Clear topic filter"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* View toggle + type chips */}
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          <ViewToggle viewMode={viewMode} setViewMode={setViewMode} />
          {categoryCounts.map((chip) => (
            <button
              key={chip.id}
              onClick={() => setTypeFilter(typeFilter === chip.id ? null : chip.id)}
              aria-pressed={typeFilter === chip.id}
              className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                typeFilter === chip.id
                  ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/30'
                  : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover border border-transparent'
              }`}
            >
              {chip.label} {chip.count}
            </button>
          ))}
        </div>
      </div>

      <OnboardingHint />

      {/* Topic List */}
      <div
        className="flex-1 overflow-y-auto px-4 py-2 min-h-0"
        id="topic-list"
        role="list"
        aria-label={`${totalShown} topics`}
      >
        {totalShown > 0 ? (
          sections.map(({ entry, topics }, sectionIndex) => {
            const isCollapsed = collapsed[entry.id] === true;
            const treeRows = showTree && treeSections ? treeSections[sectionIndex].rows : null;
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
                    title={`${entry.summary.fileName} - ${topics.length} topic${
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
                    {treeRows
                      ? treeRows.map((row) => (
                          <TreeRow
                            key={row.node.path + (row.isGroup ? ':group' : ':topic')}
                            row={row}
                            bagId={multi ? entry.id : undefined}
                            index={0}
                            onToggle={toggleNode}
                            expanded={expanded}
                          />
                        ))
                      : topics.map((topic: TopicInfo, i: number) => (
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
              : typeFilter
                ? 'No topics in this category'
                : 'No topics found in any loaded bag'}
          </div>
        )}
      </div>

      {/* Footer with result count */}
      {(searchQuery || typeFilter) && totalShown > 0 && (
        <div className="px-6 py-2 border-t border-border text-text-muted text-xs">
          Showing {totalShown} of {totalAll} topics
        </div>
      )}
    </div>
  );
}

/** Comparator for tree levels, matching the sidebar's sort buttons. */
function treeComparator(sortBy: SortBy) {
  return (a: TopicTreeNode, b: TopicTreeNode): number => {
    if (sortBy === 'count') return b.totalCount - a.totalCount;
    if (sortBy === 'frequency') return b.maxHz - a.maxHz;
    return a.path.localeCompare(b.path);
  };
}

/** One row of the flattened tree, either a group header or a topic leaf. */
function TreeRow({
  row,
  bagId,
  index,
  onToggle,
  expanded,
}: {
  row: TopicTreeRow;
  bagId?: string;
  index: number;
  onToggle: (path: string) => void;
  expanded: ReadonlySet<string>;
}) {
  if (row.isGroup) {
    return (
      <TopicGroupRow
        node={row.node}
        expanded={expanded.has(row.node.path)}
        onToggle={() => onToggle(row.node.path)}
      />
    );
  }
  // Indent the leaf inside its group. TopicRow renders one topic row; the
  // padding belongs to the wrapper so the component stays untouched.
  return (
    <div style={{ paddingLeft: row.node.depth * 16 }}>
      <TopicRow topic={row.node.topic!} index={index} bagId={bagId} />
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

/** Flat / tree toggle, styled like the sort buttons so it reads as a peer. */
function ViewToggle({
  viewMode,
  setViewMode,
}: {
  viewMode: 'flat' | 'tree';
  setViewMode: (mode: 'flat' | 'tree') => void;
}) {
  return (
    <div className="flex items-center gap-0.5 mr-2" role="group" aria-label="Topic view">
      <button
        onClick={() => setViewMode('flat')}
        aria-pressed={viewMode === 'flat'}
        className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
          viewMode === 'flat'
            ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/30'
            : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover border border-transparent'
        }`}
      >
        List
      </button>
      <button
        onClick={() => setViewMode('tree')}
        aria-pressed={viewMode === 'tree'}
        className={`px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
          viewMode === 'tree'
            ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/30'
            : 'text-text-muted hover:text-text-secondary hover:bg-surface-hover border border-transparent'
        }`}
      >
        Tree
      </button>
    </div>
  );
}

/**
 * OnboardingHint - one-time coach line shown after the sample bag lands on
 * its curated layout (see applyCuratedSampleLayout in LandingPage.tsx). The
 * cockpit itself is the wow moment; this is the one sentence that says
 * "the rest of the sidebar is yours too."
 */
function OnboardingHint() {
  const show = useUiStore((s) => s.showOnboardingHint);
  const dismiss = useUiStore((s) => s.dismissOnboardingHint);
  if (!show) return null;
  return (
    <div
      role="note"
      className="mx-4 mb-2 flex items-start gap-2.5 p-3 rounded-lg bg-accent-blue/10 border border-accent-blue/20 animate-fade-in"
    >
      <p className="flex-1 text-text-secondary text-xs leading-relaxed">
        Click any topic to open more panels. Drag a panel header to rearrange them.
      </p>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="text-text-tertiary hover:text-text-primary flex-shrink-0 -mt-0.5"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}