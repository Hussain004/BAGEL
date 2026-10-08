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

/** Short label for the sidebar quick buttons and palette rows. */
export const KIND_BUTTON_LABEL: Record<PanelKind, string> = {
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
  state: 'State',
  search: 'Find',
};

/** Longer label used by the command palette, where there is room and no ambiguity. */
export const KIND_PALETTE_LABEL: Record<PanelKind, string> = {
  plot: 'Plot',
  image: 'Image viewer',
  raw: 'Raw inspector',
  trajectory: 'Trajectory',
  tf: 'TF tree',
  '3d': '3D scene',
  diagnostic: 'Diagnostics',
  log: 'Log',
  health: 'Bag health',
  splat: 'Gaussian splat',
  state: 'State timeline',
  search: 'Find in messages',
};

export const KIND_BUTTON_TITLE: Record<PanelKind, string> = {
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
  state: 'Open state timeline',
  search: 'Find when a field meets a condition',
};

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