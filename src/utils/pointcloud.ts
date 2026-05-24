/**
 * PointCloud2 parsing helpers.
 *
 * `sensor_msgs/PointCloud2` is the trickiest standard message type to read:
 * the binary blob is a packed table of point records whose layout is
 * described by the `fields` array. Each field has a name, a byte offset,
 * a datatype (one of the PointField constants), and a count.
 *
 * Here we walk the table once per message, extract x/y/z into a
 * `Float32Array` of triplets, and optionally pull an intensity or RGB
 * value out for color mapping. We try to keep allocations down because
 * a single VLP-16 frame is ~28k points and a single Ouster OS-1 frame is
 * ~131k points; per-playhead-step churn matters.
 */
import type { Vec3 } from '../components/panels/TFTree/useTFGraph';

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
  bounds: { min: Vec3; max: Vec3 } | null;
  /** Frame this cloud was published in, from header.frame_id (or undefined). */
  frameId?: string;
}

interface FieldReader {
  read: (view: DataView, offset: number) => number;
  size: number;
}

const LE = true; // ROS2 CDR uses little-endian on every modern platform.

function makeFieldReader(datatype: number): FieldReader | null {
  switch (datatype) {
    case POINT_FIELD_TYPE.INT8:
      return { read: (v, o) => v.getInt8(o), size: 1 };
    case POINT_FIELD_TYPE.UINT8:
      return { read: (v, o) => v.getUint8(o), size: 1 };
    case POINT_FIELD_TYPE.INT16:
      return { read: (v, o) => v.getInt16(o, LE), size: 2 };
    case POINT_FIELD_TYPE.UINT16:
      return { read: (v, o) => v.getUint16(o, LE), size: 2 };
    case POINT_FIELD_TYPE.INT32:
      return { read: (v, o) => v.getInt32(o, LE), size: 4 };
    case POINT_FIELD_TYPE.UINT32:
      return { read: (v, o) => v.getUint32(o, LE), size: 4 };
    case POINT_FIELD_TYPE.FLOAT32:
      return { read: (v, o) => v.getFloat32(o, LE), size: 4 };
    case POINT_FIELD_TYPE.FLOAT64:
      return { read: (v, o) => v.getFloat64(o, LE), size: 8 };
    default:
      return null;
  }
}

/** Cap the number of points so a 1M-point full sweep doesn't lock the page. */
const POINT_LIMIT = 500_000;

/**
 * Decode a PointCloud2 binary blob into a flat positions array (+ optional
 * color/intensity per point). Returns null if the message is malformed or
 * doesn't carry x/y/z fields.
 */
