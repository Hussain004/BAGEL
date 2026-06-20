/**
 * PCD (Point Cloud Data) file parser.
 *
 * Supports all three data encodings defined in the PCD 0.7 spec:
 *   - ascii: space-separated text rows
 *   - binary: packed little-endian binary blob (same layout as PointCloud2)
 *   - binary_compressed: LZF-compressed binary blob with an 8-byte length header
 *
 * Output is a synthetic `PointCloud2Message` that drops straight into the
 * existing `decodePointCloud2` path so every colormap, range filter, and
 * point-limit option works unchanged. The result is cached by source key so
 * reopening the file or changing the colorMode re-reads from memory, not disk.
 */

import type { BagSummary } from '../types/bag';
import type { AxisClip, PointCloud2Message, PointField, PointCloudExtraction, ColorMode, HeightAxis, DecodeOptions } from '../utils/pointcloud';
import { POINT_FIELD_TYPE, decodePointCloud2 } from '../utils/pointcloud';
import { sourceKey, sourceReadAll, type BagSource } from './source';

// Cache: sourceKey -> synthetic PointCloud2Message for instant reuse
const pcdCloudCache = new Map<string, PointCloud2Message>();
const pcdSummaryCache = new Map<string, BagSummary>();

// PCD magic prefix (first line of valid PCD files)
export const PCD_MAGIC = '# .PCD';

interface PcdHeader {
  fields: string[];
  sizes: number[];
  types: string[];
  counts: number[];
  width: number;
  height: number;
  points: number;
  dataEncoding: 'ascii' | 'binary' | 'binary_compressed';
}

/** Map PCD type+size to PointCloud2 datatype constant. */
function pcdTypeToPc2Datatype(type: string, size: number): number {
  const t = type.toUpperCase();
  if (t === 'F') return size === 8 ? POINT_FIELD_TYPE.FLOAT64 : POINT_FIELD_TYPE.FLOAT32;
  if (t === 'I') {
    if (size === 1) return POINT_FIELD_TYPE.INT8;
    if (size === 2) return POINT_FIELD_TYPE.INT16;
    return POINT_FIELD_TYPE.INT32;
  }
  // 'U'
  if (size === 1) return POINT_FIELD_TYPE.UINT8;
  if (size === 2) return POINT_FIELD_TYPE.UINT16;
  return POINT_FIELD_TYPE.UINT32;
}

function parsePcdHeader(bytes: Uint8Array): { header: PcdHeader; dataByteOffset: number } {
  // Decode just the header portion (up to 4 KB is plenty for any real PCD header)
  const headSlice = bytes.subarray(0, Math.min(4096, bytes.length));
  const text = new TextDecoder('ascii').decode(headSlice);

  const header: Partial<PcdHeader> = {};
  let dataByteOffset = 0;
  let lineStart = 0;

  for (let i = 0; i <= text.length; i++) {
    const ch = i === text.length ? '\n' : text[i];
    if (ch !== '\n' && ch !== '\r') continue;

    const rawLine = text.slice(lineStart, i);
    lineStart = i + 1;
    // skip Windows CRLF second byte
    if (rawLine === '') continue;

    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/\s+/);
    const keyword = parts[0].toUpperCase();
    const values = parts.slice(1);

    switch (keyword) {
      case 'FIELDS': header.fields = values.map((v) => v.toLowerCase()); break;
      case 'SIZE':   header.sizes  = values.map(Number); break;
      case 'TYPE':   header.types  = values; break;
      case 'COUNT':  header.counts = values.map(Number); break;
      case 'WIDTH':  header.width  = Number(values[0]); break;
      case 'HEIGHT': header.height = Number(values[0]); break;
      case 'POINTS': header.points = Number(values[0]); break;
      case 'DATA': {
        const enc = (values[0] ?? 'ascii').toLowerCase();
        header.dataEncoding =
          enc === 'binary_compressed' ? 'binary_compressed' :
          enc === 'binary' ? 'binary' :
          'ascii';
        // The data section starts at the byte immediately after this line's newline.
        // Count the byte position of the newline we just found.
        dataByteOffset = i + 1;
        // Ensure we break out of the scan
        i = text.length + 1;
        break;
      }
    }
  }

  if (
    !header.fields || !header.sizes || !header.types || !header.counts ||
    header.points === undefined || header.dataEncoding === undefined
  ) {
    throw new Error('PCD file has an incomplete header (missing FIELDS / SIZE / TYPE / POINTS / DATA).');
  }

  const completeHeader = header as PcdHeader;
  if (!completeHeader.width) completeHeader.width = completeHeader.points;
  if (!completeHeader.height) completeHeader.height = 1;

  return { header: completeHeader, dataByteOffset };
}

