import { getTopicColor, getTypeCategory } from '../../../utils/color';
import {
  isCloudType,
  isDiagnosticArrayType,
  isImageType,
  isLaserScanType,
  isLogType,
  isMarkerArrayType,
  isMarkerType,
  isOccupancyGridType,
  isSplatType,
  isTfTopic,
  isTrajectoryCapableType,
} from '../../../utils/messages';
import { useLayoutStore, type PanelKind } from '../../../store/layoutStore';
import { useBagStore } from '../../../store/bagStore';
import { useUiStore } from '../../../store/uiStore';
import { useSchemaResolution } from '../../../hooks/useSchemaResolution';
import type { TopicInfo } from '../../../types/bag';

const BADGE_CLASSES: Record<string, string> = {
  sensor_msgs: 'badge-cyan',
  geometry_msgs: 'badge-violet',
  nav_msgs: 'badge-emerald',
  std_msgs: 'badge-blue',
  tf2_msgs: 'badge-amber',
  visualization_msgs: 'badge-pink',
  rcl_interfaces: 'badge-slate',
  rosgraph_msgs: 'badge-slate',
};

interface TopicRowProps {
  topic: TopicInfo;
  index: number;
  /**
   * Which bag this row was rendered against. Drives the panel id when the
   * user opens a visualization — multi-bag setups (>1 bag loaded) thread
   * this in from the sidebar so the resulting panel reads from the right
   * bag regardless of which one is currently focused.
   */
  bagId?: string;
}

/** Pick the panel kind to open when the user single-clicks a topic. */
function suggestPanelKind(topic: TopicInfo): PanelKind {
  if (isTfTopic(topic.name, topic.type)) return 'tf';
  if (isImageType(topic.type)) return 'image';
  if (isSplatType(topic.type)) return 'splat';
  // Point cloud-ish topics default to the 3D view — that's the whole point.
  if (isCloudType(topic.type) || isLaserScanType(topic.type)) return '3d';
  // MarkerArrays / Markers live in 3D space — there is no useful 2D view.
  if (isMarkerArrayType(topic.type) || isMarkerType(topic.type)) return '3d';
  // OccupancyGrid maps render as a textured plane in the 3D scene.
  if (isOccupancyGridType(topic.type)) return '3d';
  // Diagnostics and Log topics get their dedicated panels (v1.0).
  if (isDiagnosticArrayType(topic.type)) return 'diagnostic';
  if (isLogType(topic.type)) return 'log';
  // For pose-only types (Pose, Point, TransformStamped) plot has nothing
  // useful to show; jump straight to the trajectory view.
  if (
    isTrajectoryCapableType(topic.type) &&
    !topic.type.endsWith('/Odometry') &&
    !topic.type.endsWith('/PoseStamped') &&
    !topic.type.endsWith('/PoseWithCovarianceStamped') &&
    !topic.type.endsWith('/NavSatFix')
  ) {
    return 'trajectory';
  }
  return 'plot';
}

/** The panel kinds that should appear as quick buttons for a given topic. */
function panelOptionsFor(topic: TopicInfo): PanelKind[] {
  if (isTfTopic(topic.name, topic.type)) return ['tf', 'raw'];
  if (isImageType(topic.type)) return ['image', 'raw'];
  if (isSplatType(topic.type)) return ['splat', 'raw'];
  if (isCloudType(topic.type)) return ['3d', 'raw'];
  if (isLaserScanType(topic.type)) return ['3d', 'plot', 'raw'];
  if (isMarkerArrayType(topic.type) || isMarkerType(topic.type)) {
    return ['3d', 'raw'];
  }
  if (isOccupancyGridType(topic.type)) {
    return ['3d', 'raw'];
  }
  if (isDiagnosticArrayType(topic.type)) return ['diagnostic', 'raw'];
  if (isLogType(topic.type)) return ['log', 'raw'];
  if (
    isTrajectoryCapableType(topic.type) &&
    (topic.type.endsWith('/Odometry') ||
      topic.type.endsWith('/PoseStamped') ||
      topic.type.endsWith('/PoseWithCovarianceStamped') ||
      topic.type.endsWith('/TransformStamped'))
  ) {
    return ['trajectory', '3d', 'plot', 'raw'];
  }
  if (isTrajectoryCapableType(topic.type)) return ['trajectory', 'plot', 'raw'];
  return ['plot', 'raw'];
}

