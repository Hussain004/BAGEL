/**
 * PLY (Polygon File Format / Stanford Triangle Format) parser.
 *
 * Supports all three data encodings:
 *   - ascii: space-separated text rows
 *   - binary_little_endian: packed binary, LE byte order
 *   - binary_big_endian: packed binary, BE byte order
 *
 * Only the `element vertex` block is used. Any face/edge elements are ignored.
 * Properties handled:
 *   - x, y, z: positions (float/double)
 *   - red, green, blue (uchar/float): colors - packed into rgb FLOAT32 field
 *   - intensity (float/double): intensity field
 *   - nx, ny, nz: normals (read but not exposed in the cloud output)
 *
 * Output is a normalized FLOAT32 PointCloud2Message (all fields converted to
 * FLOAT32, RGB packed as uint32 bits inside a FLOAT32 slot, same convention
 * used by ROS/PCD) that feeds directly into `decodePointCloud2`.
 */

import type { BagSummary } from '../types/bag';
import type { AxisClip, PointCloud2Message, PointField, PointCloudExtraction, ColorMode, HeightAxis, DecodeOptions } from '../utils/pointcloud';
import { POINT_FIELD_TYPE, decodePointCloud2 } from '../utils/pointcloud';
import { sourceKey, sourceReadAll, type BagSource } from './source';

const plyCloudCache = new Map<string, PointCloud2Message>();
const plySummaryCache = new Map<string, BagSummary>();

export const PLY_MAGIC = 'ply';

type PlyFormat = 'ascii' | 'binary_little_endian' | 'binary_big_endian';

/** One PLY property declaration. */
interface PlyProp {
  name: string;
  /** PLY type string, e.g. 'float', 'uchar', 'double', 'int' */
  typeName: string;
  /** Byte size of this property in binary formats. */
  byteSize: number;
  /** Whether the property is a floating-point type (vs integer). */
  isFloat: boolean;
  /** Whether the property is an unsigned type (UINT8 / UINT16 / UINT32). */
  isUnsigned: boolean;
}

function plyTypeInfo(typeName: string): { byteSize: number; isFloat: boolean; isUnsigned: boolean } {
  switch (typeName.toLowerCase()) {
    case 'float32':
    case 'float':   return { byteSize: 4, isFloat: true, isUnsigned: false };
    case 'float64':
    case 'double':  return { byteSize: 8, isFloat: true, isUnsigned: false };
    case 'char':
    case 'int8':    return { byteSize: 1, isFloat: false, isUnsigned: false };
    case 'uchar':
    case 'uint8':   return { byteSize: 1, isFloat: false, isUnsigned: true };
    case 'short':
    case 'int16':   return { byteSize: 2, isFloat: false, isUnsigned: false };
    case 'ushort':
    case 'uint16':  return { byteSize: 2, isFloat: false, isUnsigned: true };
    case 'int':
    case 'int32':   return { byteSize: 4, isFloat: false, isUnsigned: false };
    case 'uint':
    case 'uint32':  return { byteSize: 4, isFloat: false, isUnsigned: false };
    default:        return { byteSize: 4, isFloat: false, isUnsigned: false };
  }
}

interface PlyHeader {
  format: PlyFormat;
  vertexCount: number;
  props: PlyProp[];
  /** Byte offset where the vertex data begins in the file. */
  dataByteOffset: number;
}

