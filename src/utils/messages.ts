/**
 * Message manipulation utilities used by visualization panels.
 *
 * - flattenNumeric: collapse a nested message object into a flat
 *   `{ "linear.x": 0.5, ... }` form, suitable for plotting.
 * - nearestMessageIndex: binary-search messages (sorted by timestamp) for
 *   the one closest to a given playhead time.
 */

import type { DecodedMessage } from '../hooks/useTopicMessages';
import { isVideoTopicName } from '../parsers/video';

/** Numeric leaf fields, in stable key order (dot-separated paths). */
export function flattenNumeric(
  obj: unknown,
  prefix = '',
  out: Record<string, number> = {},
): Record<string, number> {
  if (obj == null) return out;
  if (typeof obj === 'number' && Number.isFinite(obj)) {
    if (prefix) out[prefix] = obj;
    return out;
  }
  if (typeof obj === 'bigint') {
    if (prefix) out[prefix] = Number(obj);
    return out;
  }
  if (typeof obj === 'boolean') {
    if (prefix) out[prefix] = obj ? 1 : 0;
    return out;
  }
  // Arrays AND typed arrays (ArrayBuffer views) are handled here so neither
  // can fall through to Object.entries and emit unbounded `covariance.0`-style
  // dot-index keys. Bracket-index paths (`covariance[0]`) are what mathExpr's
  // identifier grammar resolves - see its "bracket-index notation" comment.
  //
  // Length caps (deliberate): plain arrays keep the historical 16-element
  // limit (longer numeric arrays are bulk data, e.g. image bytes, not
  // plottable series); typed arrays get 64 because the CDR MessageReader
  // deserializes fixed-size numeric arrays (float64[36] pose covariance)
  // into Float64Array, so a 6x6 covariance must flatten in full as
  // covariance[0..35] rather than be skipped.
  if (Array.isArray(obj) || ArrayBuffer.isView(obj)) {
    const arr = obj as unknown as ArrayLike<unknown>;
    // DataView (also an ArrayBuffer view) has no indexed elements.
    const len = typeof arr.length === 'number' ? arr.length : 0;
    const limit = ArrayBuffer.isView(obj) ? 64 : 16;
    if (len === 0 || len > limit) return out;
    // Skip arrays carrying any non-numeric element (historic behavior for
    // plain string/bool/object arrays); bigint leaves are coerced like the
    // scalar bigint branch above.
    for (let i = 0; i < len; i++) {
      const v = arr[i];
      if (typeof v !== 'number' && typeof v !== 'bigint') return out;
    }
    for (let i = 0; i < len; i++) {
      const v = arr[i];
      out[`${prefix}[${i}]`] = typeof v === 'bigint' ? Number(v) : (v as number);
    }
    return out;
  }
  if (typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      flattenNumeric(v, path, out);
    }
  }
  return out;
}

/** Binary search for the message whose timestamp is closest to `targetNs`. */
export function nearestMessageIndex(messages: DecodedMessage[], targetNs: bigint): number {
  if (messages.length === 0) return -1;
  let lo = 0;
  let hi = messages.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (messages[mid].timestamp < targetNs) lo = mid + 1;
    else hi = mid;
  }
  // lo is the first index with timestamp >= targetNs. Check the previous
  // index in case it's closer.
  if (lo > 0) {
    const a = messages[lo - 1].timestamp;
    const b = messages[lo].timestamp;
    if (targetNs - a < b - targetNs) return lo - 1;
  }
  return lo;
}

/** True if a ROS2 type name is a known image type. */
export function isImageType(type: string): boolean {
  return (
    type.includes('sensor_msgs/msg/Image') ||
    type.includes('sensor_msgs/Image') ||
    type.includes('sensor_msgs/msg/CompressedImage') ||
    type.includes('sensor_msgs/CompressedImage') ||
    type === 'foxglove.CompressedImage' ||
    type === 'foxglove.RawImage' ||
    type === 'foxglove.CompressedVideo'
  );
}

export function isCompressedImageType(type: string): boolean {
  return type.includes('CompressedImage') || type === 'foxglove.CompressedImage';
}

/** True if a type carries H264/H265 compressed video. */
export function isVideoType(type: string, topicName = ''): boolean {
  if (type === 'foxglove.CompressedVideo') return true;
  return isCompressedImageType(type) && isVideoTopicName(topicName);
}

/**
 * True if a ROS type is `sensor_msgs/CameraInfo` (v1.3.2). Used by the
 * `useCameraInfo` auto-pair to discover candidate intrinsics topics for
 * the ImageViewer overlay + 3D camera frustum.
 */
export function isCameraInfoType(type: string): boolean {
  if (!type) return false;
  return type.endsWith('/CameraInfo');
}

/** True if a ROS2 type carries planar pose data the Trajectory panel can render. */
export function isTrajectoryCapableType(type: string): boolean {
  return (
    type.endsWith('/Odometry') ||
    type.endsWith('/PoseStamped') ||
    type.endsWith('/PoseWithCovarianceStamped') ||
    type.endsWith('/Pose') ||
    type.endsWith('/Point') ||
    type.endsWith('/PointStamped') ||
    type.endsWith('/TransformStamped') ||
    type.endsWith('/NavSatFix')
  );
}

/** True if a topic carries a TF graph (tf2_msgs/TFMessage on /tf or /tf_static). */
export function isTfTopic(topicName: string, type: string): boolean {
  if (!type.endsWith('/TFMessage')) return false;
  return topicName === '/tf' || topicName === '/tf_static' || topicName.endsWith('/tf');
}

