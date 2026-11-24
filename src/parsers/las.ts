/**
 * LAS / LAZ point cloud parser (ASPRS LAS 1.0 to 1.4, point formats 0 to 10).
 *
 * Opened as a standalone cloud, same tier as `.pcd` / `.ply`: one `/cloud`
 * topic holding the whole file. Uncompressed `.las` records are read straight
 * from the file; `.laz` records are decompressed by the `laz-perf` WASM build.
 *
 * Survey coordinates are often large (UTM eastings of 500,000 m and more),
 * past both float32 precision and the decoder's 1e4 m sanity filter. So every
 * point is shifted by a local origin: the centre of the header bounds, rounded
 * to a whole unit. `LasCloud.origin` keeps that shift.
 *
 * Large tiles are thinned at load to at most `MAX_STORED_POINTS`, taking every
 * n-th record, so a 100M-point tile does not need gigabytes of RAM. The render
 * cap applies on top, as for every other cloud.
 */

import type { BagSummary } from '../types/bag';
import type { AxisClip, PointCloud2Message, PointField, PointCloudExtraction, ColorMode, HeightAxis } from '../utils/pointcloud';
import { POINT_FIELD_TYPE, decodePointCloud2 } from '../utils/pointcloud';
import { sourceKey, sourceReadAll, type SingleBagSource } from './source';

export const LAS_MAGIC = 'LASF';

// ponytail: fixed cap, raise or make it a setting if people need denser tiles.
export const MAX_STORED_POINTS = 2_000_000;

export interface LasHeader {
  versionMajor: number;
  versionMinor: number;
  headerSize: number;
  pointOffset: number;
  /** Point data record format, 0 to 10, with the LAZ compression bits removed. */
  pointFormat: number;
  /** True when the format byte carries the LAZ compression bits (0x80 / 0x40). */
  compressed: boolean;
  recordLength: number;
  /** Declared point count: the 64-bit LAS 1.4 count when set, else the legacy one. */
  pointCount: number;
  scale: [number, number, number];
  offset: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
}

/** Byte layout of the fields BAGEL reads, per point format. */
interface RecordLayout {
  minLength: number;
  classOffset: number;
  /** Formats 0 to 5 keep flags in the top three bits of the class byte. */
  classMask: number;
  rgbOffset: number | null;
}

const LEGACY_MIN = [20, 28, 26, 34, 57, 63];
const LEGACY_RGB = [null, null, 20, 28, null, 28];
const EXTENDED_MIN = [30, 36, 38, 59, 67]; // formats 6 to 10
const EXTENDED_RGB = [null, 30, 30, null, 30];

export function recordLayout(format: number): RecordLayout {
  if (format >= 0 && format <= 5) {
    return { minLength: LEGACY_MIN[format], classOffset: 15, classMask: 0x1f, rgbOffset: LEGACY_RGB[format] };
  }
  if (format >= 6 && format <= 10) {
    return { minLength: EXTENDED_MIN[format - 6], classOffset: 16, classMask: 0xff, rgbOffset: EXTENDED_RGB[format - 6] };
  }
  throw new Error(`LAS: unsupported point data format ${format} (BAGEL reads formats 0 to 10).`);
}