function parsePlyHeader(bytes: Uint8Array): PlyHeader {
  const headSlice = bytes.subarray(0, Math.min(8192, bytes.length));
  const text = new TextDecoder('ascii').decode(headSlice);

  let format: PlyFormat = 'ascii';
  let vertexCount = 0;
  const props: PlyProp[] = [];
  let inVertexElement = false;
  let dataByteOffset = 0;

  const lines = text.split('\n');
  let consumedBytes = 0;

  for (let i = 0; i < lines.length; i++) {
    // Track byte offset through the header. The +1 accounts for the newline.
    // Windows CRLF files will have an extra \r that we handle via .trim().
    const raw = lines[i];
    consumedBytes += raw.length + 1;

    const line = raw.trim();
    if (!line) continue;

    const parts = line.split(/\s+/);
    const kw = parts[0];

    if (kw === 'format') {
      const fmt = parts[1];
      format =
        fmt === 'binary_little_endian' ? 'binary_little_endian' :
        fmt === 'binary_big_endian'    ? 'binary_big_endian' :
        'ascii';
    } else if (kw === 'element') {
      inVertexElement = parts[1] === 'vertex';
      if (inVertexElement) vertexCount = Number(parts[2]);
    } else if (kw === 'property' && inVertexElement) {
      // Skip list properties (e.g. "property list uchar int vertex_index")
      if (parts[1] === 'list') continue;
      const typeName = parts[1] ?? 'float';
      const propName = parts[2] ?? '';
      const { byteSize, isFloat, isUnsigned } = plyTypeInfo(typeName);
      props.push({ name: propName, typeName, byteSize, isFloat, isUnsigned });
    } else if (kw === 'end_header') {
      dataByteOffset = consumedBytes;
      break;
    }
  }

  if (dataByteOffset === 0) {
    throw new Error('PLY file missing "end_header" marker.');
  }
  if (props.length === 0 || !props.some((p) => p.name === 'x')) {
    throw new Error('PLY file has no vertex x/y/z properties.');
  }

  return { format, vertexCount, props, dataByteOffset };
}

/**
 * Read a single PLY value from a DataView. Returns a number in the
 * natural range for the type (e.g. 0-255 for uchar).
 */
function readPlyValue(
  view: DataView,
  offset: number,
  prop: PlyProp,
  littleEndian: boolean,
): number {
  const { byteSize, isFloat, isUnsigned } = prop;
  if (isFloat) {
    return byteSize === 8
      ? view.getFloat64(offset, littleEndian)
      : view.getFloat32(offset, littleEndian);
  }
  if (byteSize === 1) return isUnsigned ? view.getUint8(offset) : view.getInt8(offset);
  if (byteSize === 2)
    return isUnsigned ? view.getUint16(offset, littleEndian) : view.getInt16(offset, littleEndian);
  return isUnsigned ? view.getUint32(offset, littleEndian) : view.getInt32(offset, littleEndian);
}

/**
 * Pack red/green/blue bytes (0-255) into the packed rgb FLOAT32 convention:
 * uint32 bit-pattern is  0x00RRGGBB (R at bits 16-23, G at 8-15, B at 0-7),
 * stored as a reinterpreted FLOAT32. This matches both the PCD rgb field and
 * the `decodePointCloud2` color reader which uses `getUint32` on the field.
 */
function packRgb(r: number, g: number, b: number): number {
  const packed = ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
  const tmp = new DataView(new ArrayBuffer(4));
  tmp.setUint32(0, packed, true);
  return tmp.getFloat32(0, true);
}

/**
 * Build a FLOAT32-normalized PointCloud2Message from a PLY header + data.
 *
 * All PLY property types are converted to FLOAT32. RGB channel properties
 * (red/green/blue, each 0-255 uchar) are merged into a single packed `rgb`
 * FLOAT32 field following the standard ROS convention.
 */