/** True if a ROS2 type is sensor_msgs/PointCloud2. */
export function isPointCloud2Type(type: string): boolean {
  return type.endsWith('/PointCloud2');
}

/**
 * True if a type is a "custom" list-of-points cloud - Livox CustomMsg and
 * any other vendor message that carries per-point x/y/z in a `points[]`
 * array of structs instead of PointCloud2's packed binary layout.
 *
 * Common cases:
 *   - livox_ros_driver2/msg/CustomMsg  (Livox MID/HAP/AVIA)
 *   - livox_ros_driver/msg/CustomMsg   (older Livox SDK)
 */
export function isCustomLidarType(type: string): boolean {
  if (!type) return false;
  return type.endsWith('/CustomMsg');
}

/**
 * Wider sibling of `isCustomLidarType`: also accepts vendor `/PointCloud`
 * type names (anything that says "PointCloud" plus a package prefix).
 *
 * Named distinctly because the two genuinely differ - `isCustomLidarType`
 * is what `isCloudType` (and therefore the scene/topic UI) uses, while this
 * one exists for callers that want the looser name match. Both live here so
 * type-name predicates have a single source of truth; `customCloud.ts`
 * re-exports `isCustomLidarType` from this module.
 */
export function isCustomLidarCapableType(type: string): boolean {
  if (!type) return false;
  return type.endsWith('/CustomMsg') || type.endsWith('/PointCloud');
}

/** True if a type is any point cloud the 3D scene can render. */
export function isCloudType(type: string): boolean {
  return isPointCloud2Type(type) || isCustomLidarType(type) || type === 'foxglove.PointCloud';
}

/**
 * True if a type is BAGEL's synthetic gaussian splat topic (see
 * `src/parsers/splat.ts`). Kept as its own check rather than folded into
 * `isCloudType` - splats need the dedicated SplatViewer panel, not the
 * point-cloud decoder, which has no room for opacity/scale/rotation/SH data.
 */
export function isSplatType(type: string): boolean {
  return type === 'gaussian/GaussianSplat';
}

/** True if a ROS2 type is sensor_msgs/LaserScan. */
export function isLaserScanType(type: string): boolean {
  return type.endsWith('/LaserScan') || type === 'foxglove.LaserScan';
}

/**
 * True if a ROS type is `nav_msgs/OccupancyGrid` - the standard ROS map
 * format produced by gmapping, slam_toolbox, cartographer, and every
 * navigation stack costmap publisher. We render it as a textured plane in
 * the 3D scene, posed by `info.origin` and TF-resolved to the world frame.
 */
export function isOccupancyGridType(type: string): boolean {
  if (!type) return false;
  return type.endsWith('/OccupancyGrid');
}

/**
 * True if the topic carries spatial data the ThreeDScene panel can render.
 *
 * Anything that produces a position in 3D space counts: full point clouds
 * (PointCloud2 and Livox-style list-of-points), LaserScans (we lift the
 * polar ring into XY at z=0), pose / odometry topics (rendered as
 * coordinate frame axes), and MarkerArray / Marker (the RViz primitive
 * set: arrows, cubes, lines, text…).
 */
export function is3DCapableType(type: string): boolean {
  if (isCloudType(type) || isLaserScanType(type)) return true;
  if (isMarkerArrayType(type) || isMarkerType(type)) return true;
  if (isOccupancyGridType(type)) return true;
  // Pose-bearing types - we'll render them as a coordinate frame triad.
  return (
    type.endsWith('/Odometry') ||
    type.endsWith('/PoseStamped') ||
    type.endsWith('/PoseWithCovarianceStamped') ||
    type.endsWith('/TransformStamped')
  );
}

/**
 * True if a ROS type is a `visualization_msgs/MarkerArray`. The package
 * prefix is intentional - `MarkerArray` is rare enough as a name that an
 * `endsWith` alone would catch typed registries from other packages too
 * loosely, and the ROS Marker spec is what we know how to render.
 */
export function isMarkerArrayType(type: string): boolean {
  if (!type) return false;
  return type.includes('visualization_msgs') && type.endsWith('/MarkerArray');
}

/**
 * True if a ROS type is a single `visualization_msgs/Marker`. Single
 * markers are rare in practice (almost everything ships as MarkerArray)
 * but they share the same render pipeline, so we accept either.
 */
export function isMarkerType(type: string): boolean {
  if (!type) return false;
  return type.includes('visualization_msgs') && type.endsWith('/Marker');
}

/**
 * True if a ROS type is `diagnostic_msgs/DiagnosticArray` - the standard
 * per-node health report every nav/perception stack publishes. v1.0 renders
 * it as a swimlane timeline (one row per component) + a "what's failing at
 * the playhead" inspector.
 */
export function isDiagnosticArrayType(type: string): boolean {
  if (!type) return false;
  return type.includes('diagnostic_msgs') && type.endsWith('/DiagnosticArray');
}

/**
 * True if a ROS type is a logging message - `rcl_interfaces/Log` (ROS2) or
 * `rosgraph_msgs/Log` (ROS1). v1.0 renders it as a virtualised, filterable
 * log list with severity + node filters.
 */
export function isLogType(type: string): boolean {
  if (!type) return false;
  return (
    type.endsWith('/Log') &&
    (type.includes('rcl_interfaces') || type.includes('rosgraph_msgs'))
  );
}