export function decodePointCloud2(
  msg: PointCloud2Message,
  colorMode: ColorMode = 'height',
  singleColor?: { r: number; g: number; b: number },
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

  const intensityField =
    fields.find((f) => f.name === 'intensity') ??
    fields.find((f) => f.name === 'i');
  const rgbField = fields.find((f) => f.name === 'rgb' || f.name === 'rgba');
  const ringField = fields.find((f) => f.name === 'ring');

  const intensityReader = intensityField ? makeFieldReader(intensityField.datatype) : null;
  const rgbReader = rgbField ? makeFieldReader(rgbField.datatype) : null;
  const ringReader = ringField ? makeFieldReader(ringField.datatype) : null;

  const totalPoints = Math.min(width * height, Math.floor(data.byteLength / pointStep));
  const stride = Math.max(1, Math.ceil(totalPoints / POINT_LIMIT));
  const sampleCount = Math.ceil(totalPoints / stride);

  // First pass for height-mode (and intensity normalization): find z range
  // / intensity range so the colormap can stretch across actual data.
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const positions = new Float32Array(sampleCount * 3);
  const colors = new Float32Array(sampleCount * 3);

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

  // Cache scaled offsets per point — we'll need to revisit for color.
  const intensities: Float32Array | null =
    colorMode === 'intensity' && intensityReader ? new Float32Array(sampleCount) : null;
  const rings: Float32Array | null =
    colorMode === 'intensity' && !intensityReader && ringReader
      ? new Float32Array(sampleCount)
      : null;

  let validCount = 0;
  for (let i = 0; i < totalPoints; i += stride) {
    const base = i * pointStep;
    const x = xReader.read(view, base + xField.offset);
    const y = yReader.read(view, base + yField.offset);
    const z = zReader.read(view, base + zField.offset);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    // ROS sometimes encodes "no return" as NaN or huge numbers; drop > 200m.
    if (Math.abs(x) > 1e4 || Math.abs(y) > 1e4 || Math.abs(z) > 1e4) continue;

    const idx = validCount;
    positions[idx * 3] = x;
    positions[idx * 3 + 1] = y;
    positions[idx * 3 + 2] = z;

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;

    if (intensities && intensityReader && intensityField) {
      const v = intensityReader.read(view, base + intensityField.offset);
      intensities[idx] = v;
      if (v < minIntensity) minIntensity = v;
      if (v > maxIntensity) maxIntensity = v;
    }
    if (rings && ringReader && ringField) {
      const v = ringReader.read(view, base + ringField.offset);
      rings[idx] = v;
      if (v < minRing) minRing = v;
      if (v > maxRing) maxRing = v;
    }

    if (colorMode === 'rgb' && rgbReader && rgbField) {
      // ROS PointCloud2 packs RGB as a single 4-byte word that aliases to a
      // float. We read it as UInt32 and unpack BGRA bytes.
      const raw = view.getUint32(base + rgbField.offset, LE);
      const r = ((raw >> 16) & 0xff) / 255;
      const g = ((raw >> 8) & 0xff) / 255;
      const b = (raw & 0xff) / 255;
      colors[idx * 3] = r;
      colors[idx * 3 + 1] = g;
      colors[idx * 3 + 2] = b;
    }

    validCount++;
  }

  if (validCount === 0) return null;

  // Trim arrays to the actual valid count.
  const trimmedPositions = validCount === sampleCount ? positions : positions.slice(0, validCount * 3);
  const trimmedColors = colorMode === 'rgb'
    ? validCount === sampleCount
      ? colors
      : colors.slice(0, validCount * 3)
    : new Float32Array(validCount * 3);

  // Compute per-point colors for non-rgb modes.
  if (colorMode === 'height') {
    const range = maxZ - minZ || 1;
    for (let i = 0; i < validCount; i++) {
      const z = trimmedPositions[i * 3 + 2];
      const t = (z - minZ) / range;
      const c = turboColor(t);
      trimmedColors[i * 3] = c.r;
      trimmedColors[i * 3 + 1] = c.g;
      trimmedColors[i * 3 + 2] = c.b;
    }
  } else if (colorMode === 'intensity') {
    if (intensities && Number.isFinite(minIntensity) && maxIntensity > minIntensity) {
      const range = maxIntensity - minIntensity || 1;
      for (let i = 0; i < validCount; i++) {
        const t = (intensities[i] - minIntensity) / range;
        const c = turboColor(t);
        trimmedColors[i * 3] = c.r;
        trimmedColors[i * 3 + 1] = c.g;
        trimmedColors[i * 3 + 2] = c.b;
      }
    } else if (rings && Number.isFinite(minRing) && maxRing > minRing) {
      const range = maxRing - minRing || 1;
      for (let i = 0; i < validCount; i++) {
        const t = (rings[i] - minRing) / range;
        const c = turboColor(t);
        trimmedColors[i * 3] = c.r;
        trimmedColors[i * 3 + 1] = c.g;
        trimmedColors[i * 3 + 2] = c.b;
      }
    } else {
      // Fall back to height when the cloud has no intensity / ring data.
      const range = maxZ - minZ || 1;
      for (let i = 0; i < validCount; i++) {
        const z = trimmedPositions[i * 3 + 2];
        const t = (z - minZ) / range;
        const c = turboColor(t);
        trimmedColors[i * 3] = c.r;
        trimmedColors[i * 3 + 1] = c.g;
        trimmedColors[i * 3 + 2] = c.b;
      }
    }
  } else if (colorMode === 'single') {
    const c = singleColor ?? { r: 0.6, g: 0.85, b: 1.0 };
    for (let i = 0; i < validCount; i++) {
      trimmedColors[i * 3] = c.r;
      trimmedColors[i * 3 + 1] = c.g;
      trimmedColors[i * 3 + 2] = c.b;
    }
  }

  return {
    positions: trimmedPositions,
    colors: trimmedColors,
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
 * Google "Turbo" colormap — perceptually uniform rainbow that's easier on the
 * eye than the classic Jet. `t` is clamped to [0, 1]. Returns floats in [0, 1].
 *
 * Approximation polynomial from Anton Mikhailov (Google Research). Cheap
 * enough to call per-point at point-cloud scale.
 */
export function turboColor(t: number): { r: number; g: number; b: number } {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.max(
    0,
    Math.min(
      1,
      0.13572138 +
        4.6153926 * x -
        42.66032258 * x * x +
        132.13108234 * x * x * x -
        152.94239396 * x * x * x * x +
        59.28637943 * x * x * x * x * x,
    ),
  );
  const g = Math.max(
    0,
    Math.min(
      1,
      0.09140261 +
        2.19418839 * x +
        4.84296658 * x * x -
        14.18503333 * x * x * x +
        4.27729857 * x * x * x * x +
        2.82956604 * x * x * x * x * x,
    ),
  );
  const b = Math.max(
    0,
    Math.min(
      1,
      0.1066733 +
        12.64194608 * x -
        60.58204836 * x * x +
        110.36276771 * x * x * x -
        89.90310912 * x * x * x * x +
        27.34824973 * x * x * x * x * x,
    ),
  );
  return { r, g, b };
}
