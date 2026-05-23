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
