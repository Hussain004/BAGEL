/**
 * Message manipulation utilities used by visualization panels.
 *
 * - flattenNumeric: collapse a nested message object into a flat
 *   `{ "linear.x": 0.5, ... }` form, suitable for plotting.
 * - nearestMessageIndex: binary-search messages (sorted by timestamp) for
 *   the one closest to a given playhead time.
 */

import type { DecodedMessage } from '../hooks/useTopicMessages';

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
  if (Array.isArray(obj)) {
    // Numeric typed arrays count as plottable per-element; skip large arrays.
    if (obj.length > 0 && obj.length <= 16 && obj.every((v) => typeof v === 'number')) {
      obj.forEach((v, i) => {
        out[`${prefix}[${i}]`] = v as number;
      });
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
    type.includes('sensor_msgs/CompressedImage')
  );
}

export function isCompressedImageType(type: string): boolean {
  return type.includes('CompressedImage');
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
 * True if a type is a "custom" list-of-points cloud — Livox CustomMsg and
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

/** True if a type is any point cloud the 3D scene can render. */
export function isCloudType(type: string): boolean {
  return isPointCloud2Type(type) || isCustomLidarType(type);
}

/** True if a ROS2 type is sensor_msgs/LaserScan. */
export function isLaserScanType(type: string): boolean {
  return type.endsWith('/LaserScan');
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
  // Pose-bearing types — we'll render them as a coordinate frame triad.
  return (
    type.endsWith('/Odometry') ||
    type.endsWith('/PoseStamped') ||
    type.endsWith('/PoseWithCovarianceStamped') ||
    type.endsWith('/TransformStamped')
  );
}

/**
 * True if a ROS type is a `visualization_msgs/MarkerArray`. The package
 * prefix is intentional — `MarkerArray` is rare enough as a name that an
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
