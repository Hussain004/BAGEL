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
import { decompress as fzstdDecompress } from 'fzstd';
import type { BagSummary, RawMessage, TopicInfo } from '../types/bag';
import { deserializeWithSchema } from './cdr';
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
 * We use `fzstd` — a pure-JS zstd decoder — instead of the official
 * `@foxglove/wasm-zstd` because Vite 8's Rolldown bundler can't ingest
 * the WASM modules' CJS require() form. lz4 and bz2 are not implemented;
 * an unsupported compression will surface a clear error at read time.
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
      const out = fzstdDecompress(
        // fzstd accepts a typed array and an optional output buffer of the
        // expected size; pre-allocating avoids resize overhead.
        buffer,
        new Uint8Array(Number(decompressedSize)),
      );
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
  channelById: Map<number, { topic: string; schemaId: number }>;
  schemaById: Map<number, { name: string; encoding: string; data: Uint8Array }>;
  topicMeta: Map<string, { schemaName: string; schemaText: string | null }>;
  decompressHandlers: DecompressHandlers;
  chunkCache: ChunkCache;
  /** Per-topic LRU of the most recently returned decoded messages. Keyed
   *  by topic and indexed by message logTime — lets scrubbing inside a
   *  single frame's validity range short-circuit the entire read pipeline. */
  messageCache: Map<string, Map<bigint, Record<string, unknown> | null>>;
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

  // Per-bag chunk cache so consecutive image-playback frames don't keep
  // re-decompressing the same multi-megabyte zstd chunk.
  const chunkCache = new ChunkCache(CHUNK_CACHE_MAX_BYTES);
  const decompressHandlers = makeDecompressHandlers(chunkCache);
  const messageCache = new Map<string, Map<bigint, Record<string, unknown> | null>>();

  const size = sourceSize(source);
  const displayName = sourceDisplayName(source);

  // BlobReadable for file sources (range-reads directly against the Blob),
  // HttpReadable for URLs. Either way the IndexedReader sees the same
  // `IReadable` interface.
  const readable = readableFor(source);

  let reader: McapIndexedReader | null = null;
  let buffer: Uint8Array | null = null;
  const channelById = new Map<number, { topic: string; schemaId: number }>();
  const schemaById = new Map<number, { name: string; encoding: string; data: Uint8Array }>();
  const topicMeta = new Map<string, { schemaName: string; schemaText: string | null }>();

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
      });
      const schema = schemaById.get(channel.schemaId);
      topicMeta.set(channel.topic, {
        schemaName: schema?.name ?? 'unknown',
        schemaText: schema ? decodeSchemaText(schema.data) : null,
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

    buffer = await sourceReadAll(source);
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
        });
      }
    }
    for (const [, ch] of channelById) {
      const schema = schemaById.get(ch.schemaId);
      topicMeta.set(ch.topic, {
        schemaName: schema?.name ?? 'unknown',
        schemaText: schema ? decodeSchemaText(schema.data) : null,
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
  if (!topicInfo || !topicInfo.schemaText) return [];
  const schemaText = topicInfo.schemaText;

  const out: { timestamp: bigint; value: Record<string, unknown> | null }[] = [];
  // Tracks the boundary between "already streamed via onBatch" and the
  // not-yet-flushed tail of `out`. We hand callers a slice rather than a
  // running buffer so they own their batch lifetime (and so the worker
  // can immediately ship it without worrying about future mutations).
  let lastFlushedIndex = 0;

  const decodeOne = (raw: Uint8Array): Record<string, unknown> | null => {
    try {
      return deserializeWithSchema(schemaText, raw);
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
  if (!topicInfo || !topicInfo.schemaText) return null;

  const schemaText = topicInfo.schemaText;
  const decode = (raw: Uint8Array): Record<string, unknown> | null => {
    try {
      return deserializeWithSchema(schemaText, raw);
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