function buildPlyCloud(bytes: Uint8Array, header: PlyHeader): PointCloud2Message {
  const { format, vertexCount, props, dataByteOffset } = header;
  const littleEndian = format !== 'binary_big_endian';

  // Determine output fields.
  // We always output x, y, z, then optionally rgb (if any of red/green/blue
  // is present), then optionally intensity.
  const hasX   = props.some((p) => p.name === 'x');
  const hasY   = props.some((p) => p.name === 'y');
  const hasZ   = props.some((p) => p.name === 'z');
  const hasRed  = props.some((p) => p.name === 'red');
  const hasGreen = props.some((p) => p.name === 'green');
  const hasBlue = props.some((p) => p.name === 'blue');
  const hasRgbFloat = props.some((p) => p.name === 'rgb' || p.name === 'rgba');
  const hasColor = hasRed && hasGreen && hasBlue;
  const hasColorAny = hasColor || hasRgbFloat;
  const hasIntensity = props.some((p) => p.name === 'intensity');

  if (!hasX || !hasY || !hasZ) {
    throw new Error('PLY file missing x/y/z vertex properties.');
  }

  const outFields: PointField[] = [
    { name: 'x', offset: 0,  datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 },
    { name: 'y', offset: 4,  datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 },
    { name: 'z', offset: 8,  datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 },
  ];
  let nextOffset = 12;
  if (hasColorAny) {
    outFields.push({ name: 'rgb', offset: nextOffset, datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 });
    nextOffset += 4;
  }
  if (hasIntensity) {
    outFields.push({ name: 'intensity', offset: nextOffset, datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 });
    nextOffset += 4;
  }
  const pointStep = nextOffset;
  const outData   = new Uint8Array(vertexCount * pointStep);
  const outView   = new DataView(outData.buffer);

  if (format === 'ascii') {
    const textData = new TextDecoder('ascii').decode(bytes.subarray(dataByteOffset));
    const lines = textData.split('\n');
    let ptIdx = 0;

    // Build a quick lookup for property name → token index in each ASCII row.
    const propIdx = new Map(props.map((p, i) => [p.name, i]));

    for (let li = 0; li < lines.length && ptIdx < vertexCount; li++) {
      const line = lines[li].trim();
      if (!line || line.startsWith('#')) continue;
      const tokens = line.split(/\s+/);
      const base = ptIdx * pointStep;

      const xTok = propIdx.get('x') ?? -1;
      const yTok = propIdx.get('y') ?? -1;
      const zTok = propIdx.get('z') ?? -1;
      outView.setFloat32(base + 0, xTok >= 0 ? parseFloat(tokens[xTok]) : 0, true);
      outView.setFloat32(base + 4, yTok >= 0 ? parseFloat(tokens[yTok]) : 0, true);
      outView.setFloat32(base + 8, zTok >= 0 ? parseFloat(tokens[zTok]) : 0, true);

      if (hasColorAny) {
        const rgbOff = 12;
        if (hasColor) {
          const rIdx = propIdx.get('red')   ?? -1;
          const gIdx = propIdx.get('green') ?? -1;
          const bIdx = propIdx.get('blue')  ?? -1;
          const r = rIdx >= 0 ? parseFloat(tokens[rIdx]) : 0;
          const g = gIdx >= 0 ? parseFloat(tokens[gIdx]) : 0;
          const b = bIdx >= 0 ? parseFloat(tokens[bIdx]) : 0;
          // Normalize to 0-255 if already float in 0-1 range (some PLY exporters).
          const ri = r <= 1.0 && r >= 0.0 && r !== Math.floor(r) ? Math.round(r * 255) : Math.round(r);
          const gi = g <= 1.0 && g >= 0.0 && g !== Math.floor(g) ? Math.round(g * 255) : Math.round(g);
          const bi = b <= 1.0 && b >= 0.0 && b !== Math.floor(b) ? Math.round(b * 255) : Math.round(b);
          outView.setFloat32(base + rgbOff, packRgb(ri, gi, bi), true);
        } else if (hasRgbFloat) {
          const rIdx = propIdx.get('rgb') ?? propIdx.get('rgba') ?? -1;
          if (rIdx >= 0) {
            outView.setFloat32(base + rgbOff, parseFloat(tokens[rIdx]), true);
          }
        }
      }

      if (hasIntensity) {
        const iIdx = propIdx.get('intensity') ?? -1;
        const intOff = hasColorAny ? 16 : 12;
        outView.setFloat32(base + intOff, iIdx >= 0 ? parseFloat(tokens[iIdx]) : 0, true);
      }

      ptIdx++;
    }
  } else {
    // Binary path: scan through props in declaration order.
    const binData  = bytes.subarray(dataByteOffset);
    const binView  = new DataView(binData.buffer, binData.byteOffset, binData.byteLength);

    // Pre-compute per-property byte offset within each binary point record.
    let propBinOff = 0;
    const propOffsets = props.map((p) => {
      const off = propBinOff;
      propBinOff += p.byteSize;
      return off;
    });
    const binaryPointStep = propBinOff;

    const getPropVal = (ptBase: number, propName: string): number => {
      const idx = props.findIndex((p) => p.name === propName);
      if (idx < 0) return 0;
      return readPlyValue(binView, ptBase + propOffsets[idx], props[idx], littleEndian);
    };

    for (let pi = 0; pi < vertexCount; pi++) {
      const binBase = pi * binaryPointStep;
      const outBase = pi * pointStep;

      outView.setFloat32(outBase + 0, getPropVal(binBase, 'x'), true);
      outView.setFloat32(outBase + 4, getPropVal(binBase, 'y'), true);
      outView.setFloat32(outBase + 8, getPropVal(binBase, 'z'), true);

      if (hasColorAny) {
        const rgbOff = 12;
        if (hasColor) {
          const r = getPropVal(binBase, 'red');
          const g = getPropVal(binBase, 'green');
          const b = getPropVal(binBase, 'blue');
          // uchar red/green/blue are already 0-255; float ones are 0.0-1.0.
          const redProp = props.find((p) => p.name === 'red');
          const scale = redProp && redProp.isFloat ? 255 : 1;
          outView.setFloat32(outBase + rgbOff, packRgb(
            Math.round(r * scale),
            Math.round(g * scale),
            Math.round(b * scale),
          ), true);
        } else if (hasRgbFloat) {
          const raw = getPropVal(binBase, 'rgb') || getPropVal(binBase, 'rgba');
          outView.setFloat32(outBase + rgbOff, raw, true);
        }
      }

      if (hasIntensity) {
        const intOff = hasColorAny ? 16 : 12;
        outView.setFloat32(outBase + intOff, getPropVal(binBase, 'intensity'), true);
      }
    }
  }

  return {
    height: 1,
    width: vertexCount,
    fields: outFields,
    is_bigendian: false,
    point_step: pointStep,
    row_step: pointStep * vertexCount,
    data: outData,
  };
}

