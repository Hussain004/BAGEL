/**
 * MCAP File Parser
 *
 * Parses .mcap ROS2 bag files using @mcap/core.
 * MCAP files embed schemas directly, so we can deserialize
 * any message type found in the file.
 *
 * Beyond producing a BagSummary, this module exposes message-level APIs
 * (readRawMessagesMcap, readDeserializedMessagesMcap) used by panels.
 * A long-lived McapIndexedReader is cached per file to avoid re-initializing
 * the reader on every panel read.
 */

import { McapIndexedReader, McapStreamReader, type DecompressHandlers, type IReadable } from '@mcap/core';
import { BlobReadable } from '@mcap/browser';
import { ensureZstdWasmReady, decompressZstdWasm } from './zstdWasm';
import type { AllTopicStats, BagSummary, RawMessage, TopicInfo } from '../types/bag';
import { deserializeWithSchema } from './cdr';
import { translateFoxgloveMessage } from './foxgloveSchemas';
import { isVideoKeyframe, type VideoChunk, type VideoChunksResult } from './video';
import {
  HttpReadable,
  sourceDisplayName,
  sourceKey,
  sourceReadAll,
  sourceSize,
  type BagSource,
} from './source';

/**
 * Build the right `IReadable` for the MCAP indexed reader: `BlobReadable`
 * for local File handles (range-reads against the Blob), `HttpReadable` for
 * remote URLs (HTTP Range requests). Lives here rather than in `source.ts`
 * so the `@mcap/browser` import doesn't get pulled into the main bundle.
 */
function readableFor(source: BagSource): IReadable {
  if (source.kind === 'file') return new BlobReadable(source.file);
  return new HttpReadable(source.url, BigInt(source.contentLength));
}

/**
 * Decompression handlers for MCAP chunks.
 *
 * MCAP chunks can be uncompressed, lz4, zstd, or bz2. ROS2 bags recorded
 * with `--storage mcap` and compression enabled produce zstd chunks; some
 * tools (e.g. arkit-to-mcap) only emit zstd. Without these handlers the
 * IndexedReader rejects every compressed chunk with "Unsupported
 * compression zstd".
 *
 * zstd decompression runs through `zstd-wasm` (see zstdWasm.ts) rather
 * than the official `@foxglove/wasm-zstd`, because that package's CJS
 * require() form doesn't bundle under Vite 8's Rolldown bundler; `zstd-wasm`
 * ships genuine ESM and works, at ~3x the decode speed of the pure-JS
 * fallback this replaced. lz4 and bz2 are not implemented; an unsupported
 * compression will surface a clear error at read time.
 *
 * Chunk caching: every call to `readMessages({ startTime })` from the
 * IndexedReader causes the chunk containing that timestamp to be
 * re-decompressed from scratch. That's catastrophic during image-topic
 * playback — at 30 Hz scrubbing through a topic whose frames all live in
 * the same 30-second chunk, we'd decompress the same multi-megabyte
 * chunk thirty times a second. The cache below keys decompressed
 * buffers by a fingerprint of the compressed bytes (length + sampled
 * FNV-1a from head/middle/tail) and is bounded by total decompressed
 * size, evicting LRU. The cache is per-bag — disposing the cached
 * MCAP releases the chunks alongside the reader.
 */

const CHUNK_CACHE_MAX_BYTES = 256 * 1024 * 1024;

interface ChunkCacheEntry {
  data: Uint8Array;
  ts: number;
}

class ChunkCache {
  private readonly entries = new Map<string, ChunkCacheEntry>();
  private totalBytes = 0;
  private tickCounter = 0;
  private readonly maxBytes: number;
  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  get(key: string): Uint8Array | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    e.ts = ++this.tickCounter;
    return e.data;
  }

  set(key: string, data: Uint8Array): void {
    if (this.entries.has(key)) return;
    while (
      this.totalBytes + data.byteLength > this.maxBytes &&
      this.entries.size > 0
    ) {
      this.evictOldest();
    }
    this.entries.set(key, { data, ts: ++this.tickCounter });
    this.totalBytes += data.byteLength;
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [k, v] of this.entries) {
      if (v.ts < oldestTs) {
        oldestTs = v.ts;
        oldestKey = k;
      }
    }
    if (oldestKey === null) return;
    const evicted = this.entries.get(oldestKey)!;
    this.totalBytes -= evicted.data.byteLength;
    this.entries.delete(oldestKey);
  }
}

/**
 * Fingerprint a compressed buffer using FNV-1a over ~192 sampled bytes
 * plus the length. Two distinct MCAP chunks would have to collide on all
 * of head / middle / tail samples *and* have identical lengths to share a
 * key, which is vanishingly unlikely for real bag data.
 */