const KIND_BUTTON_LABEL: Record<PanelKind, string> = {
  plot: 'Plot',
  image: 'Image',
  raw: 'Raw',
  trajectory: 'Path',
  tf: 'TF',
  '3d': '3D',
  diagnostic: 'Diag',
  log: 'Log',
  health: 'Health',
  splat: 'Splat',
};

const KIND_BUTTON_TITLE: Record<PanelKind, string> = {
  plot: 'Open time-series plot',
  image: 'Open image viewer',
  raw: 'Open raw inspector',
  trajectory: 'Open 2D trajectory',
  tf: 'Open TF tree',
  '3d': 'Open 3D scene',
  diagnostic: 'Open diagnostic timeline',
  log: 'Open log viewer',
  health: 'Open bag health dashboard',
  splat: 'Open gaussian splat viewer',
};

/**
 * Per-topic label override for the panel button. OccupancyGrid topics get
 * `Map` instead of the generic `3D` since "the 3D scene" isn't what users
 * are looking for when they click /map — they want to see the SLAM output
 * rendered as a textured plane.
 */
function buttonLabelFor(topic: TopicInfo, kind: PanelKind): string {
  if (kind === '3d' && isOccupancyGridType(topic.type)) return 'Map';
  return KIND_BUTTON_LABEL[kind];
}

function buttonTitleFor(topic: TopicInfo, kind: PanelKind): string {
  if (kind === '3d' && isOccupancyGridType(topic.type)) {
    return 'Open occupancy-grid map in 3D scene';
  }
  return KIND_BUTTON_TITLE[kind];
}