/**
 * Minimal LZF decompressor matching the PCD binary_compressed encoding.
 * The algorithm is fully described at http://oldhome.schmorp.de/marc/liblzf.html
 */
function lzfDecompress(compressed: Uint8Array, outputLen: number): Uint8Array {
  const out = new Uint8Array(outputLen);
  let iPos = 0;
  let oPos = 0;

  while (iPos < compressed.length) {
    let ctrl = compressed[iPos++];

    if (ctrl < 32) {
      // Literal run: copy the next (ctrl + 1) bytes verbatim.
      const count = ctrl + 1;
      for (let k = 0; k < count; k++) {
        out[oPos++] = compressed[iPos++];
      }
    } else {
      // Back-reference: (ctrl >> 5) encodes initial length; 7 means read one more.
      let len = ctrl >> 5;
      if (len === 7) len += compressed[iPos++];
      len += 2;

      // 13-bit back offset encoded as ((ctrl & 0x1f) << 8) | next_byte, bias +1.
      const backOffset = ((ctrl & 0x1f) << 8) + compressed[iPos++] + 1;
      let srcPos = oPos - backOffset;
      for (let k = 0; k < len; k++) {
        out[oPos++] = out[srcPos++];
      }
    }
  }

  return out;
}

function buildBinaryCloud(
  rawData: Uint8Array,
  header: PcdHeader,
): PointCloud2Message {
  // Build the PointField array from the PCD header.
  const fields: PointField[] = [];
  let offset = 0;
  for (let i = 0; i < header.fields.length; i++) {
    const name  = header.fields[i];
    const size  = header.sizes[i] ?? 4;
    const type  = header.types[i] ?? 'F';
    const count = header.counts[i] ?? 1;
    // PointCloud2 only uses count=1 per field; expand multi-count fields as _0, _1 ...
    for (let c = 0; c < count; c++) {
      fields.push({
        name: count === 1 ? name : `${name}_${c}`,
        offset,
        datatype: pcdTypeToPc2Datatype(type, size),
        count: 1,
      });
      offset += size;
    }
  }

  const pointStep = offset;
  const width  = header.width || header.points;
  const height = header.height || 1;

  // Ensure we never hand DataView an empty buffer when `points` is 0.
  const dataBuf = header.points === 0
    ? new Uint8Array(0)
    : rawData.slice(0, header.points * pointStep);

  return {
    height,
    width,
    fields,
    is_bigendian: false,
    point_step: pointStep,
    row_step: pointStep * width,
    data: dataBuf,
  };
}