function fingerprintBuffer(buf: Uint8Array): string {
  const len = buf.length;
  if (len === 0) return 'e';
  const FNV_PRIME = 16777619;
  let h = 2166136261;
  const headEnd = Math.min(64, len);
  for (let i = 0; i < headEnd; i++) h = Math.imul(h ^ buf[i], FNV_PRIME);
  if (len > 256) {
    const mid = (len >> 1) - 32;
    for (let i = 0; i < 64; i++) h = Math.imul(h ^ buf[mid + i], FNV_PRIME);
  }
  if (len > 128) {
    const tail = len - 64;
    for (let i = 0; i < 64; i++) h = Math.imul(h ^ buf[tail + i], FNV_PRIME);
  }
  return `${len}|${(h >>> 0).toString(36)}`;
}

function makeDecompressHandlers(chunkCache: ChunkCache): DecompressHandlers {
  return {
    zstd: (buffer, decompressedSize) => {
      const key = fingerprintBuffer(buffer);
      const hit = chunkCache.get(key);
      if (hit) return hit;
      const out = decompressZstdWasm(buffer, decompressedSize);
      chunkCache.set(key, out);
      return out;
    },
  };
}

interface CachedMcap {
  /** Stable source key (file name+size, or URL). */
  sourceKey: string;
  /** Display name for the eventual `BagSummary.fileName` field. */
  displayName: string;
  /** Total bytes (file size or HTTP Content-Length). */
  size: number;
  reader: McapIndexedReader | null;
  buffer: Uint8Array | null;
  channelById: Map<number, { topic: string; schemaId: number; messageEncoding: string }>;
  schemaById: Map<number, { name: string; encoding: string; data: Uint8Array }>;
  topicMeta: Map<string, { schemaName: string; schemaText: string | null; messageEncoding: string }>;
  decompressHandlers: DecompressHandlers;
  chunkCache: ChunkCache;
  /** Per-topic LRU of the most recently returned decoded messages. Keyed
   *  by topic and indexed by message logTime — lets scrubbing inside a
   *  single frame's validity range short-circuit the entire read pipeline. */
  messageCache: Map<string, Map<bigint, Record<string, unknown> | null>>;
  /** Per-video-topic keyframe timestamp index. Built lazily on first seek. */
  videoIndex: Map<string, { format: string; keyframeTimes: bigint[] }>;
}

let cached: CachedMcap | null = null;

