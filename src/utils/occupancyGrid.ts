/**
 * `nav_msgs/OccupancyGrid` decoding helpers.
 *
 * OccupancyGrid is the standard ROS map type (gmapping, slam_toolbox,
 * cartographer, costmap publishers). The wire format is a width x height
 * row-major `int8[]` where:
 *   - `-1`  → unknown
 *   - `0`   → free
 *   - `100` → occupied
 *   - `1…99` → partial-occupancy probability (cost maps use the full range)
 *
 * We convert that to an `RGBA` Uint8Array sized `width * height * 4` so the
 * ThreeDScene can upload it as a `THREE.DataTexture`. Colour mapping:
 *   - unknown → fully transparent
 *   - free    → white at 60% alpha (so the ground grid bleeds through)
 *   - 1…99    → linear ramp from white to dark grey at 85% alpha
 *   - occupied → near-black at 95% alpha
 *
 * The decoded buffer is uploaded to a single texture and reused across
 * playhead ticks; we only rebuild it when the underlying map data changes
 * (most SLAM maps publish at 1 Hz or less).
 */

export interface OccupancyGridMessage {
  header?: { frame_id?: string };
  info?: {
    width?: number;
    height?: number;
    resolution?: number;
    origin?: {
      position?: { x?: number; y?: number; z?: number };
      orientation?: { x?: number; y?: number; z?: number; w?: number };
    };
  };
  /** Row-major int8[]; typed arrays vary by serializer (Int8Array / number[]) */
  data?: ArrayLike<number>;
}

export interface OccupancyGridDecoded {
  width: number;
  height: number;
  /** Cell size in metres. */
  resolution: number;
  origin: {
    position: { x: number; y: number; z: number };
    orientation: { x: number; y: number; z: number; w: number };
  };
  /** RGBA, length = width * height * 4. */
  rgba: Uint8Array;
  /** Cheap content fingerprint used to short-circuit texture rebuilds. */
  contentKey: string;
}

/**
 * Heuristic FNV-1a fingerprint over the raw cell data + dimensions, used as
 * the rebuild key for the texture. Two distinct map publishes would have to
 * collide on length AND a sampled hash to share a key, vanishingly unlikely
 * for real SLAM output.
 */
function fingerprint(data: ArrayLike<number>, width: number, height: number): string {
  const len = data.length;
  if (len === 0) return `e:${width}x${height}`;
  const FNV_PRIME = 16777619;
  let h = 2166136261;
  const headEnd = Math.min(64, len);
  for (let i = 0; i < headEnd; i++) h = Math.imul(h ^ (data[i] & 0xff), FNV_PRIME);
  if (len > 256) {
    const mid = (len >> 1) - 32;
    for (let i = 0; i < 64; i++) h = Math.imul(h ^ (data[mid + i] & 0xff), FNV_PRIME);
  }
  if (len > 128) {
    const tail = len - 64;
    for (let i = 0; i < 64; i++) h = Math.imul(h ^ (data[tail + i] & 0xff), FNV_PRIME);
  }
  return `${width}x${height}:${len}|${(h >>> 0).toString(36)}`;
}

export function decodeOccupancyGrid(
  message: OccupancyGridMessage | null | undefined,
): OccupancyGridDecoded | null {
  if (!message) return null;
  const info = message.info;
  if (!info) return null;
  const width = Number(info.width);
  const height = Number(info.height);
  const resolution = Number(info.resolution);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  if (!Number.isFinite(resolution) || resolution <= 0) return null;
  const data = message.data;
  if (!data || data.length < width * height) return null;

  // Origin defaults follow the ROS spec: identity quaternion when missing.
  const origin = info.origin ?? {};
  const op = origin.position ?? {};
  const oq = origin.orientation ?? {};
  const position = {
    x: Number(op.x ?? 0),
    y: Number(op.y ?? 0),
    z: Number(op.z ?? 0),
  };
  const orientation = {
    x: Number(oq.x ?? 0),
    y: Number(oq.y ?? 0),
    z: Number(oq.z ?? 0),
    w: Number(oq.w ?? 1),
  };
  if (![position.x, position.y, position.z].every(Number.isFinite)) return null;
  if (![orientation.x, orientation.y, orientation.z, orientation.w].every(Number.isFinite)) {
    return null;
  }

  const rgba = new Uint8Array(width * height * 4);
  const total = width * height;
  for (let i = 0; i < total; i++) {
    // Some serializers hand back Uint8Array (positive 0…255) when the .msg
    // says int8; `(v << 24) >> 24` sign-extends so -1 stays -1.
    const raw = data[i];
    const v = (raw << 24) >> 24;
    const o = i * 4;
    if (v < 0) {
      // Unknown — fully transparent so the ground grid shows through.
      rgba[o] = 0;
      rgba[o + 1] = 0;
      rgba[o + 2] = 0;
      rgba[o + 3] = 0;
    } else if (v === 0) {
      // Free — light grey at 60% alpha. Pure white made the colour blend
      // too aggressively with the dark backdrop, washing out the occupied
      // pixels right next to it.
      rgba[o] = 240;
      rgba[o + 1] = 240;
      rgba[o + 2] = 240;
      rgba[o + 3] = 153; // ~60%
    } else if (v >= 100) {
      // Occupied — near-black at 95% alpha.
      rgba[o] = 10;
      rgba[o + 1] = 10;
      rgba[o + 2] = 10;
      rgba[o + 3] = 242;
    } else {
      // Partial — linear ramp from white (1) to dark grey (99). Cost-map
      // publishers fill the whole 1…99 range, so the ramp is meaningful.
      const t = v / 100;
      const g = Math.round(240 - 200 * t);
      rgba[o] = g;
      rgba[o + 1] = g;
      rgba[o + 2] = g;
      rgba[o + 3] = Math.round(153 + (242 - 153) * t);
    }
  }

  return {
    width,
    height,
    resolution,
    origin: { position, orientation },
    rgba,
    contentKey: fingerprint(data, width, height),
  };
}

/** True if a ROS type name is `nav_msgs/OccupancyGrid` (with or without `/msg/`). */
export function isOccupancyGridType(type: string): boolean {
  if (!type) return false;
  return type.endsWith('/OccupancyGrid');
}
