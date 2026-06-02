/**
 * ROS1 .bag File Parser
 *
 * Parses legacy ROS1 bag files (rosbag v2.0) using `@foxglove/rosbag`. The
 * library exposes a streaming `Bag` reader that owns an indexed view of the
 * file — connection records (per-topic schemas), chunk infos (time ranges +
 * per-connection message counts), and a `messageIterator` that does range
 * reads against the underlying `Filelike`.
 *
 * The implementation mirrors `mcap.ts`:
 *   - one long-lived `Bag` cached per file (parse cost amortises across panels);
 *   - per-topic decoded-message LRU so image-topic playback at 30 Hz against a
 *     10 Hz publish rate doesn't re-decode the same frame three times;
 *   - the same `readDeserialized…` / `readMessageAt…` / `readRawMessages…`
 *     surface the dispatcher in `core.ts` expects.
 *
 * Differences from MCAP that the rest of the codebase shouldn't have to care about:
 *   - ROS1 message type names are `pkg/Type` (e.g. `sensor_msgs/Image`) where
 *     ROS2 / MCAP uses `pkg/msg/Type`. We normalize to the ROS2 form before
 *     publishing topics so panel dispatch (which mostly uses `.endsWith('/Foo')`
 *     already and would tolerate both, but a few spots check exact strings)
 *     stays format-agnostic.
 *   - Per-connection `messageDefinition` is the concatenated `.msg` text
 *     (primary type + dependencies separated by `=====`); the ROS1
 *     deserializer (`./rosbag1.ts`) parses it with `ros2: false`.
 *   - Times are `{ sec, nsec }` records (`@foxglove/rostime`) instead of
 *     `bigint`. We convert at the boundary so the rest of BAGEL stays on
 *     bigint nanoseconds.
 *   - Chunks can be `none`, `bz2`, or `lz4` compressed. The library doesn't
 *     bundle the decoders — we register pure-JS handlers (`seek-bzip` and
 *     `lz4js`) inside the parser worker so even the slower bz2 path doesn't
 *     block the UI. Uncompressed bags never hit the decoders at all.
 */

import { Bag } from '@foxglove/rosbag';
import { BlobReader } from '@foxglove/rosbag/web';
import type { Filelike } from '@foxglove/rosbag';
import Bunzip from 'seek-bzip';
import * as lz4 from 'lz4js';
import type { BagSummary, RawMessage, TopicInfo } from '../types/bag';
import { clearRos1ReaderCache, deserializeRos1Message } from './rosbag1';
import {
  HttpFilelike,
  sourceDisplayName,
  sourceKey,
  sourceSize,
  type BagSource,
} from './source';

/**
 * Build the right `Filelike` for the rosbag reader: `BlobReader` for local
 * File handles, `HttpFilelike` for remote URLs. Lives here rather than in
 * `source.ts` so the `@foxglove/rosbag/web` import stays out of the main bundle.
 */
function filelikeFor(source: BagSource): Filelike {
  if (source.kind === 'file') return new BlobReader(source.file);
  return new HttpFilelike(source.url, source.contentLength);
}

interface ConnectionMeta {
  conn: number;
  topic: string;
  /** Normalized type name (`pkg/msg/Type` form). */
  type: string;
  /** Raw type from the connection record, preserved for debugging only. */
  rawType: string;
  /** Concatenated `.msg` text — the deserializer's input. */
  messageDefinition: string;
}

interface CachedBag {
  sourceKey: string;
  displayName: string;
  size: number;
  bag: Bag;
  /** All connections, keyed by connection ID. ROS1 publishes one connection
   *  per (topic, publisher) pair so a topic may have multiple connections;
   *  we treat them as interchangeable since the schema is the same. */
  connectionsById: Map<number, ConnectionMeta>;
  /** Display + dispatch metadata per topic — first connection wins. */
  topicMeta: Map<string, { type: string; messageDefinition: string }>;
  /** Per-topic decoded-message LRU keyed by message log time. */
  messageCache: Map<string, Map<bigint, Record<string, unknown> | null>>;
}

let cached: CachedBag | null = null;