async function loadPlyCloud(source: BagSource): Promise<PointCloud2Message> {
  const key = sourceKey(source);
  const cached = plyCloudCache.get(key);
  if (cached) return cached;

  const bytes = await sourceReadAll(source);
  const header = parsePlyHeader(bytes);
  const cloud  = buildPlyCloud(bytes, header);

  plyCloudCache.set(key, cloud);
  return cloud;
}

export async function parsePly(source: BagSource): Promise<BagSummary> {
  const key = sourceKey(source);
  const cached = plySummaryCache.get(key);
  if (cached) return cached;

  const cloud = await loadPlyCloud(source);
  const pointCount = cloud.width ?? 0;

  const summary: BagSummary = {
    format: 'ply',
    fileName: source.kind === 'file' ? source.file.name : source.displayName,
    fileSize: source.kind === 'file' ? source.file.size : source.contentLength,
    startTime: 0n,
    endTime: 1_000_000n,
    duration: 0.001,
    totalMessageCount: 1,
    topics: [
      {
        name: '/cloud',
        type: 'sensor_msgs/PointCloud2',
        messageCount: 1,
        serializationFormat: 'ply',
        frequency: undefined,
        ...(pointCount > 0 ? {} : {}),
      },
    ],
  };

  plySummaryCache.set(key, summary);
  return summary;
}

export async function readPointCloudAtTimePly(
  source: BagSource,
  colorMode: ColorMode = 'height',
  maxPoints?: number,
  maxRange?: number,
  heightAxis: HeightAxis = '+z',
  axisClip?: AxisClip,
): Promise<(PointCloudExtraction & { timestamp: bigint }) | null> {
  const cloud = await loadPlyCloud(source);
  const opts: DecodeOptions = { colorMode, maxPoints, maxRange, heightAxis, axisClip };
  const decoded = decodePointCloud2(cloud, opts);
  if (!decoded) return null;
  return { ...decoded, timestamp: 0n };
}

export function disposePlyCache(): void {
  plyCloudCache.clear();
  plySummaryCache.clear();
}
