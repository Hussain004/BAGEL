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
 * ThreeDScene can upload it as a `THREE.DataTexture`. Two colour schemes:
 *   - `map`: grayscale, tuned for SLAM/static maps.
 *   - `costmap`: matches rviz's built-in "costmap" `Color Scheme` for
 *     `rviz_default_plugins/Map` (`palette_builder.cpp`'s `makeCostmapPalette`),
 *     so a Nav2 costmap looks the same in BAGEL as it does in rviz - a
 *     blue→magenta cost gradient, cyan for the inscribed-inflated threshold
 *     (raw byte 99, nav2's rescale of costmap_2d::INSCRIBED_INFLATED_OBSTACLE),
 *     and magenta for lethal (raw byte 100, nav2's rescale of LETHAL_OBSTACLE).
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

export type OccupancyGridColorScheme = 'map' | 'costmap';

/** True when the topic name looks like a Nav2 costmap (`.../local_costmap/costmap`, `/global_costmap/costmap`, ...). */
export function isCostmapTopicName(topicName: string): boolean {
  return /costmap/i.test(topicName);
}

/** Resolves 'auto' against the topic name; explicit choices pass through unchanged. */
export function resolveOccupancyGridScheme(
  choice: OccupancyGridColorScheme | 'auto',
  topicName: string,
): OccupancyGridColorScheme {
  return choice === 'auto' ? (isCostmapTopicName(topicName) ? 'costmap' : 'map') : choice;
}

/**
 * Draw-order tier for a map-plane topic, so a base map, a global costmap,
 * and a local costmap can all be visible at once (stacked deterministically,
 * local costmap on top since it's the freshest obstacle data) instead of
 * flickering when their planes are coplanar. See `MAP_PLANE_RENDER_ORDER` in
 * mapPlane.ts, which this is keyed to match.
 */
export type MapPlaneTier = 'map' | 'globalCostmap' | 'localCostmap';

export function classifyMapPlaneTier(topicName: string): MapPlaneTier {
  if (/local_costmap/i.test(topicName)) return 'localCostmap';
  if (isCostmapTopicName(topicName)) return 'globalCostmap';
  return 'map';
}

/**
 * Port of rviz_default_plugins' `makeCostmapPalette()` (palette_builder.cpp),
 * indexed by the cell's raw unsigned byte (0…255, where 255 is the `-1`
 * "unknown" sentinel). Nav2's costmap publisher rescales its internal
 * 0…255 cost byte to this same 0…100(+255) OccupancyGrid range, with 99
 * meaning `INSCRIBED_INFLATED_OBSTACLE` and 100 meaning `LETHAL_OBSTACLE` -
 * so this indexing lines up with real Nav2 costmap topics out of the box.
 */
function buildCostmapPalette(): Uint8Array {
  const p = new Uint8Array(256 * 4);
  const set = (i: number, r: number, g: number, b: number, a: number): void => {
    const o = i * 4;
    p[o] = r;
    p[o + 1] = g;
    p[o + 2] = b;
    p[o + 3] = a;
  };
  set(0, 0, 0, 0, 0); // free - transparent
  for (let i = 1; i <= 98; i++) {
    // Blue (low cost) -> magenta (approaching inscribed-inflated).
    const v = Math.round((255 * i) / 100);
    set(i, v, 0, 255 - v, 255);
  }
  set(99, 0, 255, 255, 255); // inscribed inflated obstacle - cyan
  set(100, 255, 0, 255, 255); // lethal obstacle - magenta
  for (let i = 101; i <= 127; i++) set(i, 0, 255, 0, 255); // illegal positive values - green
  for (let i = 128; i <= 254; i++) {
    // Illegal negative values - red to yellow.
    const g = Math.round((255 * (i - 128)) / (254 - 128));
    set(i, 255, g, 0, 255);
  }
  set(255, 0x70, 0x89, 0x86, 255); // unknown (-1)
  return p;
}

const COSTMAP_PALETTE = buildCostmapPalette();

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
  scheme: OccupancyGridColorScheme = 'map',
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
    const raw = data[i];
    const o = i * 4;

    if (scheme === 'costmap') {
      // Unsigned byte index (raw & 0xff turns -1 into 255, matching the
      // palette's "unknown" slot) - see buildCostmapPalette's doc comment.
      const po = (raw & 0xff) * 4;
      rgba[o] = COSTMAP_PALETTE[po];
      rgba[o + 1] = COSTMAP_PALETTE[po + 1];
      rgba[o + 2] = COSTMAP_PALETTE[po + 2];
      rgba[o + 3] = COSTMAP_PALETTE[po + 3];
      continue;
    }

    // Some serializers hand back Uint8Array (positive 0…255) when the .msg
    // says int8; `(v << 24) >> 24` sign-extends so -1 stays -1.
    const v = (raw << 24) >> 24;
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