export function TopicRow({ topic, index, bagId }: TopicRowProps) {
  const color = getTopicColor(topic.name, topic.type);
  const category = getTypeCategory(topic.type);
  const badgeClass = BADGE_CLASSES[category] || 'badge-slate';

  const parts = topic.type.split('/');
  const shortType = parts[parts.length - 1] || topic.type;
  const packageName = parts[0] || '';

  const openPanel = useLayoutStore((s) => s.openPanel);
  const hasOpenPanel = useLayoutStore((s) =>
    s.hasPanelForTopic(topic.name, bagId),
  );
  // Look up the format from the specific bag this row was rendered against,
  // not the focused bag — multi-bag setups can mix mcap/db3/bag.
  const format = useBagStore(
    (s) =>
      (bagId ? s.bags.get(bagId)?.summary.format : null) ?? s.bag?.format,
  );
  const openSchemaPaste = useUiStore((s) => s.openSchemaPaste);

  // Schema availability check — only `.db3` topics can be schema-missing.
  // mcap / bag short-circuit to resolved.
  const { resolved, loading: schemaLoading } = useSchemaResolution(topic.type, format);
  const schemaMissing = !resolved && !schemaLoading;

  const handleOpen = (kind: PanelKind) => {
    if (schemaMissing) {
      openSchemaPaste({
        typeName: topic.type,
        topicName: topic.name,
        followupPanelKind: kind,
        bagId,
      });
      return;
    }
    openPanel({ kind, topicName: topic.name, type: topic.type, bagId });
  };

  const defaultKind = suggestPanelKind(topic);
  const buttonKinds = panelOptionsFor(topic);

  const hasFrequency = topic.frequency !== undefined && topic.frequency > 0;

  return (
    <div
      className="topic-row relative flex items-center gap-3 opacity-0 animate-fade-in group cursor-pointer"
      style={{ animationDelay: `${Math.min(index * 0.04, 0.6)}s` }}
      id={`topic-row-${topic.name.replace(/\//g, '-')}`}
      title={
        schemaMissing
          ? `${topic.name}\n${topic.type}\n\nSchema missing — click to paste the .msg definition.`
          : `${topic.name}\n${topic.type}`
      }
      onClick={() => handleOpen(defaultKind)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleOpen(defaultKind);
        }
      }}
      role="listitem"
      tabIndex={0}
      aria-label={`${topic.name}, ${topic.type}, ${topic.messageCount} messages${
        hasFrequency ? `, ${topic.frequency!.toFixed(1)} Hz` : ''
      }${schemaMissing ? ', schema missing' : ''}`}
    >
      <div
        className={`w-1.5 h-8 rounded-full flex-shrink-0 transition-opacity ${
          schemaMissing ? 'opacity-30' : ''
        }`}
        style={{ backgroundColor: color }}
      />

      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2">
          <span
            className={`mono text-sm font-medium truncate block ${
              schemaMissing ? 'text-text-tertiary' : 'text-text-primary'
            }`}
          >
            {topic.name}
          </span>
          {hasOpenPanel && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-accent-blue flex-shrink-0"
              title="Panel open for this topic"
            />
          )}
          {schemaMissing && (
            <span
              className="badge badge-amber flex-shrink-0 cursor-pointer"
              title="No .msg definition for this type. Click to paste one."
            >
              schema missing
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 overflow-hidden">
          <span className={`badge ${badgeClass} flex-shrink-0`}>{packageName}</span>
          <span className="text-text-tertiary text-xs truncate">{shortType}</span>
        </div>
      </div>

      {/* Stats column — fixed-width slots so msgs/Hz line up vertically across
          every row and sit flush against the right edge of the sidebar. The
          Hz slot is always rendered (invisible when the topic has no rate)
          so rows without a frequency don't shift their msgs column left. */}
      <div className="flex items-center gap-4 flex-shrink-0 ml-2 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0 pointer-events-none">
        <div className="text-right min-w-[60px] whitespace-nowrap">
          <span className="text-text-primary text-sm font-medium mono">
            {topic.messageCount.toLocaleString()}
          </span>
          <span className="text-text-muted text-xs ml-1">msgs</span>
        </div>

        <div
          className={`text-right min-w-[55px] whitespace-nowrap ${hasFrequency ? '' : 'invisible'}`}
        >
          <span className="text-text-secondary text-xs mono">
            {hasFrequency ? topic.frequency!.toFixed(1) : '0.0'}
          </span>
          <span className="text-text-muted text-xs ml-0.5">Hz</span>
        </div>
      </div>

      {/* Hover-only panel buttons. Absolute so they never push the stats
          column left — the data stays anchored to the right edge while the
          buttons fade in on top of it. Schema-missing topics show a single
          "Add schema" affordance instead of the panel set, since opening
          panels with no decoder is just confusing. */}
      <div
        className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-10"
        onClick={(e) => e.stopPropagation()}
      >
        {schemaMissing ? (
          <PanelButton
            label="Add schema"
            title="Paste the .msg definition for this type"
            onClick={() =>
              openSchemaPaste({
                typeName: topic.type,
                topicName: topic.name,
                followupPanelKind: defaultKind,
                bagId,
              })
            }
            accent
          />
        ) : (
          buttonKinds.map((kind) => (
            <PanelButton
              key={kind}
              label={buttonLabelFor(topic, kind)}
              title={buttonTitleFor(topic, kind)}
              onClick={() => handleOpen(kind)}
              accent={kind === defaultKind}
            />
          ))
        )}
      </div>
    </div>
  );
}

function PanelButton({
  label,
  title,
  onClick,
  accent,
}: {
  label: string;
  title: string;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`px-2 py-1 rounded-md text-[10px] font-medium mono border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60 ${
        accent
          ? 'bg-accent-blue/10 border-accent-blue/40 text-accent-blue hover:bg-accent-blue/15'
          : 'bg-surface border-border hover:border-accent-blue/40 hover:text-accent-blue text-text-secondary'
      }`}
    >
      {label}
    </button>
  );
}
