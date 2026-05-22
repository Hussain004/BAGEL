/**
 * Topic color assignment utilities.
 * Generates deterministic, visually distinct colors for topics.
 */

/** Curated color palette for topic categories */
const TYPE_CATEGORY_COLORS: Record<string, string> = {
  'sensor_msgs': '#06b6d4',     // cyan
  'geometry_msgs': '#8b5cf6',   // violet
  'nav_msgs': '#10b981',        // emerald
  'std_msgs': '#6366f1',        // indigo
  'tf2_msgs': '#f59e0b',        // amber
  'visualization_msgs': '#ec4899', // pink
  'diagnostic_msgs': '#f97316', // orange
  'rcl_interfaces': '#64748b',  // slate
  'rosgraph_msgs': '#64748b',   // slate
  'actionlib_msgs': '#ef4444',  // red
};

/** Fallback palette for topics with unknown type categories */
const FALLBACK_COLORS = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1',
  '#14b8a6', '#e11d48', '#a855f7', '#0ea5e9', '#d946ef',
];

/** Simple string hash function */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

/**
 * Get a deterministic color for a topic based on its message type.
 * Topics with the same message type package get the same category color.
 */
export function getTopicColor(topicName: string, msgType?: string): string {
  if (msgType) {
    const pkg = msgType.split('/')[0];
    if (pkg && TYPE_CATEGORY_COLORS[pkg]) {
      return TYPE_CATEGORY_COLORS[pkg];
    }
  }
  const hash = hashString(topicName);
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

/**
 * Get a human-readable label for a message type category
 */
export function getTypeCategory(msgType: string): string {
  const parts = msgType.split('/');
  return parts[0] || 'unknown';
}