function decodeSchemaText(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

export function disposeMcapCache(): void {
  if (cached) {
    cached.chunkCache.clear();
    cached.messageCache.clear();
  }
  cached = null;
}

/**
 * Files larger than this skip the stream-reader fallback. The stream reader
 * needs the whole file as a Uint8Array, which fails for multi-GB bags
 * (browsers cap ArrayBuffer allocations around ~2 GB and `file.arrayBuffer()`
 * rejects with "requested file could not be read" once memory is exhausted).
 * The indexed reader does range reads via BlobReadable instead, so any file
 * with a summary section still works regardless of size.
 */
const STREAM_FALLBACK_MAX_BYTES = 512 * 1024 * 1024;

async function loadMcap(source: BagSource): Promise<CachedMcap> {
  const key = sourceKey(source);
  if (cached && cached.sourceKey === key) {
    return cached;
  }

  // The zstd WASM module must finish instantiating before any decompress
  // handler can run (the handler itself has to stay synchronous, see
  // zstdWasm.ts) — await it once per bag load, before it's ever needed.
  await ensureZstdWasmReady();

  // Per-bag chunk cache so consecutive image-playback frames don't keep
  // re-decompressing the same multi-megabyte zstd chunk.
  const chunkCache = new ChunkCache(CHUNK_CACHE_MAX_BYTES);
  const decompressHandlers = makeDecompressHandlers(chunkCache);
  const messageCache = new Map<string, Map<bigint, Record<string, unknown> | null>>();
  const videoIndex = new Map<string, { format: string; keyframeTimes: bigint[] }>();

  const size = sourceSize(source);
  const displayName = sourceDisplayName(source);

  // BlobReadable for file sources (range-reads directly against the Blob),
  // HttpReadable for URLs. Either way the IndexedReader sees the same
  // `IReadable` interface.
  const readable = readableFor(source);

  let reader: McapIndexedReader | null = null;
  let buffer: Uint8Array | null = null;
  const channelById = new Map<number, { topic: string; schemaId: number; messageEncoding: string }>();
  const schemaById = new Map<number, { name: string; encoding: string; data: Uint8Array }>();
  const topicMeta = new Map<string, { schemaName: string; schemaText: string | null; messageEncoding: string }>();

  let indexedError: unknown = null;
  try {
    reader = await McapIndexedReader.Initialize({ readable, decompressHandlers });
    for (const schema of reader.schemasById.values()) {
      schemaById.set(schema.id, {
        name: schema.name,
        encoding: schema.encoding,
        data: schema.data,
      });
    }
    for (const channel of reader.channelsById.values()) {
      channelById.set(channel.id, {
        topic: channel.topic,
        schemaId: channel.schemaId,
        messageEncoding: channel.messageEncoding,
      });
      const schema = schemaById.get(channel.schemaId);
      topicMeta.set(channel.topic, {
        schemaName: schema?.name ?? 'unknown',
        schemaText: schema ? decodeSchemaText(schema.data) : null,
        messageEncoding: channel.messageEncoding,
      });
    }
  } catch (err) {
    indexedError = err;
  }

  if (!reader) {
    if (size > STREAM_FALLBACK_MAX_BYTES) {
      const sizeMb = (size / (1024 * 1024)).toFixed(0);
      const detail =
        indexedError instanceof Error ? indexedError.message : String(indexedError);
      throw new Error(
        `"${displayName}" (${sizeMb} MB) does not have an MCAP summary/index section, ` +
          'so we would need to load the whole file into memory to scan it linearly. ' +
          'That is not supported for files over 512 MB in the browser. Re-record the ' +
          'bag with an index (the default for recent ros2_bag_mcap recorders) or run ' +
          '`mcap recover` over the file, then try again. (' + detail + ')',
      );
    }

    try {
      buffer = await sourceReadAll(source);
    } catch (streamErr) {
      const indexedDetail =
        indexedError instanceof Error ? indexedError.message : String(indexedError);
      const streamDetail =
        streamErr instanceof Error ? streamErr.message : String(streamErr);
      throw new Error(
        `Failed to load "${displayName}": the MCAP index could not be read ` +
          `(${indexedDetail}), and the full-file fallback also failed (${streamDetail}). ` +
          `If this file was loaded from a URL, try clearing your browser cache ` +
          `(Ctrl+Shift+R / Cmd+Shift+R) and reloading.`,
        { cause: streamErr },
      );
    }
    const streamReader = new McapStreamReader({ decompressHandlers });
    streamReader.append(buffer);
    for (let record; (record = streamReader.nextRecord()); ) {
      if (record.type === 'Schema') {
        schemaById.set(record.id, {
          name: record.name,
          encoding: record.encoding,
          data: record.data,
        });
      } else if (record.type === 'Channel') {
        channelById.set(record.id, {
          topic: record.topic,
          schemaId: record.schemaId,
          messageEncoding: record.messageEncoding,
        });
      }
    }
    for (const [, ch] of channelById) {
      const schema = schemaById.get(ch.schemaId);
      topicMeta.set(ch.topic, {
        schemaName: schema?.name ?? 'unknown',
        schemaText: schema ? decodeSchemaText(schema.data) : null,
        messageEncoding: ch.messageEncoding,
      });
    }
  }

  cached = {
    sourceKey: key,
    displayName,
    size,
    reader,
    buffer,
    channelById,
    schemaById,
    topicMeta,
    decompressHandlers,
    chunkCache,
    messageCache,
    videoIndex,
  };
  return cached;
}

export async function parseMcap(source: BagSource): Promise<BagSummary> {
  const meta = await loadMcap(source);

  if (meta.reader) {
    return extractSummaryFromIndexed(meta);
  }
  if (meta.buffer) {
    return extractSummaryFromStream(meta);
  }

  throw new Error(
    `"${meta.displayName}" does not appear to be a valid MCAP file. ` +
      'The file header does not match the MCAP format. ' +
      'Please ensure you are uploading a .mcap bag file recorded by ROS2.',
  );
}

function extractSummaryFromIndexed(meta: CachedMcap): BagSummary {
  const reader = meta.reader!;
  const messageCounts = new Map<number, number>();

  if (reader.statistics) {
    for (const [channelId, count] of reader.statistics.channelMessageCounts) {
      messageCounts.set(channelId, Number(count));
    }
  }

  const topics: TopicInfo[] = [];
  for (const [channelId, ch] of meta.channelById) {
    const schema = meta.schemaById.get(ch.schemaId);
    topics.push({
      name: ch.topic,
      type: schema?.name ?? 'unknown',
      messageCount: messageCounts.get(channelId) ?? 0,
      serializationFormat: 'cdr',
    });
  }

  const startTime = reader.statistics?.messageStartTime ?? 0n;
  const endTime = reader.statistics?.messageEndTime ?? 0n;
  const duration = Number(endTime - startTime) / 1e9;
  const totalMessageCount = reader.statistics
    ? Number(reader.statistics.messageCount)
    : topics.reduce((sum, t) => sum + t.messageCount, 0);

  if (duration > 0) {
    for (const topic of topics) {
      topic.frequency = Math.round((topic.messageCount / duration) * 10) / 10;
    }
  }

  return {
    format: 'mcap',
    fileName: meta.displayName,
    fileSize: meta.size,
    startTime,
    endTime,
    duration,
    totalMessageCount,
    topics: topics.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function extractSummaryFromStream(meta: CachedMcap): BagSummary {
  const reader = new McapStreamReader({ decompressHandlers: meta.decompressHandlers });
  reader.append(meta.buffer!);

  const channelMessageCounts = new Map<number, number>();
  let minTimestamp = BigInt(Number.MAX_SAFE_INTEGER) * 1_000_000_000n;
  let maxTimestamp = 0n;
  let totalMessages = 0;

  for (let record; (record = reader.nextRecord()); ) {
    if (record.type === 'Message') {
      totalMessages++;
      const count = channelMessageCounts.get(record.channelId) ?? 0;
      channelMessageCounts.set(record.channelId, count + 1);
      if (record.logTime < minTimestamp) minTimestamp = record.logTime;
      if (record.logTime > maxTimestamp) maxTimestamp = record.logTime;
    }
  }

  const duration = Number(maxTimestamp - minTimestamp) / 1e9;
  const topics: TopicInfo[] = [];
  for (const [channelId, ch] of meta.channelById) {
    const schema = meta.schemaById.get(ch.schemaId);
    const count = channelMessageCounts.get(channelId) ?? 0;
    topics.push({
      name: ch.topic,
      type: schema?.name ?? 'unknown',
      messageCount: count,
      serializationFormat: 'cdr',
      frequency: duration > 0 ? Math.round((count / duration) * 10) / 10 : undefined,
    });
  }

  return {
    format: 'mcap',
    fileName: meta.displayName,
    fileSize: meta.size,
    startTime: minTimestamp,
    endTime: maxTimestamp,
    duration,
    totalMessageCount: totalMessages,
    topics: topics.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function readRawMessagesMcap(
  source: BagSource,
  topicName: string,
  limit?: number,
): Promise<RawMessage[]> {
  const meta = await loadMcap(source);
  const out: RawMessage[] = [];

  if (meta.reader) {
    for await (const msg of meta.reader.readMessages({ topics: [topicName] })) {
      out.push({
        topicName,
        timestamp: msg.logTime,
        data: msg.data instanceof Uint8Array ? msg.data : new Uint8Array(msg.data),
      });
      if (limit && out.length >= limit) break;
    }
    return out;
  }

  if (meta.buffer) {
    const reader = new McapStreamReader({ decompressHandlers: meta.decompressHandlers });
    reader.append(meta.buffer);
    const channelIdsForTopic = new Set<number>();
    for (const [id, ch] of meta.channelById) {
      if (ch.topic === topicName) channelIdsForTopic.add(id);
    }
    for (let record; (record = reader.nextRecord()); ) {
      if (record.type === 'Message' && channelIdsForTopic.has(record.channelId)) {
        out.push({
          topicName,
          timestamp: record.logTime,
          data: record.data instanceof Uint8Array ? record.data : new Uint8Array(record.data),
        });
        if (limit && out.length >= limit) break;
      }
    }
  }
  return out;
}

/**
 * Read + CDR-deserialize every message on a topic in a single pass.
 *
 * Optional `onProgress` is fired roughly every YIELD_EVERY messages and
 * after each yield so callers can surface a "decoded N of ~M" indicator.
 * The yields also keep the main thread responsive (close buttons, scrub
 * gestures stay snappy while a multi-thousand-message topic decodes).
 */
const YIELD_EVERY = 500;

export async function readDeserializedMessagesMcap(
  source: BagSource,
  topicName: string,
  limit?: number,
  onProgress?: (decoded: number) => void,
  onBatch?: (batch: { timestamp: bigint; value: Record<string, unknown> | null }[]) => void,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null }[]> {
  const meta = await loadMcap(source);
  const topicInfo = meta.topicMeta.get(topicName);
  if (!topicInfo || (!topicInfo.schemaText && topicInfo.messageEncoding !== 'json')) return [];
  const schemaText = topicInfo.schemaText;
  const isJson = topicInfo.messageEncoding === 'json';

  const out: { timestamp: bigint; value: Record<string, unknown> | null }[] = [];
  // Tracks the boundary between "already streamed via onBatch" and the
  // not-yet-flushed tail of `out`. We hand callers a slice rather than a
  // running buffer so they own their batch lifetime (and so the worker
  // can immediately ship it without worrying about future mutations).
  let lastFlushedIndex = 0;

  const decodeOne = (raw: Uint8Array): Record<string, unknown> | null => {
    try {
      if (isJson) {
        const parsed = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
        return translateFoxgloveMessage(topicInfo.schemaName, parsed);
      }
      return deserializeWithSchema(schemaText!, raw);
    } catch {
      return null;
    }
  };

  const tick = async () => {
    if (out.length % YIELD_EVERY === 0) {
      onProgress?.(out.length);
      if (onBatch && out.length > lastFlushedIndex) {
        onBatch(out.slice(lastFlushedIndex));
        lastFlushedIndex = out.length;
      }
      // Hand control back to the browser so layout / input / rAF can run.
      await new Promise((r) => setTimeout(r, 0));
    }
  };

  const flushTail = () => {
    onProgress?.(out.length);
    if (onBatch && out.length > lastFlushedIndex) {
      onBatch(out.slice(lastFlushedIndex));
      lastFlushedIndex = out.length;
    }
  };

  if (meta.reader) {
    for await (const msg of meta.reader.readMessages({ topics: [topicName] })) {
      out.push({ timestamp: msg.logTime, value: decodeOne(msg.data) });
      if (limit && out.length >= limit) break;
      await tick();
    }
    flushTail();
    return out;
  }

  if (meta.buffer) {
    const reader = new McapStreamReader({ decompressHandlers: meta.decompressHandlers });
    reader.append(meta.buffer);
    const channelIdsForTopic = new Set<number>();
    for (const [id, ch] of meta.channelById) {
      if (ch.topic === topicName) channelIdsForTopic.add(id);
    }
    for (let record; (record = reader.nextRecord()); ) {
      if (record.type !== 'Message' || !channelIdsForTopic.has(record.channelId)) continue;
      const data =
        record.data instanceof Uint8Array ? record.data : new Uint8Array(record.data);
      out.push({ timestamp: record.logTime, value: decodeOne(data) });
      if (limit && out.length >= limit) break;
      await tick();
    }
    flushTail();
  }
  return out;
}

export async function getTopicTypeMcap(
  source: BagSource,
  topicName: string,
): Promise<string | undefined> {
  const meta = await loadMcap(source);
  return meta.topicMeta.get(topicName)?.schemaName;
}

// --- Fast message-index readers (no chunk decompression) -------------------

function readU16LE(b: Uint8Array, o: number): number {
  return b[o] | (b[o + 1] << 8);
}
function readU32LE(b: Uint8Array, o: number): number {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
function readU64LENum(b: Uint8Array, o: number): number {
  // Used only for record body lengths (never exceed 2^53 in practice).
  return readU32LE(b, o + 4) * 0x100000000 + readU32LE(b, o);
}
function readU64LEBig(b: Uint8Array, o: number): bigint {
  return (BigInt(readU32LE(b, o + 4)) << 32n) | BigInt(readU32LE(b, o));
}

const MCAP_MAX_SAMPLES_PER_TOPIC = 50_000;

export async function readAllMessageStatsMcap(source: BagSource): Promise<AllTopicStats> {
  const meta = await loadMcap(source);

  if (meta.reader && meta.reader.chunkIndexes.length > 0) {
    return readStatsFromMcapIndexes(source, meta);
  }

  // Stream fallback (non-indexed files, already in memory as meta.buffer).
  const rawTimes = new Map<string, bigint[]>();
  const rawSizes = new Map<string, number[]>();

  if (meta.buffer) {
    const streamReader = new McapStreamReader({ decompressHandlers: meta.decompressHandlers });
    streamReader.append(meta.buffer);
    for (let record; (record = streamReader.nextRecord()); ) {
      if (record.type !== 'Message') continue;
      const ch = meta.channelById.get(record.channelId);
      if (!ch) continue;
      const { topic } = ch;
      let t = rawTimes.get(topic);
      if (!t) { t = []; rawTimes.set(topic, t); }
      if (t.length < MCAP_MAX_SAMPLES_PER_TOPIC) t.push(record.logTime);
      let s = rawSizes.get(topic);
      if (!s) { s = []; rawSizes.set(topic, s); }
      if (s.length < MCAP_MAX_SAMPLES_PER_TOPIC) s.push(record.data.byteLength);
    }
  }

  let startNs = 0n;
  for (const times of rawTimes.values()) {
    for (const t of times) if (startNs === 0n || t < startNs) startNs = t;
  }

  const result: AllTopicStats = {};
  for (const [topic, times] of rawTimes) {
    const sizes = rawSizes.get(topic)!;
    const relTimes = new Float64Array(times.length);
    for (let i = 0; i < times.length; i++) relTimes[i] = Number(times[i] - startNs);
    result[topic] = { times: relTimes, sizes: new Uint32Array(sizes) };
  }
  return result;
}

/**
 * Fast path: read MCAP MessageIndex records directly from file without
 * decompressing any chunk data. MessageIndex records contain (logTime, offset)
 * pairs for every message in a chunk — exactly the timestamps we need.
 *
 * For a typical 1 GB compressed bag this reads ~N*16 bytes of index data
 * instead of gigabytes of compressed chunks, making it orders of magnitude
 * faster than readMessages({}).
 *
 * Layout of a MessageIndex record (op=0x07):
 *   op(1) + bodyLen(8) + channelId(2) + recordsByteLen(4) + [(logTime(8)+offset(8))*N]
 */
async function readStatsFromMcapIndexes(
  source: BagSource,
  meta: CachedMcap,
): Promise<AllTopicStats> {
  const reader = meta.reader!;
  const startNs = reader.statistics?.messageStartTime ?? 0n;
  const readable = readableFor(source);

  const rawTimes = new Map<string, bigint[]>();
  const topicTotalBytes = new Map<string, number>();
  const topicTotalCount = new Map<string, number>();

  for (const chunkIndex of reader.chunkIndexes) {
    if (chunkIndex.messageIndexOffsets.size === 0 || chunkIndex.messageIndexLength === 0n) continue;

    // Find the file offset of the first MessageIndex record for this chunk.
    let firstOffset = 0n;
    let first = true;
    for (const off of chunkIndex.messageIndexOffsets.values()) {
      if (first || off < firstOffset) { firstOffset = off; first = false; }
    }

    // One I/O call reads all MessageIndex records for this chunk.
    const buf = await readable.read(firstOffset, chunkIndex.messageIndexLength);

    // Parse concatenated MessageIndex records.
    let pos = 0;
    while (pos + 9 <= buf.length) {
      if (buf[pos] !== 0x07) break; // unexpected opcode
      const bodyLen = readU64LENum(buf, pos + 1);
      if (pos + 9 + bodyLen > buf.length) break;

      const channelId = readU16LE(buf, pos + 9);
      const recordsByteLen = readU32LE(buf, pos + 11);
      const numRecords = Math.floor(recordsByteLen / 16);

      const ch = meta.channelById.get(channelId);
      if (ch) {
        const { topic } = ch;
        let times = rawTimes.get(topic);
        if (!times) { times = []; rawTimes.set(topic, times); }

        const existing = times.length;
        const capacity = MCAP_MAX_SAMPLES_PER_TOPIC - existing;
        const step = capacity > 0 ? Math.max(1, Math.floor(numRecords / Math.min(numRecords, capacity))) : 0;

        if (step > 0) {
          for (let i = 0; i < numRecords; i += step) {
            const o = pos + 15 + i * 16;
            if (o + 8 > buf.length) break;
            times.push(readU64LEBig(buf, o));
          }
        }

        const channelCount = chunkIndex.messageIndexOffsets.size;
        topicTotalBytes.set(
          topic,
          (topicTotalBytes.get(topic) ?? 0) + Number(chunkIndex.uncompressedSize) / channelCount,
        );
        topicTotalCount.set(topic, (topicTotalCount.get(topic) ?? 0) + numRecords);
      }

      pos += 9 + bodyLen;
    }
  }

  const result: AllTopicStats = {};
  for (const [topic, times] of rawTimes) {
    times.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const n = times.length;
    const relTimes = new Float64Array(n);
    for (let i = 0; i < n; i++) relTimes[i] = Number(times[i] - startNs);

    const totalBytes = topicTotalBytes.get(topic) ?? 0;
    const totalCount = topicTotalCount.get(topic) ?? n;
    const avgSize = totalCount > 0 ? Math.round(totalBytes / totalCount) : 100;

    result[topic] = { times: relTimes, sizes: new Uint32Array(n).fill(avgSize) };
  }
  return result;
}

/**
 * Sliver of the cached MCAP state needed for v1.1 bag editing. Re-exposes
 * the indexed reader (and a hint about whether stream fallback is in play)
 * so `parsers/edit.ts` can reuse the parse work the user already paid for.
 *
 * Intentionally narrower than the full `CachedMcap` so we don't accidentally
 * leak internal cache shape into another module that doesn't need it.
 */
export interface CachedMcapForEdit {
  reader: CachedMcap['reader'];
}

/** Resolve the cached MCAP reader for `source`, lazily loading if needed. */
export async function loadMcapForEdit(source: BagSource): Promise<CachedMcapForEdit> {
  const meta = await loadMcap(source);
  return { reader: meta.reader };
}

/** Per-topic decoded-message LRU bound. Big enough to cover both directions
 *  of a scrub through a handful of adjacent frames; small enough that raw
 *  1080p images (~6 MB each) don't blow up the worker heap. */
const MESSAGE_CACHE_MAX_PER_TOPIC = 6;

function rememberDecoded(
  meta: CachedMcap,
  topicName: string,
  logTime: bigint,
  raw: Uint8Array,
  decode: (raw: Uint8Array) => Record<string, unknown> | null,
): Record<string, unknown> | null {
  let perTopic = meta.messageCache.get(topicName);
  if (!perTopic) {
    perTopic = new Map();
    meta.messageCache.set(topicName, perTopic);
  } else if (perTopic.has(logTime)) {
    // Cache hit — skip the (potentially expensive) CDR decode entirely.
    // Re-insert to bump it to the most-recently-used end of the map.
    const cached = perTopic.get(logTime)!;
    perTopic.delete(logTime);
    perTopic.set(logTime, cached);
    return cached;
  }
  const value = decode(raw);
  perTopic.set(logTime, value);
  while (perTopic.size > MESSAGE_CACHE_MAX_PER_TOPIC) {
    const oldest = perTopic.keys().next().value;
    if (oldest === undefined) break;
    perTopic.delete(oldest);
  }
  return value;
}

/**
 * Read and deserialize a single message near `timeNs` for a topic.
 *
 * Used by the Image and Raw inspector panels which only ever need the
 * one frame at the current playhead — not every message on the topic
 * (which can be gigabytes for image streams in compressed bags).
 *
 * Strategy: ask the IndexedReader for messages starting at `timeNs` and
 * take the first hit. If there's nothing at-or-after (playhead past the
 * last message), seek backward. Only the chunks that contain the answer
 * get decompressed, so this is O(one chunk) instead of O(whole topic).
 *
 * Two layers of caching keep image-topic playback smooth:
 *  - the chunk decompression cache amortises zstd cost across every
 *    frame in the same chunk;
 *  - the per-topic decoded-message LRU below short-circuits the CDR
 *    decode when the same frame's logTime is requested again (which
 *    happens whenever the playhead ticks at a higher rate than the
 *    topic publishes).
 */
export async function readMessageAtTimeMcap(
  source: BagSource,
  topicName: string,
  timeNs: bigint,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null } | null> {
  const meta = await loadMcap(source);
  const topicInfo = meta.topicMeta.get(topicName);
  if (!topicInfo || (!topicInfo.schemaText && topicInfo.messageEncoding !== 'json')) return null;

  const schemaText = topicInfo.schemaText;
  const isJson = topicInfo.messageEncoding === 'json';
  const decode = (raw: Uint8Array): Record<string, unknown> | null => {
    try {
      if (isJson) {
        const parsed = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
        return translateFoxgloveMessage(topicInfo.schemaName, parsed);
      }
      return deserializeWithSchema(schemaText!, raw);
    } catch {
      return null;
    }
  };

  if (meta.reader) {
    for await (const msg of meta.reader.readMessages({
      topics: [topicName],
      startTime: timeNs,
    })) {
      const value = rememberDecoded(meta, topicName, msg.logTime, msg.data, decode);
      return { timestamp: msg.logTime, value };
    }
    // Nothing at or after — fall back to the latest message at or before.
    for await (const msg of meta.reader.readMessages({
      topics: [topicName],
      endTime: timeNs,
      reverse: true,
    })) {
      const value = rememberDecoded(meta, topicName, msg.logTime, msg.data, decode);
      return { timestamp: msg.logTime, value };
    }
    return null;
  }

  // Stream-reader fallback: scan and keep the message closest to timeNs.
  if (meta.buffer) {
    const reader = new McapStreamReader({ decompressHandlers: meta.decompressHandlers });
    reader.append(meta.buffer);
    const channelIdsForTopic = new Set<number>();
    for (const [id, ch] of meta.channelById) {
      if (ch.topic === topicName) channelIdsForTopic.add(id);
    }
    let bestTs: bigint | null = null;
    let bestData: Uint8Array | null = null;
    for (let record; (record = reader.nextRecord()); ) {
      if (record.type !== 'Message' || !channelIdsForTopic.has(record.channelId)) continue;
      const dist =
        record.logTime > timeNs ? record.logTime - timeNs : timeNs - record.logTime;
      const bestDist =
        bestTs === null
          ? null
          : bestTs > timeNs
            ? bestTs - timeNs
            : timeNs - bestTs;
      if (bestDist === null || dist < bestDist) {
        bestTs = record.logTime;
        bestData = record.data instanceof Uint8Array ? record.data : new Uint8Array(record.data);
      }
    }
    if (bestTs !== null && bestData) {
      const value = rememberDecoded(meta, topicName, bestTs, bestData, decode);
      return { timestamp: bestTs, value };
    }
  }
  return null;
}

// ─── Video chunk reader ─────────────────────────────────────────────────────

const TEXT_DEC = new TextDecoder();

/**
 * Extract raw H264/H265 bytes and keyframe status from a raw MCAP message
 * payload for a video topic, handling both JSON and CDR encodings.
 */
function extractVideoChunk(
  topicInfo: { schemaName: string; messageEncoding: string },
  logTime: bigint,
  raw: Uint8Array,
  format: string,
): VideoChunk {
  let data: Uint8Array;
  if (topicInfo.messageEncoding === 'json') {
    try {
      const parsed = JSON.parse(TEXT_DEC.decode(raw)) as Record<string, unknown>;
      const xlated = translateFoxgloveMessage(topicInfo.schemaName, parsed);
      const d = xlated['data'];
      data = d instanceof Uint8Array ? d : new Uint8Array(0);
    } catch {
      data = new Uint8Array(0);
    }
  } else {
    // CDR: assume the message carries raw NAL bytes directly
    data = new Uint8Array(raw);
  }
  return { data, timestamp: logTime, isKeyframe: isVideoKeyframe(data, format) };
}

/**
 * Build a per-topic keyframe index by scanning all messages and checking
 * the first few NAL unit bytes for IDR/SPS headers.
 *
 * For JSON MCAP (Foxglove), only the first ~20 bytes of the base64 payload
 * are decoded to determine keyframe status, keeping index construction fast.
 */
async function getOrBuildVideoIndex(
  meta: CachedMcap,
  topicName: string,
): Promise<{ format: string; keyframeTimes: bigint[] } | null> {
  const existing = meta.videoIndex.get(topicName);
  if (existing) return existing;

  const topicInfo = meta.topicMeta.get(topicName);
  if (!topicInfo) return null;

  const isJson = topicInfo.messageEncoding === 'json';
  let format = 'h264';
  const keyframeTimes: bigint[] = [];

  const inspect = (logTime: bigint, raw: Uint8Array): void => {
    let data: Uint8Array;
    if (isJson) {
      try {
        // Fast path: only decode the first 24 base64 chars (~18 raw bytes) -
        // enough to read the start code and first NAL header byte.
        const obj = JSON.parse(TEXT_DEC.decode(raw)) as Record<string, unknown>;
        if (typeof obj['format'] === 'string' && obj['format']) format = obj['format'] as string;
        const b64 = obj['data'] as string;
        if (typeof b64 !== 'string' || b64.length === 0) return;
        const sample = atob(b64.substring(0, Math.min(24, b64.length)));
        data = new Uint8Array(sample.length);
        for (let k = 0; k < sample.length; k++) data[k] = sample.charCodeAt(k);
      } catch {
        return;
      }
    } else {
      data = raw;
    }
    if (isVideoKeyframe(data, format)) keyframeTimes.push(logTime);
  };

  if (meta.reader) {
    for await (const msg of meta.reader.readMessages({ topics: [topicName] })) {
      const raw = msg.data instanceof Uint8Array ? msg.data : new Uint8Array(msg.data);
      inspect(msg.logTime, raw);
    }
  } else if (meta.buffer) {
    const reader = new McapStreamReader({ decompressHandlers: meta.decompressHandlers });
    reader.append(meta.buffer);
    const channelIdsForTopic = new Set<number>();
    for (const [id, ch] of meta.channelById) {
      if (ch.topic === topicName) channelIdsForTopic.add(id);
    }
    for (let record; (record = reader.nextRecord()); ) {
      if (record.type !== 'Message' || !channelIdsForTopic.has(record.channelId)) continue;
      const raw = record.data instanceof Uint8Array ? record.data : new Uint8Array(record.data);
      inspect(record.logTime, raw);
    }
  }

  const index = { format, keyframeTimes };
  meta.videoIndex.set(topicName, index);
  return index;
}

/**
 * Read video chunks from the last keyframe at or before `timeNs` through
 * `timeNs`, ready for the main-thread VideoDecoder to decode.
 *
 * Building the keyframe index on first call may take a few seconds for long
 * recordings, but subsequent seeks are O(GOP size) - typically 1-60 frames.
 */
export async function readVideoChunksMcap(
  source: BagSource,
  topicName: string,
  timeNs: bigint,
): Promise<VideoChunksResult | null> {
  const meta = await loadMcap(source);
  const topicInfo = meta.topicMeta.get(topicName);
  if (!topicInfo) return null;

  const index = await getOrBuildVideoIndex(meta, topicName);
  if (!index) return null;

  // Binary search: last keyframe at or before timeNs
  const { format, keyframeTimes } = index;
  let lo = 0;
  let hi = keyframeTimes.length - 1;
  let keyframeNs: bigint | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (keyframeTimes[mid] <= timeNs) {
      keyframeNs = keyframeTimes[mid];
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (keyframeNs === null) return null;

  const chunks: VideoChunk[] = [];

  if (meta.reader) {
    for await (const msg of meta.reader.readMessages({
      topics: [topicName],
      startTime: keyframeNs,
      endTime: timeNs,
    })) {
      const raw = msg.data instanceof Uint8Array ? msg.data : new Uint8Array(msg.data);
      chunks.push(extractVideoChunk(topicInfo, msg.logTime, raw, format));
    }
  } else if (meta.buffer) {
    const reader = new McapStreamReader({ decompressHandlers: meta.decompressHandlers });
    reader.append(meta.buffer);
    const channelIdsForTopic = new Set<number>();
    for (const [id, ch] of meta.channelById) {
      if (ch.topic === topicName) channelIdsForTopic.add(id);
    }
    for (let record; (record = reader.nextRecord()); ) {
      if (record.type !== 'Message' || !channelIdsForTopic.has(record.channelId)) continue;
      if (record.logTime < keyframeNs || record.logTime > timeNs) continue;
      const raw = record.data instanceof Uint8Array ? record.data : new Uint8Array(record.data);
      chunks.push(extractVideoChunk(topicInfo, record.logTime, raw, format));
    }
    // stream reader gives messages in file order, so sort by timestamp
    chunks.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  }

  return chunks.length > 0 ? { chunks, format } : null;
}
