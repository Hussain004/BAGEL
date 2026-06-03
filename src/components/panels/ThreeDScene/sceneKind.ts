/**
 * The set of distinct render paths the ThreeDScene panel hosts.
 *
 * Extracted from `index.tsx` so the per-data-type defaults store (v1.3.3)
 * can key its persisted entries by the same enum the panel uses, without
 * importing the giant panel module.
 */

import {
  isCloudType,
  isLaserScanType,
  isMarkerArrayType,
  isMarkerType,
  isOccupancyGridType,
} from '../../../utils/messages';

export type SceneKind =
  | 'pointcloud'
  | 'laserscan'
  | 'pose'
  | 'markerarray'
  | 'occupancygrid';

export const SCENE_KINDS: readonly SceneKind[] = [
  'pointcloud',
  'laserscan',
  'pose',
  'markerarray',
  'occupancygrid',
] as const;

/** Human-readable label used in user-facing copy (e.g. "Save as default for PointCloud2"). */
export const SCENE_KIND_LABELS: Record<SceneKind, string> = {
  pointcloud: 'PointCloud2',
  laserscan: 'LaserScan',
  pose: 'Pose',
  markerarray: 'MarkerArray',
  occupancygrid: 'OccupancyGrid',
};

/**
 * Map a ROS message type name to the scene render path that should host it.
 *
 *  - MarkerArray (and the rare single Marker) take the marker path - the
 *    primitives are heterogeneous and don't share the cloud/pose code at all.
 *  - sensor_msgs/PointCloud2 and list-of-points clouds (Livox CustomMsg etc.)
 *    share the same render pipeline once the worker has produced typed
 *    arrays, so they collapse onto 'pointcloud'.
 *  - SLAM-produced maps render as a textured plane in the world frame.
 *  - Everything else falls back to 'pose' (geometry_msgs/Pose, Odometry,
 *    TransformStamped, ...).
 */
export function detectKind(type: string): SceneKind {
  if (isMarkerArrayType(type) || isMarkerType(type)) return 'markerarray';
  if (isCloudType(type)) return 'pointcloud';
  if (isLaserScanType(type)) return 'laserscan';
  if (isOccupancyGridType(type)) return 'occupancygrid';
  return 'pose';
}
