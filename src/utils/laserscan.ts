/**
 * LaserScan decode helpers, mirroring the PointCloud2 pipeline.
 *
 * Converts polar `(range, angle)` returns to flat `Float32Array` positions
 * lifted into the XY plane at `z=0`, plus a colour buffer keyed by distance
 * from the sensor. Output buffers are Float32Array so the worker can ship
 * them across as transferables.
 */

import { turboColor } from './pointcloud';

export interface LaserScanMessage {
  header?: { frame_id?: string; stamp?: { sec?: number; nanosec?: number } };
  angle_min?: number;
  angle_max?: number;
  angle_increment?: number;
  range_min?: number;
  range_max?: number;
  ranges?: number[] | Float32Array;
  intensities?: number[] | Float32Array;
}

export interface LaserScanExtraction {
  positions: Float32Array;
  colors: Float32Array;
  pointCount: number;
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
  frameId?: string;
}

export function decodeLaserScan(msg: LaserScanMessage): LaserScanExtraction | null {
  if (!msg || !msg.ranges || msg.angle_increment === undefined) return null;
  const ranges = msg.ranges;
  const angleMin = Number(msg.angle_min ?? 0);
  const angleInc = Number(msg.angle_increment);
  const rangeMin = Number(msg.range_min ?? 0);
  const rangeMax = Number(msg.range_max ?? Infinity);

  // Worst-case sizing: every return is valid.
  const positions = new Float32Array(ranges.length * 3);
  const colors = new Float32Array(ranges.length * 3);

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  let count = 0;
  let maxR = 0;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (!Number.isFinite(r) || r < rangeMin || r > rangeMax) continue;
    const a = angleMin + i * angleInc;
    const x = r * Math.cos(a);
    const y = r * Math.sin(a);
    const idx = count * 3;
    positions[idx] = x;
    positions[idx + 1] = y;
    positions[idx + 2] = 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (r > maxR) maxR = r;
    count++;
  }

  if (count === 0) return null;

  const inv = maxR > 0 ? 1 / maxR : 0;
  for (let i = 0; i < count; i++) {
    const o = i * 3;
    const x = positions[o];
    const y = positions[o + 1];
    const r = Math.hypot(x, y);
    const c = turboColor(r * inv);
    colors[o] = c.r;
    colors[o + 1] = c.g;
    colors[o + 2] = c.b;
  }

  return {
    positions: count === ranges.length ? positions : positions.slice(0, count * 3),
    colors: count === ranges.length ? colors : colors.slice(0, count * 3),
    pointCount: count,
    bounds: {
      min: { x: minX, y: minY, z: 0 },
      max: { x: maxX, y: maxY, z: 0 },
    },
    frameId: msg.header?.frame_id,
  };
}
