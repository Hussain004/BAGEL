/**
 * PointCloud2 parsing helpers.
 *
 * `sensor_msgs/PointCloud2` is the trickiest standard message type to read:
 * the binary blob is a packed table of point records whose layout is
 * described by the `fields` array.
 *
 * Perf-critical path; runs in the worker for every playhead tick on
 * PointCloud2 topics. Key optimizations:
 *   - Pre-computed Turbo colormap LUT (lookup + interp, no per-point
 *     polynomial expansion).
 *   - Fast-path when x/y/z are all FLOAT32 — read directly through a
 *     Float32Array view into the message buffer (no DataView dispatch).
 *   - Optional caller-supplied output buffers so we can reuse Float32Arrays
 *     across frames when the point count is stable.
 *   - Default 250k-point subsample cap to keep typical Velodyne-32 /
 *     Ouster-64 frames decoding in a few ms.
 */

// PointField datatype enum from sensor_msgs/PointField.msg
export const POINT_FIELD_TYPE = {
  INT8: 1,
  UINT8: 2,
  INT16: 3,
  UINT16: 4,
  INT32: 5,
  UINT32: 6,
  FLOAT32: 7,
  FLOAT64: 8,
} as const;

export interface PointField {
  name: string;
  offset: number;
  datatype: number;
  count: number;
}

export interface PointCloud2Message {
  header?: { frame_id?: string; stamp?: { sec?: number; nanosec?: number } };
  height?: number;
  width?: number;
  fields?: PointField[];
  is_bigendian?: boolean;
  point_step?: number;
  row_step?: number;
  data?: Uint8Array;
  is_dense?: boolean;
}

export type ColorMode = 'intensity' | 'height' | 'rgb' | 'single';

export interface PointCloudExtraction {
  /** Flat Float32Array of [x0, y0, z0, x1, y1, z1, ...] in the message's local frame. */
  positions: Float32Array;
  /** Per-point RGB triplets [r0, g0, b0, ...] in [0, 1]. Always populated. */
  colors: Float32Array;
  /** Number of valid points (positions.length / 3). */
  pointCount: number;
  /** Set of field names that were present in the message. */
  fieldNames: string[];
  /** AABB in the message's local frame. */
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
  /** Frame this cloud was published in, from header.frame_id (or undefined). */
  frameId?: string;
}

/** Default cap on points per decode. Lower than the original 500k to keep
 *  per-frame work under ~10 ms on a typical machine. */
const DEFAULT_POINT_LIMIT = 250_000;

