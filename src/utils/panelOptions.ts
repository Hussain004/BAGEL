/**
 * Which panel kinds a topic can be opened in.
 *
 * Extracted from `TopicRow.tsx`, which is where it originally lived and where
 * it drives the quick-open buttons on each sidebar row. The command palette
 * needs the exact same mapping to offer "Open /camera/image_raw in Image", and
 * a second copy would drift: a new panel kind would show up on the sidebar
 * buttons but be unreachable from the palette, which is precisely the kind of
 * silent inconsistency nobody notices until a user reports it.
 *
 * Kept dependency-free (no React, no stores) so it stays unit-testable and can
 * be imported by anything.
 */

import type { PanelKind } from '../store/layoutStore';
import type { TopicInfo } from '../types/bag';
import { isStateScalarType } from './stateSegments';
import {
  isCloudType,
  isDiagnosticArrayType,
  isImageType,
  isLaserScanType,
  isLogType,
  isMarkerArrayType,
  isMarkerType,
  isOccupancyGridType,
  isPathLikeType,
  isSplatType,
  isTfTopic,
  isTrajectoryCapableType,
} from './messages';

/**
 * Everything the UI says about a panel kind, in one place: add a kind to
 * `PanelKind` and TypeScript points here, and to `PANEL_COMPONENTS` in
 * `components/panels/registry.ts`, instead of at four scattered records.
 */
export const PANEL_META: Record<PanelKind, { label: string; paletteLabel: string; title: string }> = {
  plot: { label: 'Plot', paletteLabel: 'Plot', title: 'Open time-series plot' },
  image: { label: 'Image', paletteLabel: 'Image viewer', title: 'Open image viewer' },
  raw: { label: 'Raw', paletteLabel: 'Raw inspector', title: 'Open raw inspector' },
  trajectory: { label: 'Path', paletteLabel: 'Trajectory', title: 'Open 2D trajectory' },
  tf: { label: 'TF', paletteLabel: 'TF tree', title: 'Open TF tree' },
  '3d': { label: '3D', paletteLabel: '3D scene', title: 'Open 3D scene' },
  diagnostic: { label: 'Diag', paletteLabel: 'Diagnostics', title: 'Open diagnostic timeline' },
  log: { label: 'Log', paletteLabel: 'Log', title: 'Open log viewer' },
  health: { label: 'Health', paletteLabel: 'Bag health', title: 'Open bag health dashboard' },
  splat: { label: 'Splat', paletteLabel: 'Gaussian splat', title: 'Open gaussian splat viewer' },
  state: { label: 'State', paletteLabel: 'State timeline', title: 'Open state timeline' },
  search: { label: 'Find', paletteLabel: 'Find in messages', title: 'Find when a field meets a condition' },
};

const mapKinds = (pick: (m: (typeof PANEL_META)[PanelKind]) => string) =>
  Object.fromEntries(Object.entries(PANEL_META).map(([k, m]) => [k, pick(m)])) as Record<PanelKind, string>;

/** Short label for the sidebar quick buttons and palette rows. */
export const KIND_BUTTON_LABEL = mapKinds((m) => m.label);
/** Longer label used by the command palette, where there is room and no ambiguity. */
export const KIND_PALETTE_LABEL = mapKinds((m) => m.paletteLabel);
export const KIND_BUTTON_TITLE = mapKinds((m) => m.title);

/**
 * Pick the panel kind to open when the user single-clicks a topic.
 *
 * The default matters: clicking a point cloud should land you in the 3D view,
 * since that is the whole reason the bag is open.
 */
export function suggestPanelKind(topic: TopicInfo): PanelKind {
  if (isTfTopic(topic.name, topic.type)) return 'tf';
  if (isImageType(topic.type)) return 'image';
  if (isSplatType(topic.type)) return 'splat';
  // Bool / String carry no number to plot; a state lane is the only useful view.
  if (/^std_msgs\/(msg\/)?(Bool|String)$/.test(topic.type)) return 'state';
  if (isCloudType(topic.type) || isLaserScanType(topic.type)) return '3d';
  // MarkerArrays / Markers live in 3D space - there is no useful 2D view.
  if (isMarkerArrayType(topic.type) || isMarkerType(topic.type)) return '3d';
  // OccupancyGrid maps render as a textured plane in the 3D scene.
  if (isOccupancyGridType(topic.type)) return '3d';
  // Paths, pose arrays and polygons are geometry in the world frame.
  if (isPathLikeType(topic.type)) return '3d';
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
export function panelOptionsFor(topic: TopicInfo): PanelKind[] {
  if (isTfTopic(topic.name, topic.type)) return ['tf', 'raw'];
  if (isImageType(topic.type)) return ['image', 'raw'];
  if (isSplatType(topic.type)) return ['splat', 'raw'];
  // Integers are usually enums (a mode, a status code): offer both views.
  if (/^std_msgs\/(msg\/)?String$/.test(topic.type)) return ['state', 'raw', 'search'];
  if (isStateScalarType(topic.type)) return ['state', 'plot', 'raw', 'search'];
  if (isCloudType(topic.type)) return ['3d', 'raw'];
  if (isLaserScanType(topic.type)) return ['3d', 'plot', 'raw'];
  if (isMarkerArrayType(topic.type) || isMarkerType(topic.type)) return ['3d', 'raw'];
  if (isOccupancyGridType(topic.type)) return ['3d', 'raw'];
  if (isPathLikeType(topic.type)) return ['3d', 'raw'];
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
  // Everything else is a plain message of scalars (a battery, an IMU, a float):
  // exactly what "find when it crosses a value" is for. Images, clouds and
  // trajectories return earlier and do not get it: scanning them is heavy and
  // their fields are not what anyone searches.
  return ['plot', 'raw', 'search'];
}