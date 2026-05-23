import { getTopicColor, getTypeCategory } from '../../../utils/color';
import type { TopicInfo } from '../../../types/bag';

/**
 * Type category to badge CSS class mapping
 */
const BADGE_CLASSES: Record<string, string> = {
  sensor_msgs: 'badge-cyan',
  geometry_msgs: 'badge-violet',
  nav_msgs: 'badge-emerald',
  std_msgs: 'badge-blue',
  tf2_msgs: 'badge-amber',
  rcl_interfaces: 'badge-slate',
  rosgraph_msgs: 'badge-slate',
};

interface TopicRowProps {
  topic: TopicInfo;
  index: number;
}

/**
 * TopicRow — A single topic row in the topic inspector.
 * Shows the topic name, message type badge, message count, and frequency.
 */
export function TopicRow({ topic, index }: TopicRowProps) {
  const color = getTopicColor(topic.name, topic.type);
  const category = getTypeCategory(topic.type);
  const badgeClass = BADGE_CLASSES[category] || 'badge-slate';

  // Extract short type name (e.g. "Imu" from "sensor_msgs/msg/Imu")
  const parts = topic.type.split('/');
  const shortType = parts[parts.length - 1] || topic.type;
  const packageName = parts[0] || '';

  return (
    <div
      className="topic-row flex items-center gap-3 opacity-0 animate-fade-in"
      style={{ animationDelay: `${Math.min(index * 0.04, 0.6)}s` }}
      id={`topic-row-${topic.name.replace(/\//g, '-')}`}
    >
      {/* Color indicator */}
      <div
        className="w-1.5 h-8 rounded-full flex-shrink-0 transition-all"
        style={{ backgroundColor: color }}
      />

      {/* Topic info */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2">
          <span className="mono text-text-primary text-sm font-medium truncate block">
            {topic.name}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 overflow-hidden">
          <span className={`badge ${badgeClass} flex-shrink-0`}>
            {packageName}
          </span>
          <span className="text-text-tertiary text-xs truncate">
            {shortType}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 flex-shrink-0 ml-2">
        {/* Message count */}
        <div className="text-right min-w-[55px]">
          <span className="text-text-primary text-sm font-medium mono">
            {topic.messageCount.toLocaleString()}
          </span>
          <span className="text-text-muted text-xs ml-1">msgs</span>
        </div>

        {/* Frequency */}
        {topic.frequency !== undefined && topic.frequency > 0 && (
          <div className="text-right min-w-[55px]">
            <span className="text-text-secondary text-xs mono">
              {topic.frequency.toFixed(1)}
            </span>
            <span className="text-text-muted text-xs ml-0.5">Hz</span>
          </div>
        )}
      </div>
    </div>
  );
}