export function parseLasHeader(bytes: Uint8Array): LasHeader {
  if (bytes.length < 227) throw new Error('LAS: file is too small to hold a header (truncated file?).');
  if (new TextDecoder('ascii').decode(bytes.subarray(0, 4)) !== LAS_MAGIC) {
    throw new Error('LAS: file does not start with "LASF", so it is not a LAS or LAZ file.');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const versionMajor = dv.getUint8(24);
  const versionMinor = dv.getUint8(25);
  const headerSize = dv.getUint16(94, true);
  const pointOffset = dv.getUint32(96, true);
  const formatByte = dv.getUint8(104);
  const recordLength = dv.getUint16(105, true);
  const legacyCount = dv.getUint32(107, true);
  const f64 = (o: number) => dv.getFloat64(o, true);

  // LAS 1.4 moves the count to a 64-bit field and may leave the legacy one at 0
  // (it must, for formats 6+). Trust the 64-bit one only when the header is big
  // enough to hold it; some writers stamp 1.4 on a 227-byte 1.2 header.
  let pointCount = legacyCount;
  if (versionMinor >= 4 && headerSize >= 375 && bytes.length >= 255) {
    const big = Number(dv.getBigUint64(247, true));
    if (big > 0) pointCount = big;
  }

  if (pointOffset < headerSize || pointOffset > bytes.length) {
    throw new Error(`LAS: point data offset ${pointOffset} is outside the file (header size ${headerSize}).`);
  }

  return {
    versionMajor,
    versionMinor,
    headerSize,
    pointOffset,
    pointFormat: formatByte & 0x3f,
    compressed: (formatByte & 0xc0) !== 0,
    recordLength,
    pointCount,
    scale: [f64(131), f64(139), f64(147)],
    offset: [f64(155), f64(163), f64(171)],
    max: [f64(179), f64(195), f64(211)],
    min: [f64(187), f64(203), f64(219)],
  };
}

// ---------------------------------------------------------------------------
// laz-perf (WASM) loading. One module per worker, reused for every file; each
// file gets its own LASZip instance and buffers, freed in `finally`.
// ---------------------------------------------------------------------------

interface LazPerfModule {
  HEAPU8: Uint8Array;
  _malloc(n: number): number;
  _free(p: number): void;
  LASZip: new () => {
    open(ptr: number, len: number): void;
    getPoint(ptr: number): void;
    getCount(): number;
    getPointLength(): number;
    getPointFormat(): number;
    delete(): void;
  };
  ChunkDecoder: new () => {
    open(format: number, length: number, ptr: number): void;
    getPoint(ptr: number): void;
    delete(): void;
  };
}

let lazPerfPromise: Promise<LazPerfModule> | null = null;

export function getLazPerf(): Promise<LazPerfModule> {
  if (!lazPerfPromise) {
    lazPerfPromise = (async () => {
      const mod = (await import('laz-perf')) as unknown as {
        createLazPerf: (opts?: { locateFile?: (f: string) => string }) => Promise<LazPerfModule>;
      };
      // Node (tests, bagel-check) finds the wasm next to the script. The app
      // serves its own copy from public/, as it does for sql.js.
      const isNode = !!(globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node;
      return mod.createLazPerf(isNode ? {} : { locateFile: () => '/laz-perf.wasm' });
    })();
    lazPerfPromise.catch(() => {
      lazPerfPromise = null;
    });
  }
  return lazPerfPromise;
}

// ---------------------------------------------------------------------------
// Record -> cloud
// ---------------------------------------------------------------------------

/** Point fields of the cloud BAGEL builds from a LAS file. */
function lasFields(hasRgb: boolean): PointField[] {
  const names = ['x', 'y', 'z', 'intensity', 'classification', ...(hasRgb ? ['rgb'] : [])];
  return names.map((name, i) => ({ name, offset: i * 4, datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 }));
}

/**
 * Accumulates sampled records into a FLOAT32 PointCloud2 (x, y, z, intensity,
 * classification, packed rgb). Shared by the LAS, LAZ and COPC paths.
 */
export class LasCloudBuilder {
  private readonly layout: RecordLayout;
  private readonly fields: PointField[];
  private readonly step: number;
  private readonly data: Uint8Array;
  private readonly out: DataView;
  private readonly rgb16: Uint16Array | null;
  private readonly header: Pick<LasHeader, 'pointFormat' | 'recordLength' | 'scale' | 'offset'>;
  private readonly origin: [number, number, number];
  private rgbMax = 0;
  get originUsed(): [number, number, number] {
    return this.origin;
  }
  count = 0;

  constructor(
    header: Pick<LasHeader, 'pointFormat' | 'recordLength' | 'scale' | 'offset'>,
    origin: [number, number, number],
    capacity: number,
  ) {
    this.header = header;
    this.origin = origin;
    this.layout = recordLayout(header.pointFormat);
    if (header.recordLength < this.layout.minLength) {
      throw new Error(
        `LAS: record length ${header.recordLength} is shorter than point format ${header.pointFormat} needs (${this.layout.minLength}).`,
      );
    }
    const hasRgb = this.layout.rgbOffset !== null;
    this.fields = lasFields(hasRgb);
    this.step = this.fields.length * 4;
    this.data = new Uint8Array(capacity * this.step);
    this.out = new DataView(this.data.buffer);
    this.rgb16 = hasRgb ? new Uint16Array(capacity * 3) : null;
  }

  get capacity(): number {
    return this.data.length / this.step;
  }

  /** Append the record at `at` in `view`. Returns false when full. */
  add(view: DataView, at: number): boolean {
    if (this.count >= this.capacity) return false;
    const { scale, offset } = this.header;
    const o = this.out;
    const base = this.count * this.step;
    o.setFloat32(base, view.getInt32(at, true) * scale[0] + offset[0] - this.origin[0], true);
    o.setFloat32(base + 4, view.getInt32(at + 4, true) * scale[1] + offset[1] - this.origin[1], true);
    o.setFloat32(base + 8, view.getInt32(at + 8, true) * scale[2] + offset[2] - this.origin[2], true);
    o.setFloat32(base + 12, view.getUint16(at + 12, true), true);
    o.setFloat32(base + 16, view.getUint8(at + this.layout.classOffset) & this.layout.classMask, true);
    if (this.rgb16 && this.layout.rgbOffset !== null) {
      const r = this.count * 3;
      for (let c = 0; c < 3; c++) {
        const v = view.getUint16(at + this.layout.rgbOffset + c * 2, true);
        this.rgb16[r + c] = v;
        if (v > this.rgbMax) this.rgbMax = v;
      }
    }
    this.count++;
    return true;
  }

  build(frameId?: string): PointCloud2Message {
    const n = this.count;
    if (this.rgb16) {
      // The spec says 16-bit colour, but many writers store 0-255. Only shift
      // down when some channel actually uses the high byte.
      const shift = this.rgbMax > 255 ? 8 : 0;
      const tmp = new DataView(new ArrayBuffer(4));
      for (let i = 0; i < n; i++) {
        const r = this.rgb16[i * 3] >> shift;
        const g = this.rgb16[i * 3 + 1] >> shift;
        const b = this.rgb16[i * 3 + 2] >> shift;
        tmp.setUint32(0, ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff), true);
        this.out.setFloat32(i * this.step + 20, tmp.getFloat32(0, true), true);
      }
    }
    return {
      header: frameId ? { frame_id: frameId } : undefined,
      height: 1,
      width: n,
      fields: this.fields,
      is_bigendian: false,
      point_step: this.step,
      row_step: this.step * n,
      data: this.data.subarray(0, n * this.step),
    };
  }
}

/**
 * Local origin: the rounded centre of the header bounds in x/y (z only when it
 * is far from 0). The bounds are optional-in-practice data that some writers
 * leave at 0 or never update, so when they do not contain the first point the
 * first point is used instead; either way the origin sits near the data.
 */
export function lasOrigin(
  min: [number, number, number],
  max: [number, number, number],
  first?: [number, number, number],
): [number, number, number] {
  const ok = [0, 1, 2].every((a) => Number.isFinite(min[a]) && Number.isFinite(max[a]) && min[a] <= max[a]);
  const inside = ok && (!first || [0, 1, 2].every((a) => first[a] >= min[a] - 1 && first[a] <= max[a] + 1));
  const c: [number, number, number] = inside
    ? [Math.round((min[0] + max[0]) / 2), Math.round((min[1] + max[1]) / 2), Math.round((min[2] + max[2]) / 2)]
    : first
      ? [Math.round(first[0]), Math.round(first[1]), Math.round(first[2])]
      : [0, 0, 0];
  return [c[0], c[1], Math.abs(c[2]) > 5000 ? c[2] : 0];
}

/** World coordinates of the record at `at`. */
function recordXyz(view: DataView, at: number, h: Pick<LasHeader, 'scale' | 'offset'>): [number, number, number] {
  return [0, 1, 2].map((a) => view.getInt32(at + a * 4, true) * h.scale[a] + h.offset[a]) as [number, number, number];
}

export interface LasCloud {
  cloud: PointCloud2Message;
  header: LasHeader;
  origin: [number, number, number];
  /** Records actually present (may be below the declared count for a truncated file). */
  readCount: number;
}

/** Decode a whole `.las` or `.laz` file held in memory. */
export async function decodeLasFile(bytes: Uint8Array, maxStored = MAX_STORED_POINTS): Promise<LasCloud> {
  const header = parseLasHeader(bytes);
  return header.compressed ? decodeLaz(bytes, header, maxStored) : decodeUncompressed(bytes, header, maxStored);
}

function decodeUncompressed(bytes: Uint8Array, header: LasHeader, maxStored: number): LasCloud {
  if (header.recordLength <= 0) throw new Error('LAS: record length is 0.');
  // A wrong declared count is common (writers that never patch the header after
  // streaming). Read what the file actually holds, up to the declared count
  // when that is smaller.
  const available = Math.floor((bytes.length - header.pointOffset) / header.recordLength);
  const declared = header.pointCount > 0 ? header.pointCount : available;
  const total = Math.min(declared, available);
  const stride = Math.max(1, Math.ceil(total / maxStored));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const origin = lasOrigin(header.min, header.max, total > 0 ? recordXyz(view, header.pointOffset, header) : undefined);
  const builder = new LasCloudBuilder(header, origin, Math.ceil(total / stride));
  for (let i = 0; i < total; i += stride) builder.add(view, header.pointOffset + i * header.recordLength);
  return { cloud: builder.build(), header, origin, readCount: total };
}

/** Point formats laz-perf decodes. The waveform formats (4, 5, 9, 10) crash it. */
const LAZ_FORMATS = new Set([0, 1, 2, 3, 6, 7, 8]);

/** laz-perf throws numbers and strings, not Errors; give callers a real one. */
function lazError(err: unknown): Error {
  if (err instanceof Error) return new Error(`LAZ: decompression failed (${err.message}). The file may be truncated or damaged.`);
  return new Error('LAZ: decompression failed. The file may be truncated or damaged.');
}

/**
 * Throw away the shared laz-perf instance. After a WASM trap or C++ exception
 * its heap and allocator are not trustworthy (the zstd-wasm lesson of v1.6.7),
 * so the next file gets a fresh instance instead of a possibly corrupt one.
 */
function discardLazPerf(): void {
  lazPerfPromise = null;
}

async function decodeLaz(bytes: Uint8Array, header: LasHeader, maxStored: number): Promise<LasCloud> {
  if (!LAZ_FORMATS.has(header.pointFormat)) {
    throw new Error(
      `LAZ: compressed point format ${header.pointFormat} (with waveform data) is not supported. ` +
        'Decompress it first, for example with `las2las -i in.laz -o out.las`, and open the .las.',
    );
  }
  const lp = await getLazPerf();
  let healthy = true;
  const filePtr = lp._malloc(bytes.length);
  let pointPtr = 0;
  const laszip = new lp.LASZip();
  try {
    lp.HEAPU8.set(bytes, filePtr);
    laszip.open(filePtr, bytes.length);
    const recordLength = laszip.getPointLength();
    const count = laszip.getCount();
    const fmtHeader = { ...header, pointFormat: laszip.getPointFormat() & 0x3f, recordLength };
    const stride = Math.max(1, Math.ceil(count / maxStored));
    pointPtr = lp._malloc(recordLength);
    let builder: LasCloudBuilder | null = null;
    let read = 0;
    for (let i = 0; i < count; i++) {
      try {
        laszip.getPoint(pointPtr);
      } catch (err) {
        healthy = false;
        // A truncated or damaged file: keep what decoded, as for an
        // uncompressed file that ends early. Nothing decoded is an error.
        if (read === 0) throw lazError(err);
        break;
      }
      read++;
      // Re-read HEAPU8 each time: the heap's buffer is replaced if WASM memory grows.
      const view = new DataView(lp.HEAPU8.buffer, pointPtr, recordLength);
      builder ??= new LasCloudBuilder(fmtHeader, lasOrigin(header.min, header.max, recordXyz(view, 0, header)), Math.ceil(count / stride));
      if (i % stride === 0) builder.add(view, 0);
    }
    if (!builder) throw new Error('LAS: the file holds no points.');
    return { cloud: builder.build(), header: fmtHeader, origin: builder.originUsed, readCount: read };
  } catch (err) {
    healthy = false;
    throw err instanceof Error && err.message.startsWith('LA') ? err : lazError(err);
  } finally {
    if (healthy) {
      laszip.delete();
      if (pointPtr) lp._free(pointPtr);
      lp._free(filePtr);
    } else {
      discardLazPerf();
    }
  }
}

// ---------------------------------------------------------------------------
// BagSummary integration (mirrors ply.ts)
// ---------------------------------------------------------------------------

const lasCache = new Map<string, LasCloud>();
const lasSummaryCache = new Map<string, BagSummary>();

async function loadLasCloud(source: SingleBagSource): Promise<LasCloud> {
  const key = sourceKey(source);
  const cached = lasCache.get(key);
  if (cached) return cached;
  const decoded = await decodeLasFile(await sourceReadAll(source));
  if (decoded.cloud.width === 0) throw new Error('LAS: the file holds no points.');
  lasCache.set(key, decoded);
  return decoded;
}

export async function parseLas(source: SingleBagSource): Promise<BagSummary> {
  const key = sourceKey(source);
  const cached = lasSummaryCache.get(key);
  if (cached) return cached;
  await loadLasCloud(source);
  const summary: BagSummary = {
    format: 'las',
    fileName: source.kind === 'file' ? source.file.name : source.displayName,
    fileSize: source.kind === 'file' ? source.file.size : source.contentLength,
    startTime: 0n,
    endTime: 1_000_000n,
    duration: 0.001,
    totalMessageCount: 1,
    topics: [
      { name: '/cloud', type: 'sensor_msgs/PointCloud2', messageCount: 1, serializationFormat: 'las', frequency: undefined },
    ],
  };
  lasSummaryCache.set(key, summary);
  return summary;
}

export async function readPointCloudAtTimeLas(
  source: SingleBagSource,
  colorMode: ColorMode = 'height',
  maxPoints?: number,
  maxRange?: number,
  heightAxis: HeightAxis = '+z',
  axisClip?: AxisClip,
): Promise<(PointCloudExtraction & { timestamp: bigint }) | null> {
  const { cloud } = await loadLasCloud(source);
  const decoded = decodePointCloud2(cloud, { colorMode, maxPoints, maxRange, heightAxis, axisClip });
  return decoded ? { ...decoded, timestamp: 0n } : null;
}

export function disposeLasCache(): void {
  lasCache.clear();
  lasSummaryCache.clear();
}
