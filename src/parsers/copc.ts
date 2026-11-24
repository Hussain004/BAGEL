/**
 * COPC (Cloud Optimized Point Cloud) reader: a LAZ 1.4 file whose points are
 * stored as one LAZ chunk per octree node, with a hierarchy that says where
 * each node's chunk is. BAGEL reads it piece by piece through `sourceReadSlice`
 * (HTTP Range for URLs, Blob.slice for local files), so a multi-GB survey tile
 * opens without downloading or holding the whole file.
 *
 * Which nodes load: whole octree levels, breadth-first from the root, until
 * `NODE_POINT_BUDGET` would be passed, which gives an even overview of the
 * tile. When the 3D view's clip box is set, only nodes that intersect it load,
 * and each counts by the share of its cube inside the box, so clipping to a
 * region spends the same budget on deeper, denser nodes there.
 * ponytail: refinement follows the clip box, not the camera; frustum-driven
 * level of detail needs camera state in the worker and is a follow-up.
 *
 * Spec: https://copc.io (COPC 1.0).
 */

import type { BagSummary } from '../types/bag';
import { decodePointCloud2, type AxisClip, type ColorMode, type HeightAxis, type PointCloudExtraction, type PointCloud2Message } from '../utils/pointcloud';
import {
  LAZ_FORMATS,
  LasCloudBuilder,
  discardLazPerf,
  getLazPerf,
  lasOrigin,
  lazError,
  parseLasHeader,
  type LasHeader,
} from './las';
import { sourceKey, sourceReadSlice, sourceSize, type SingleBagSource } from './source';

/** Header (375) + copc VLR header (54) + copc info (160). */
const COPC_HEAD_BYTES = 589;
const ENTRY_BYTES = 32;
// ponytail: about twice the render cap (250k); raise if the cap ever rises.
export const NODE_POINT_BUDGET = 600_000;
// ponytail: fixed cache of decoded nodes, an LRU by bytes would let it scale with device memory.
const NODE_CACHE_BYTES = 256 * 1024 * 1024;
const FETCH_CONCURRENCY = 6;

export interface CopcInfo {
  center: [number, number, number];
  halfsize: number;
  spacing: number;
  rootOffset: number;
  rootSize: number;
}

interface Entry {
  d: number;
  x: number;
  y: number;
  z: number;
  offset: number;
  byteSize: number;
  /** -1: the entry points at a child hierarchy page, not at point data. */
  pointCount: number;
}

const keyOf = (d: number, x: number, y: number, z: number) => `${d}-${x}-${y}-${z}`;

/** The copc info VLR, if `head` (the first 589 bytes) belongs to a COPC file. */
export function parseCopcInfo(head: Uint8Array): CopcInfo | null {
  if (head.length < COPC_HEAD_BYTES) return null;
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const userId = new TextDecoder('ascii').decode(head.subarray(377, 393)).replace(/\0+$/, '');
  if (userId !== 'copc' || dv.getUint16(393, true) !== 1) return null;
  const f = (o: number) => dv.getFloat64(o, true);
  return {
    center: [f(429), f(437), f(445)],
    halfsize: f(453),
    spacing: f(461),
    rootOffset: Number(dv.getBigUint64(469, true)),
    rootSize: Number(dv.getBigUint64(477, true)),
  };
}

