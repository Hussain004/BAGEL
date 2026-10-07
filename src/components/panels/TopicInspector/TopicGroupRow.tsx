import type { TopicTreeNode } from '../../../utils/topicTree';

/**
 * TopicGroupRow - one expandable namespace header in tree view.
 *
 * Carries the rolled-up count and Hz so a dead namespace reads as dead without
 * being expanded: `/robot1/sensors/lidar  0 msgs  0 Hz` is exactly the "where
 * did my sensor go" signal the flat list hides.
 *
 * Renders as a `<button>` for keyboard and screen-reader support rather than a
 * clickable div, matching how the multi-bag headers already work.
 */
export function TopicGroupRow({
  node,
  expanded,
  onToggle,
}: {
  node: TopicTreeNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={expanded}
      aria-label={`${node.label}, ${node.totalCount} messages${node.maxHz > 0 ? `, ${node.maxHz.toFixed(1)} Hz` : ''}`}
      className="topic-group-row w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
      style={{ paddingLeft: node.depth * 16 + 8 }}
    >
      <svg
        className={`w-3 h-3 flex-shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M8.59 16.34l4.58-4.59-4.58-4.59L10 5.75l6 6-6 6z" />
      </svg>
      <span className="mono font-medium truncate flex-1 text-left">{node.label}</span>
      <span className="text-text-muted text-[10px] flex-shrink-0 tabular-nums">
        {formatCount(node.totalCount)}
      </span>
      {node.maxHz > 0 && (
        <span className="text-text-muted text-[10px] flex-shrink-0 tabular-nums">
          {node.maxHz.toFixed(1)} Hz
        </span>
      )}
    </button>
  );
}

/** Compact count for a group header: 12, 1.4k, 23k. */
function formatCount(count: number): string {
  if (count >= 1000) {
    const rounded = (count / 1000).toFixed(count >= 10_000 ? 0 : 1);
    return `${rounded}k msgs`;
  }
  return `${count} msgs`;
}