/**
 * ROS1 chunk decompression.
 *
 * `@foxglove/rosbag` consults this map every time it reads a compressed chunk;
 * uncompressed bags never hit it. Both decoders run inside the parser worker,
 * so even a 4 MB bz2 chunk (~500 ms on a modern laptop) doesn't block the UI.
 *
 *   - `bz2` uses `seek-bzip` (pure-JS, MIT, ~5–10 MB/s). The library's
 *     `Bunzip.decode` returns the full decompressed buffer; we re-slice when
 *     the upstream reported size disagrees, which shouldn't happen on a
 *     well-formed bag but trips trivially on a truncated chunk.
 *
 *   - `lz4` uses `lz4js`. ROS1 bags emit LZ4 *frame* format (not raw
 *     blocks), which is exactly what `lz4js.decompress` reads. We could
 *     swap to a WASM port (`@foxglove/wasm-lz4`) for ~3× the speed but the
 *     pure-JS path keeps the worker bundle small and is fast enough for
 *     typical 1–5 GB SLAM bags.
 *
 * Errors from either decoder propagate as `Bag.open()` / iteration errors
 * — the panel surfaces them in its load-error state.
 */
function decompressBz2(buffer: Uint8Array, size: number): Uint8Array {
  const decoded = Bunzip.decode(buffer);
  // Trim or expand to the upstream's expected size when they disagree —
  // matches the contract @foxglove/rosbag relies on for chunk parsing.
  if (decoded.length === size) return decoded;
  if (decoded.length > size) return decoded.subarray(0, size);
  const padded = new Uint8Array(size);
  padded.set(decoded);
  return padded;
}

function decompressLz4(buffer: Uint8Array, size: number): Uint8Array {
  const decoded = lz4.decompress(buffer, size);
  if (decoded.length === size) return decoded;
  if (decoded.length > size) return decoded.subarray(0, size);
  const padded = new Uint8Array(size);
  padded.set(decoded);
  return padded;
}

const decompress = {
  bz2: decompressBz2,
  lz4: decompressLz4,
};

function timeToNs(t: { sec: number; nsec: number } | undefined): bigint {
  if (!t) return 0n;
  return BigInt(t.sec) * 1_000_000_000n + BigInt(t.nsec);
}

function nsToTime(ns: bigint): { sec: number; nsec: number } {
  const sec = Number(ns / 1_000_000_000n);
  const nsec = Number(ns % 1_000_000_000n);
  return { sec, nsec };
}

/**
 * Normalize ROS1 type names to ROS2's `pkg/msg/Type` form. ROS1 emits two
 * forms historically: `pkg/Type` (the common case) and `pkg/msg/Type` (very
 * rare, but seen in bags generated by `rosbag1_to_rosbag2` style tools).
 */
function normalizeTypeName(raw: string | undefined): string {
  if (!raw) return 'unknown';
  if (raw.includes('/msg/')) return raw;
  const parts = raw.split('/');
  if (parts.length === 2) return `${parts[0]}/msg/${parts[1]}`;
  return raw;
}

export function disposeBagCache(): void {
  cached = null;
  clearRos1ReaderCache();
}

async function loadBag(source: BagSource): Promise<CachedBag> {
  const key = sourceKey(source);
  if (cached && cached.sourceKey === key) {
    return cached;
  }

  // BlobReader for file sources, HttpFilelike for URLs — same Filelike
  // interface either way.
  const reader = filelikeFor(source);
  // `decompress` is consulted lazily during message iteration — only chunks
  // that are actually read pay the lookup. Uncompressed bags never hit the
  // map at all.
  const bag = new Bag(reader, { decompress });
  await bag.open();

  const connectionsById = new Map<number, ConnectionMeta>();
  const topicMeta = new Map<string, { type: string; messageDefinition: string }>();
  for (const [connId, conn] of bag.connections) {
    const normalizedType = normalizeTypeName(conn.type);
    connectionsById.set(connId, {
      conn: connId,
      topic: conn.topic,
      type: normalizedType,
      rawType: conn.type ?? 'unknown',
      messageDefinition: conn.messageDefinition,
    });
    // First connection per topic wins for metadata — duplicates carry the
    // same schema in any well-formed bag.
    if (!topicMeta.has(conn.topic)) {
      topicMeta.set(conn.topic, {
        type: normalizedType,
        messageDefinition: conn.messageDefinition,
      });
    }
  }

  cached = {
    sourceKey: key,
    displayName: sourceDisplayName(source),
    size: sourceSize(source),
    bag,
    connectionsById,
    topicMeta,
    messageCache: new Map(),
  };
  return cached;
}