export function parseHierarchyPage(bytes: Uint8Array): Entry[] {
  if (bytes.length % ENTRY_BYTES !== 0) {
    throw new Error(`COPC: hierarchy page of ${bytes.length} bytes is not a whole number of 32-byte entries.`);
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Entry[] = [];
  for (let o = 0; o < bytes.length; o += ENTRY_BYTES) {
    out.push({
      d: dv.getInt32(o, true),
      x: dv.getInt32(o + 4, true),
      y: dv.getInt32(o + 8, true),
      z: dv.getInt32(o + 12, true),
      offset: Number(dv.getBigUint64(o + 16, true)),
      byteSize: dv.getInt32(o + 24, true),
      pointCount: dv.getInt32(o + 28, true),
    });
  }
  return out;
}

/** World-space cube of an octree node. */
export function nodeBounds(info: CopcInfo, d: number, x: number, y: number, z: number) {
  const side = (2 * info.halfsize) / 2 ** d;
  const min = [x, y, z].map((v, a) => info.center[a] - info.halfsize + v * side) as [number, number, number];
  return { min, max: min.map((v) => v + side) as [number, number, number] };
}

/**
 * Share of a node's cube inside the clip box, 0 to 1 (1 with no clip). The
 * budget counts a node's points times this, so a root that only grazes a small
 * clip box costs little and the walk can go deeper inside the box.
 */
export function overlapFraction(b: { min: number[]; max: number[] }, clip: { min: number[]; max: number[] } | null): number {
  if (!clip) return 1;
  let f = 1;
  for (let a = 0; a < 3; a++) {
    const side = b.max[a] - b.min[a];
    const len = Math.min(b.max[a], clip.max[a]) - Math.max(b.min[a], clip.min[a]);
    if (len < 0) return 0;
    f *= side > 0 ? Math.min(1, len / side) : 1;
  }
  return f;
}

class CopcFile {
  readonly nodes = new Map<string, Entry>();
  private readonly pages = new Map<string, Entry>();
  private readonly loadedPages = new Set<number>();
  private readonly cache = new Map<string, Uint8Array>();
  private cacheBytes = 0;
  private lastBuilt: { key: string; cloud: PointCloud2Message } | null = null;
  readonly origin: [number, number, number];
  readonly source: SingleBagSource;
  readonly header: LasHeader;
  readonly info: CopcInfo;
  readonly fileSize: number;

  constructor(source: SingleBagSource, header: LasHeader, info: CopcInfo) {
    this.source = source;
    this.header = header;
    this.info = info;
    this.fileSize = sourceSize(source);
    // Fixed once per file: an origin that moved as nodes load would shift the
    // cloud, the accumulation buffer and the clip box between frames.
    this.origin = lasOrigin(header.min, header.max, info.center);
  }

  private checkRange(what: string, offset: number, size: number) {
    if (offset < 0 || size <= 0 || offset + size > this.fileSize) {
      throw new Error(`COPC: ${what} at ${offset} (+${size} bytes) is outside the ${this.fileSize}-byte file.`);
    }
  }

  async loadPage(offset: number, size: number): Promise<void> {
    // A page that points back at itself (or an ancestor) would loop forever.
    if (this.loadedPages.has(offset)) return;
    this.checkRange('hierarchy page', offset, size);
    this.loadedPages.add(offset);
    for (const e of parseHierarchyPage(await sourceReadSlice(this.source, offset, offset + size))) {
      const k = keyOf(e.d, e.x, e.y, e.z);
      if (e.pointCount === -1) {
        if (!this.loadedPages.has(e.offset)) this.pages.set(k, e);
      } else {
        this.nodes.set(k, e);
      }
    }
  }

  /** The entry for a node, loading the hierarchy page that holds it if needed. */
  private async entry(k: string): Promise<Entry | undefined> {
    for (let guard = 0; guard < 64 && !this.nodes.has(k); guard++) {
      const page = this.pages.get(k);
      if (!page) return undefined;
      this.pages.delete(k);
      await this.loadPage(page.offset, page.byteSize);
    }
    return this.nodes.get(k);
  }

  /** Whole levels, breadth-first, within the budget and the clip box (world space). */
  async select(clip: { min: number[]; max: number[] } | null, budget: number): Promise<Entry[]> {
    const chosen: Entry[] = [];
    let total = 0;
    let level: Entry[] = [];
    const root = await this.entry(keyOf(0, 0, 0, 0));
    if (root) level.push(root);
    while (level.length > 0) {
      const share = level.map((e) => overlapFraction(nodeBounds(this.info, e.d, e.x, e.y, e.z), clip));
      const inView = level.filter((_, i) => share[i] > 0);
      const points = level.reduce((n, e, i) => n + Math.max(0, e.pointCount) * share[i], 0);
      if (chosen.length > 0 && total + points > budget) break;
      for (const e of inView) if (e.pointCount > 0) chosen.push(e);
      total += points;
      const next: Entry[] = [];
      for (const e of inView) {
        for (let c = 0; c < 8; c++) {
          const child = await this.entry(keyOf(e.d + 1, 2 * e.x + (c & 1), 2 * e.y + ((c >> 1) & 1), 2 * e.z + ((c >> 2) & 1)));
          if (child) next.push(child);
        }
      }
      level = next;
    }
    return chosen;
  }

  /** Decompressed records of one node (pointCount * recordLength bytes). */
  async nodeRecords(e: Entry): Promise<Uint8Array> {
    const k = keyOf(e.d, e.x, e.y, e.z);
    const hit = this.cache.get(k);
    if (hit) return hit;
    this.checkRange('point chunk', e.offset, e.byteSize);
    const compressed = await sourceReadSlice(this.source, e.offset, e.offset + e.byteSize);
    const records = await decompressChunk(compressed, this.header.pointFormat, this.header.recordLength, e.pointCount);
    if (this.cacheBytes + records.length > NODE_CACHE_BYTES) {
      this.cache.clear();
      this.cacheBytes = 0;
    }
    this.cache.set(k, records);
    this.cacheBytes += records.length;
    return records;
  }

  async cloud(axisClip: AxisClip | undefined, budget: number): Promise<{ cloud: PointCloud2Message; nodes: number }> {
    const o = this.origin;
    const clip = axisClip && hasClip(axisClip)
      ? {
          min: [axisClip.xMin ?? -Infinity, axisClip.yMin ?? -Infinity, axisClip.zMin ?? -Infinity].map((v, a) => v + o[a]),
          max: [axisClip.xMax ?? Infinity, axisClip.yMax ?? Infinity, axisClip.zMax ?? Infinity].map((v, a) => v + o[a]),
        }
      : null;
    const chosen = await this.select(clip, budget);
    const key = chosen.map((e) => keyOf(e.d, e.x, e.y, e.z)).join(',');
    if (this.lastBuilt?.key === key) return { cloud: this.lastBuilt.cloud, nodes: chosen.length };

    const records: (Uint8Array | null)[] = new Array(chosen.length).fill(null);
    let firstError: unknown = null;
    let next = 0;
    const worker = async () => {
      while (next < chosen.length) {
        const i = next++;
        try {
          records[i] = await this.nodeRecords(chosen[i]);
        } catch (err) {
          // One bad node should not hide the rest of the tile.
          firstError ??= err;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(FETCH_CONCURRENCY, chosen.length) }, worker));
    const good = records.filter((r): r is Uint8Array => r !== null);
    if (good.length === 0) throw firstError instanceof Error ? firstError : new Error('COPC: the file holds no points.');

    const rl = this.header.recordLength;
    const count = good.reduce((n, r) => n + r.length / rl, 0);
    const builder = new LasCloudBuilder(this.header, o, count);
    for (const r of good) {
      const view = new DataView(r.buffer, r.byteOffset, r.byteLength);
      for (let at = 0; at + rl <= r.length; at += rl) builder.add(view, at);
    }
    const cloud = builder.build();
    this.lastBuilt = { key, cloud };
    return { cloud, nodes: chosen.length };
  }
}

function hasClip(c: AxisClip): boolean {
  return [c.xMin, c.xMax, c.yMin, c.yMax, c.zMin, c.zMax].some((v) => v !== undefined && Number.isFinite(v));
}

/** Decompress one COPC node's LAZ chunk with a fresh ChunkDecoder. */
export async function decompressChunk(
  compressed: Uint8Array,
  pointFormat: number,
  recordLength: number,
  pointCount: number,
): Promise<Uint8Array> {
  if (!LAZ_FORMATS.has(pointFormat)) throw new Error(`COPC: point format ${pointFormat} is not supported.`);
  const lp = await getLazPerf();
  let healthy = true;
  const inPtr = lp._malloc(compressed.length);
  const outPtr = lp._malloc(recordLength);
  const decoder = new lp.ChunkDecoder();
  try {
    lp.HEAPU8.set(compressed, inPtr);
    decoder.open(pointFormat, recordLength, inPtr);
    const out = new Uint8Array(pointCount * recordLength);
    for (let i = 0; i < pointCount; i++) {
      decoder.getPoint(outPtr);
      out.set(lp.HEAPU8.subarray(outPtr, outPtr + recordLength), i * recordLength);
    }
    return out;
  } catch (err) {
    healthy = false;
    throw lazError(err);
  } finally {
    if (healthy) {
      decoder.delete();
      lp._free(outPtr);
      lp._free(inPtr);
    } else {
      discardLazPerf();
    }
  }
}

// ---------------------------------------------------------------------------
// Per-source cache and the parser entry points core.ts routes to
// ---------------------------------------------------------------------------

const opened = new Map<string, Promise<CopcFile | null>>();

/** The COPC reader for a `.las` / `.laz` source, or null when it is plain LAS / LAZ. */
export function openCopc(source: SingleBagSource): Promise<CopcFile | null> {
  const key = sourceKey(source);
  let p = opened.get(key);
  if (!p) {
    p = (async () => {
      const size = sourceSize(source);
      if (size < COPC_HEAD_BYTES) return null;
      const head = await sourceReadSlice(source, 0, COPC_HEAD_BYTES);
      const info = parseCopcInfo(head);
      if (!info) return null;
      const header = parseLasHeader(head, size);
      const file = new CopcFile(source, header, info);
      await file.loadPage(info.rootOffset, info.rootSize);
      return file;
    })();
    p.catch(() => opened.delete(key));
    opened.set(key, p);
  }
  return p;
}

export async function parseCopc(source: SingleBagSource): Promise<BagSummary> {
  const file = await openCopc(source);
  if (!file) throw new Error('COPC: not a COPC file.');
  // Load the overview now so a broken file fails at open, not in the panel.
  await file.cloud(undefined, NODE_POINT_BUDGET);
  return {
    format: 'las',
    fileName: source.kind === 'file' ? source.file.name : source.displayName,
    fileSize: sourceSize(source),
    startTime: 0n,
    endTime: 1_000_000n,
    duration: 0.001,
    totalMessageCount: 1,
    topics: [
      { name: '/cloud', type: 'sensor_msgs/PointCloud2', messageCount: 1, serializationFormat: 'copc', frequency: undefined },
    ],
  };
}

export async function readPointCloudAtTimeCopc(
  source: SingleBagSource,
  colorMode: ColorMode = 'height',
  maxPoints?: number,
  maxRange?: number,
  heightAxis: HeightAxis = '+z',
  axisClip?: AxisClip,
  budget = NODE_POINT_BUDGET,
): Promise<(PointCloudExtraction & { timestamp: bigint }) | null> {
  const file = await openCopc(source);
  if (!file) return null;
  const { cloud } = await file.cloud(axisClip, budget);
  const decoded = decodePointCloud2(cloud, { colorMode, maxPoints, maxRange, heightAxis, axisClip });
  return decoded ? { ...decoded, timestamp: 0n } : null;
}

export function disposeCopcCache(): void {
  opened.clear();
}