function buildAsciiCloud(
  text: string,
  header: PcdHeader,
): PointCloud2Message {
  // Normalize to FLOAT32 for all fields — ASCII PCD values are parsed as floats anyway.
  const fields: PointField[] = [];
  let totalFields = 0;
  for (let i = 0; i < header.fields.length; i++) {
    const count = header.counts[i] ?? 1;
    totalFields += count;
    for (let c = 0; c < count; c++) {
      fields.push({
        name: count === 1 ? header.fields[i] : `${header.fields[i]}_${c}`,
        offset: fields.length * 4,
        datatype: POINT_FIELD_TYPE.FLOAT32,
        count: 1,
      });
    }
  }
  const pointStep = totalFields * 4;
  const points    = header.points;
  const data      = new Uint8Array(points * pointStep);
  const view      = new DataView(data.buffer);

  const lines = text.split('\n');
  let validPt = 0;
  for (let li = 0; li < lines.length && validPt < points; li++) {
    const line = lines[li].trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = line.split(/\s+/);
    if (tokens.length < totalFields) continue;
    const base = validPt * pointStep;
    for (let fi = 0; fi < totalFields; fi++) {
      view.setFloat32(base + fi * 4, parseFloat(tokens[fi]), true);
    }
    validPt++;
  }

  return {
    height: 1,
    width: validPt,
    fields,
    is_bigendian: false,
    point_step: pointStep,
    row_step: pointStep * validPt,
    data: data.subarray(0, validPt * pointStep),
  };
}

async function loadPcdCloud(source: BagSource): Promise<PointCloud2Message> {
  const key = sourceKey(source);
  const cached = pcdCloudCache.get(key);
  if (cached) return cached;

  const bytes = await sourceReadAll(source);
  const { header, dataByteOffset } = parsePcdHeader(bytes);

  let cloud: PointCloud2Message;

  if (header.dataEncoding === 'binary_compressed') {
    // PCD binary_compressed: 4-byte compressed size + 4-byte uncompressed size + LZF blob
    const dv = new DataView(bytes.buffer, bytes.byteOffset + dataByteOffset);
    const compressedSize   = dv.getUint32(0, true);
    const uncompressedSize = dv.getUint32(4, true);
    const compressed = bytes.subarray(dataByteOffset + 8, dataByteOffset + 8 + compressedSize);
    const uncompressed = lzfDecompress(compressed, uncompressedSize);
    cloud = buildBinaryCloud(uncompressed, header);
  } else if (header.dataEncoding === 'binary') {
    const rawData = bytes.subarray(dataByteOffset);
    cloud = buildBinaryCloud(rawData, header);
  } else {
    // ascii
    const dataText = new TextDecoder('ascii').decode(bytes.subarray(dataByteOffset));
    cloud = buildAsciiCloud(dataText, header);
  }

  pcdCloudCache.set(key, cloud);
  return cloud;
}

export async function parsePcd(source: BagSource): Promise<BagSummary> {
  const key = sourceKey(source);
  const cached = pcdSummaryCache.get(key);
  if (cached) return cached;

  const cloud = await loadPcdCloud(source);
  const pointCount = cloud.width ?? 0;

  const summary: BagSummary = {
    format: 'pcd',
    fileName: source.kind === 'file' ? source.file.name : source.displayName,
    fileSize: source.kind === 'file' ? source.file.size : source.contentLength,
    startTime: 0n,
    endTime: 1_000_000n, // 1 ms so the timeline doesn't collapse to zero
    duration: 0.001,
    totalMessageCount: 1,
    topics: [
      {
        name: '/cloud',
        type: 'sensor_msgs/PointCloud2',
        messageCount: 1,
        serializationFormat: 'pcd',
        frequency: undefined,
        ...(pointCount > 0 ? {} : {}),
      },
    ],
  };

  pcdSummaryCache.set(key, summary);
  return summary;
}

export async function readPointCloudAtTimePcd(
  source: BagSource,
  colorMode: ColorMode = 'height',
  maxPoints?: number,
  maxRange?: number,
  heightAxis: HeightAxis = '+z',
  axisClip?: AxisClip,
): Promise<(PointCloudExtraction & { timestamp: bigint }) | null> {
  const cloud = await loadPcdCloud(source);
  const opts: DecodeOptions = { colorMode, maxPoints, maxRange, heightAxis, axisClip };
  const decoded = decodePointCloud2(cloud, opts);
  if (!decoded) return null;
  return { ...decoded, timestamp: 0n };
}

export function disposePcdCache(): void {
  pcdCloudCache.clear();
  pcdSummaryCache.clear();
}