// ---------- Turbo colormap LUT ----------
// 1024 stops × 3 floats = 12 KB of memory, ~6× faster than evaluating the
// 6-term polynomial per point.
const TURBO_LUT_SIZE = 1024;
const TURBO_LUT_LAST = TURBO_LUT_SIZE - 1;
const TURBO_R = new Float32Array(TURBO_LUT_SIZE);
const TURBO_G = new Float32Array(TURBO_LUT_SIZE);
const TURBO_B = new Float32Array(TURBO_LUT_SIZE);
for (let i = 0; i < TURBO_LUT_SIZE; i++) {
  const x = i / TURBO_LUT_LAST;
  const x2 = x * x;
  const x3 = x2 * x;
  const x4 = x3 * x;
  const x5 = x4 * x;
  TURBO_R[i] = clamp01(
    0.13572138 +
      4.6153926 * x -
      42.66032258 * x2 +
      132.13108234 * x3 -
      152.94239396 * x4 +
      59.28637943 * x5,
  );
  TURBO_G[i] = clamp01(
    0.09140261 +
      2.19418839 * x +
      4.84296658 * x2 -
      14.18503333 * x3 +
      4.27729857 * x4 +
      2.82956604 * x5,
  );
  TURBO_B[i] = clamp01(
    0.1066733 +
      12.64194608 * x -
      60.58204836 * x2 +
      110.36276771 * x3 -
      89.90310912 * x4 +
      27.34824973 * x5,
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Lookup the Turbo color at `t` in [0, 1]. */
export function turboColor(t: number): { r: number; g: number; b: number } {
  const i =
    t <= 0 ? 0 : t >= 1 ? TURBO_LUT_LAST : Math.floor(t * TURBO_LUT_LAST);
  return { r: TURBO_R[i], g: TURBO_G[i], b: TURBO_B[i] };
}

/** Sized buffer pair so callers can reuse Float32Arrays across frames. */
export interface CloudBuffers {
  positions: Float32Array;
  colors: Float32Array;
}

/** Build (or recycle) output buffers sized for `pointCount` points. */
function takeBuffers(reuse: CloudBuffers | null, pointCount: number): CloudBuffers {
  const needed = pointCount * 3;
  if (reuse && reuse.positions.length === needed && reuse.colors.length === needed) {
    return reuse;
  }
  return {
    positions: new Float32Array(needed),
    colors: new Float32Array(needed),
  };
}

interface FieldReader {
  read: (view: DataView, offset: number) => number;
  size: number;
}

function makeFieldReader(datatype: number): FieldReader | null {
  switch (datatype) {
    case POINT_FIELD_TYPE.INT8:
      return { read: (v, o) => v.getInt8(o), size: 1 };
    case POINT_FIELD_TYPE.UINT8:
      return { read: (v, o) => v.getUint8(o), size: 1 };
    case POINT_FIELD_TYPE.INT16:
      return { read: (v, o) => v.getInt16(o, true), size: 2 };
    case POINT_FIELD_TYPE.UINT16:
      return { read: (v, o) => v.getUint16(o, true), size: 2 };
    case POINT_FIELD_TYPE.INT32:
      return { read: (v, o) => v.getInt32(o, true), size: 4 };
    case POINT_FIELD_TYPE.UINT32:
      return { read: (v, o) => v.getUint32(o, true), size: 4 };
    case POINT_FIELD_TYPE.FLOAT32:
      return { read: (v, o) => v.getFloat32(o, true), size: 4 };
    case POINT_FIELD_TYPE.FLOAT64:
      return { read: (v, o) => v.getFloat64(o, true), size: 8 };
    default:
      return null;
  }
}

export interface DecodeOptions {
  colorMode?: ColorMode;
  singleColor?: { r: number; g: number; b: number };
  /** Pre-allocated buffers to write into, reused when sized correctly. */
  reuse?: CloudBuffers | null;
  /** Hard cap on decoded point count. */
  maxPoints?: number;
}

/**
 * Decode a PointCloud2 binary blob into Float32Array positions + colors.
 *
 * Returns null if the message is malformed or doesn't carry x/y/z fields.
 * Output Float32Array buffers are transferable — the worker can ship them
 * to the main thread with zero copy.
 */
export function decodePointCloud2(
  msg: PointCloud2Message,
  options: DecodeOptions = {},
): PointCloudExtraction | null {
  if (!msg || !msg.fields || !msg.data) return null;
  const fields = msg.fields;
  const pointStep = msg.point_step;
  const data = msg.data;
  const width = msg.width ?? 0;
  const height = msg.height ?? 1;
  if (!pointStep || !data?.byteLength) return null;

  const xField = fields.find((f) => f.name === 'x');
  const yField = fields.find((f) => f.name === 'y');
  const zField = fields.find((f) => f.name === 'z');
  if (!xField || !yField || !zField) return null;

  const xReader = makeFieldReader(xField.datatype);
  const yReader = makeFieldReader(yField.datatype);
  const zReader = makeFieldReader(zField.datatype);
  if (!xReader || !yReader || !zReader) return null;

  const colorMode: ColorMode = options.colorMode ?? 'height';
  const intensityField =
    fields.find((f) => f.name === 'intensity') ?? fields.find((f) => f.name === 'i');
  const rgbField = fields.find((f) => f.name === 'rgb' || f.name === 'rgba');
  const ringField = fields.find((f) => f.name === 'ring');

  const intensityReader = intensityField ? makeFieldReader(intensityField.datatype) : null;
  const ringReader = ringField ? makeFieldReader(ringField.datatype) : null;

  const totalPoints = Math.min(width * height, Math.floor(data.byteLength / pointStep));
  const cap = options.maxPoints ?? DEFAULT_POINT_LIMIT;
  const stride = Math.max(1, Math.ceil(totalPoints / cap));
  const sampleCount = Math.ceil(totalPoints / stride);

  const buffers = takeBuffers(options.reuse ?? null, sampleCount);
  const positions = buffers.positions;
  const colors = buffers.colors;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // Fast path: x/y/z are all FLOAT32 → read through a Float32Array view, no
  // DataView dispatch. Common case for Velodyne, Ouster, RealSense, ZED.
  const xyzFastPath =
    xField.datatype === POINT_FIELD_TYPE.FLOAT32 &&
    yField.datatype === POINT_FIELD_TYPE.FLOAT32 &&
    zField.datatype === POINT_FIELD_TYPE.FLOAT32 &&
    // Float32Array requires a 4-byte aligned offset; nearly all PC2 fields are.
    (data.byteOffset & 3) === 0 &&
    (pointStep & 3) === 0 &&
    (xField.offset & 3) === 0 &&
    (yField.offset & 3) === 0 &&
    (zField.offset & 3) === 0;

  const f32 = xyzFastPath
    ? new Float32Array(data.buffer, data.byteOffset, data.byteLength >>> 2)
    : null;
  const pointStepF = pointStep >>> 2;
  const xOffF = xField.offset >>> 2;
  const yOffF = yField.offset >>> 2;
  const zOffF = zField.offset >>> 2;

  // Pre-pass: read positions and bounds.
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  let minIntensity = Infinity;
  let maxIntensity = -Infinity;
  let minRing = Infinity;
  let maxRing = -Infinity;

  const intensities =
    colorMode === 'intensity' && intensityReader ? new Float32Array(sampleCount) : null;
  const rings =
    colorMode === 'intensity' && !intensityReader && ringReader
      ? new Float32Array(sampleCount)
      : null;

  let validCount = 0;
  if (f32) {
    // FLOAT32 fast path.
    for (let i = 0; i < totalPoints; i += stride) {
      const baseF = i * pointStepF;
      const x = f32[baseF + xOffF];
      const y = f32[baseF + yOffF];
      const z = f32[baseF + zOffF];
      // Reject NaN/Inf and absurd values (Velodyne emits 0/0/0 or huge nums
      // for missed returns). One math op handles all three filters.
      if (
        !(x === x && y === y && z === z) ||
        x > 1e4 ||
        x < -1e4 ||
        y > 1e4 ||
        y < -1e4 ||
        z > 1e4 ||
        z < -1e4
      ) {
        continue;
      }
      const idx = validCount * 3;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;

      if (intensities && intensityReader && intensityField) {
        const v = intensityReader.read(view, i * pointStep + intensityField.offset);
        intensities[validCount] = v;
        if (v < minIntensity) minIntensity = v;
        if (v > maxIntensity) maxIntensity = v;
      } else if (rings && ringReader && ringField) {
        const v = ringReader.read(view, i * pointStep + ringField.offset);
        rings[validCount] = v;
        if (v < minRing) minRing = v;
        if (v > maxRing) maxRing = v;
      }

      if (colorMode === 'rgb' && rgbField) {
        const raw = view.getUint32(i * pointStep + rgbField.offset, true);
        const r = ((raw >> 16) & 0xff) / 255;
        const g = ((raw >> 8) & 0xff) / 255;
        const b = (raw & 0xff) / 255;
        colors[idx] = r;
        colors[idx + 1] = g;
        colors[idx + 2] = b;
      }
      validCount++;
    }
  } else {
    // Slow path: arbitrary datatypes via DataView.
    for (let i = 0; i < totalPoints; i += stride) {
      const base = i * pointStep;
      const x = xReader.read(view, base + xField.offset);
      const y = yReader.read(view, base + yField.offset);
      const z = zReader.read(view, base + zField.offset);
      if (
        !(x === x && y === y && z === z) ||
        x > 1e4 ||
        x < -1e4 ||
        y > 1e4 ||
        y < -1e4 ||
        z > 1e4 ||
        z < -1e4
      ) {
        continue;
      }
      const idx = validCount * 3;
      positions[idx] = x;
      positions[idx + 1] = y;
      positions[idx + 2] = z;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;

      if (intensities && intensityReader && intensityField) {
        const v = intensityReader.read(view, base + intensityField.offset);
        intensities[validCount] = v;
        if (v < minIntensity) minIntensity = v;
        if (v > maxIntensity) maxIntensity = v;
      } else if (rings && ringReader && ringField) {
        const v = ringReader.read(view, base + ringField.offset);
        rings[validCount] = v;
        if (v < minRing) minRing = v;
        if (v > maxRing) maxRing = v;
      }

      if (colorMode === 'rgb' && rgbField) {
        const raw = view.getUint32(base + rgbField.offset, true);
        const r = ((raw >> 16) & 0xff) / 255;
        const g = ((raw >> 8) & 0xff) / 255;
        const b = (raw & 0xff) / 255;
        colors[idx] = r;
        colors[idx + 1] = g;
        colors[idx + 2] = b;
      }
      validCount++;
    }
  }

  if (validCount === 0) return null;

  // Trim positions / colors if the actual count came in under the allocated
  // sample count. (Common when ~5% of returns are NaN.)
  const finalPositions =
    validCount === sampleCount ? positions : positions.slice(0, validCount * 3);
  const finalColors =
    validCount === sampleCount ? colors : colors.slice(0, validCount * 3);

  // Color the cloud based on the chosen mode.
  if (colorMode === 'height') {
    fillColorsByScalar(finalColors, validCount, (i) => finalPositions[i * 3 + 2], minZ, maxZ);
  } else if (colorMode === 'intensity') {
    if (intensities && Number.isFinite(minIntensity) && maxIntensity > minIntensity) {
      fillColorsByScalar(finalColors, validCount, (i) => intensities[i], minIntensity, maxIntensity);
    } else if (rings && Number.isFinite(minRing) && maxRing > minRing) {
      fillColorsByScalar(finalColors, validCount, (i) => rings[i], minRing, maxRing);
    } else {
      fillColorsByScalar(finalColors, validCount, (i) => finalPositions[i * 3 + 2], minZ, maxZ);
    }
  } else if (colorMode === 'single') {
    const c = options.singleColor ?? { r: 0.6, g: 0.85, b: 1.0 };
    for (let i = 0; i < validCount; i++) {
      finalColors[i * 3] = c.r;
      finalColors[i * 3 + 1] = c.g;
      finalColors[i * 3 + 2] = c.b;
    }
  }
  // colorMode === 'rgb' was already filled inline above.

  return {
    positions: finalPositions,
    colors: finalColors,
    pointCount: validCount,
    fieldNames: fields.map((f) => f.name),
    bounds: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
    frameId: msg.header?.frame_id,
  };
}

/**
 * Run a Turbo colormap over `pointCount` entries by indexing a scalar field
 * into the LUT directly. The hot inner loop is just LUT reads + writes —
 * no per-point function calls, no math beyond one subtract + divide.
 */
export function fillColorsByScalar(
  out: Float32Array,
  pointCount: number,
  read: (i: number) => number,
  min: number,
  max: number,
): void {
  const range = max - min;
  if (range <= 0) {
    // Degenerate (single height / single intensity). Paint mid-Turbo.
    const mid = TURBO_LUT_LAST >>> 1;
    const r = TURBO_R[mid];
    const g = TURBO_G[mid];
    const b = TURBO_B[mid];
    for (let i = 0; i < pointCount; i++) {
      const o = i * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
    return;
  }
  const scale = TURBO_LUT_LAST / range;
  for (let i = 0; i < pointCount; i++) {
    const v = read(i);
    let idx = ((v - min) * scale) | 0; // truncate to int
    if (idx < 0) idx = 0;
    else if (idx > TURBO_LUT_LAST) idx = TURBO_LUT_LAST;
    const o = i * 3;
    out[o] = TURBO_R[idx];
    out[o + 1] = TURBO_G[idx];
    out[o + 2] = TURBO_B[idx];
  }
}