export async function parseBagFile(source: BagSource): Promise<BagSummary> {
  const meta = await loadBag(source);
  const { bag } = meta;

  const startTime = timeToNs(bag.startTime);
  const endTime = timeToNs(bag.endTime);
  const duration = Number(endTime - startTime) / 1e9;

  // Sum per-connection message counts across every chunk index. Cheaper than
  // iterating every message in the bag, exact when the index isn't corrupt.
  const messageCountByConn = new Map<number, number>();
  for (const chunkInfo of bag.chunkInfos) {
    for (const { conn, count } of chunkInfo.connections) {
      messageCountByConn.set(conn, (messageCountByConn.get(conn) ?? 0) + count);
    }
  }

  // Aggregate by topic — multiple connections per topic share the same
  // message stream from the panel's perspective.
  const countByTopic = new Map<string, number>();
  for (const [connId, conn] of meta.connectionsById) {
    const c = messageCountByConn.get(connId) ?? 0;
    countByTopic.set(conn.topic, (countByTopic.get(conn.topic) ?? 0) + c);
  }

  const topics: TopicInfo[] = [];
  for (const [topicName, info] of meta.topicMeta) {
    const messageCount = countByTopic.get(topicName) ?? 0;
    topics.push({
      name: topicName,
      type: info.type,
      messageCount,
      serializationFormat: 'ros1',
      frequency:
        duration > 0 ? Math.round((messageCount / duration) * 10) / 10 : undefined,
    });
  }

  const totalMessageCount = topics.reduce((sum, t) => sum + t.messageCount, 0);

  return {
    format: 'bag',
    fileName: meta.displayName,
    fileSize: meta.size,
    startTime,
    endTime,
    duration,
    totalMessageCount,
    topics: topics.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function readRawMessagesBag(
  source: BagSource,
  topicName: string,
  limit?: number,
): Promise<RawMessage[]> {
  const meta = await loadBag(source);
  const { bag } = meta;
  if (!meta.topicMeta.has(topicName)) return [];

  const out: RawMessage[] = [];
  const iterator = bag.messageIterator({ topics: [topicName] });
  for await (const event of iterator as AsyncIterable<{
    topic: string;
    timestamp: { sec: number; nsec: number };
    data: Uint8Array;
  }>) {
    const data = event.data instanceof Uint8Array ? event.data : new Uint8Array(event.data);
    out.push({
      topicName,
      timestamp: timeToNs(event.timestamp),
      data,
    });
    if (limit && out.length >= limit) break;
  }
  return out;
}

const YIELD_EVERY = 500;

export async function readDeserializedMessagesBag(
  source: BagSource,
  topicName: string,
  limit?: number,
  onProgress?: (decoded: number) => void,
  onBatch?: (batch: { timestamp: bigint; value: Record<string, unknown> | null }[]) => void,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null }[]> {
  const meta = await loadBag(source);
  const info = meta.topicMeta.get(topicName);
  if (!info) return [];
  const schemaText = info.messageDefinition;
  const cacheKey = `ros1:${topicName}`;

  const decode = (raw: Uint8Array): Record<string, unknown> | null => {
    try {
      return deserializeRos1Message(schemaText, raw, cacheKey);
    } catch {
      return null;
    }
  };

  const out: { timestamp: bigint; value: Record<string, unknown> | null }[] = [];
  let lastFlushedIndex = 0;
  const iterator = meta.bag.messageIterator({ topics: [topicName] });
  for await (const event of iterator as AsyncIterable<{
    topic: string;
    timestamp: { sec: number; nsec: number };
    data: Uint8Array;
  }>) {
    const data = event.data instanceof Uint8Array ? event.data : new Uint8Array(event.data);
    out.push({ timestamp: timeToNs(event.timestamp), value: decode(data) });
    if (limit && out.length >= limit) break;
    if (out.length % YIELD_EVERY === 0) {
      onProgress?.(out.length);
      if (onBatch && out.length > lastFlushedIndex) {
        onBatch(out.slice(lastFlushedIndex));
        lastFlushedIndex = out.length;
      }
      // Yield to the worker event loop so progress messages flush.
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(out.length);
  if (onBatch && out.length > lastFlushedIndex) {
    onBatch(out.slice(lastFlushedIndex));
  }
  return out;
}

/** Per-topic decoded LRU bound — same shape as the MCAP cache. */
const MESSAGE_CACHE_MAX_PER_TOPIC = 6;

function rememberDecoded(
  meta: CachedBag,
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
    const hit = perTopic.get(logTime)!;
    perTopic.delete(logTime);
    perTopic.set(logTime, hit);
    return hit;
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

export async function readMessageAtTimeBag(
  source: BagSource,
  topicName: string,
  timeNs: bigint,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null } | null> {
  const meta = await loadBag(source);
  const info = meta.topicMeta.get(topicName);
  if (!info) return null;

  const schemaText = info.messageDefinition;
  const cacheKey = `ros1:${topicName}`;
  const decode = (raw: Uint8Array): Record<string, unknown> | null => {
    try {
      return deserializeRos1Message(schemaText, raw, cacheKey);
    } catch {
      return null;
    }
  };

  // Forward scan starting at the playhead — picks the first message at-or-after.
  const startTime = nsToTime(timeNs);
  const forward = meta.bag.messageIterator({ topics: [topicName], start: startTime });
  for await (const event of forward as AsyncIterable<{
    topic: string;
    timestamp: { sec: number; nsec: number };
    data: Uint8Array;
  }>) {
    const ts = timeToNs(event.timestamp);
    const data = event.data instanceof Uint8Array ? event.data : new Uint8Array(event.data);
    const value = rememberDecoded(meta, topicName, ts, data, decode);
    return { timestamp: ts, value };
  }

  // Nothing at-or-after — fall back to the most recent message at-or-before.
  // Reverse iteration starts from the latest message and walks back; without
  // an end-time filter we have to scan to find the first one whose timestamp
  // is <= timeNs. Topics with sparse messages near the end of the bag will be
  // cheap; dense topics scrubbed past the end of the file may walk a few
  // chunks. Acceptable since this only fires once per playhead seek.
  const reverse = meta.bag.messageIterator({ topics: [topicName], reverse: true });
  for await (const event of reverse as AsyncIterable<{
    topic: string;
    timestamp: { sec: number; nsec: number };
    data: Uint8Array;
  }>) {
    const ts = timeToNs(event.timestamp);
    if (ts > timeNs) continue;
    const data = event.data instanceof Uint8Array ? event.data : new Uint8Array(event.data);
    const value = rememberDecoded(meta, topicName, ts, data, decode);
    return { timestamp: ts, value };
  }
  return null;
}

export async function getTopicTypeBag(
  source: BagSource,
  topicName: string,
): Promise<string | undefined> {
  const meta = await loadBag(source);
  return meta.topicMeta.get(topicName)?.type;
}

/**
 * Sliver of the cached ROS1 state needed for v1.2 bag editing. Same pattern
 * as `loadMcapForEdit` in `mcap.ts`: re-exposes just what `parsers/editRos1.ts`
 * needs without leaking the full `CachedBag` shape into another module.
 */
export interface CachedBagForEdit {
  bag: Bag;
  /** Connection records keyed by connection id. The edit path reads each
   *  message's `connectionId` and walks back to (topic, type, .msg text). */
  connectionsById: Map<
    number,
    { topic: string; type: string; messageDefinition: string }
  >;
  /** First-connection metadata per topic; used for the per-topic message-count
   *  estimator and pre-flight UI. */
  topicMeta: Map<string, { type: string; messageDefinition: string }>;
  /** Per-connection message counts summed across every chunk index. Lets the
   *  estimator scale by the topic include set without re-walking chunks. */
  messageCountByConn: Map<number, number>;
}

export async function loadBagForEdit(source: BagSource): Promise<CachedBagForEdit> {
  const meta = await loadBag(source);
  const connectionsById = new Map<
    number,
    { topic: string; type: string; messageDefinition: string }
  >();
  for (const [id, c] of meta.connectionsById) {
    connectionsById.set(id, {
      topic: c.topic,
      type: c.type,
      messageDefinition: c.messageDefinition,
    });
  }
  const messageCountByConn = new Map<number, number>();
  for (const chunkInfo of meta.bag.chunkInfos) {
    for (const { conn, count } of chunkInfo.connections) {
      messageCountByConn.set(conn, (messageCountByConn.get(conn) ?? 0) + count);
    }
  }
  return {
    bag: meta.bag,
    connectionsById,
    topicMeta: meta.topicMeta,
    messageCountByConn,
  };
}
