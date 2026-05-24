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

import { McapIndexedReader, McapStreamReader, type DecompressHandlers } from '@mcap/core';
import { BlobReadable } from '@mcap/browser';
import { decompress as fzstdDecompress } from 'fzstd';
import type { BagSummary, RawMessage, TopicInfo } from '../types/bag';
import { deserializeWithSchema } from './cdr';

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
 */
const decompressHandlers: DecompressHandlers = {
  zstd: (buffer, decompressedSize) =>
    fzstdDecompress(
      // fzstd accepts a typed array and an optional output buffer of the
      // expected size; pre-allocating avoids resize overhead.
      buffer,
      new Uint8Array(Number(decompressedSize)),
    ),
};

interface CachedMcap {
  fileName: string;
  fileSize: number;
  reader: McapIndexedReader | null;
  buffer: Uint8Array | null;
  channelById: Map<number, { topic: string; schemaId: number }>;
  schemaById: Map<number, { name: string; encoding: string; data: Uint8Array }>;
  topicMeta: Map<string, { schemaName: string; schemaText: string | null }>;
  decompressHandlers: DecompressHandlers;
}

let cached: CachedMcap | null = null;

function decodeSchemaText(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

export function disposeMcapCache(): void {
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

async function loadMcap(file: File): Promise<CachedMcap> {
  if (
    cached &&
    cached.fileName === file.name &&
    cached.fileSize === file.size
  ) {
    return cached;
  }

  // File extends Blob, so BlobReadable can range-read directly against it —
  // no upfront arrayBuffer(), which would OOM on multi-GB files.
  const readable = new BlobReadable(file);

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
    if (file.size > STREAM_FALLBACK_MAX_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(0);
      const detail =
        indexedError instanceof Error ? indexedError.message : String(indexedError);
      throw new Error(
        `"${file.name}" (${sizeMb} MB) does not have an MCAP summary/index section, ` +
          'so we would need to load the whole file into memory to scan it linearly. ' +
          'That is not supported for files over 512 MB in the browser. Re-record the ' +
          'bag with an index (the default for recent ros2_bag_mcap recorders) or run ' +
          '`mcap recover` over the file, then try again. (' + detail + ')',
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    buffer = new Uint8Array(arrayBuffer);
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
    fileName: file.name,
    fileSize: file.size,
    reader,
    buffer,
    channelById,
    schemaById,
    topicMeta,
    decompressHandlers,
  };
  return cached;
}

export async function parseMcap(file: File): Promise<BagSummary> {
  const meta = await loadMcap(file);

  if (meta.reader) {
    return extractSummaryFromIndexed(meta, file);
  }
  if (meta.buffer) {
    return extractSummaryFromStream(meta, file);
  }

  throw new Error(
    `"${file.name}" does not appear to be a valid MCAP file. ` +
      'The file header does not match the MCAP format. ' +
      'Please ensure you are uploading a .mcap bag file recorded by ROS2.',
  );
}

function extractSummaryFromIndexed(meta: CachedMcap, file: File): BagSummary {
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
    fileName: file.name,
    fileSize: file.size,
    startTime,
    endTime,
    duration,
    totalMessageCount,
    topics: topics.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function extractSummaryFromStream(meta: CachedMcap, file: File): BagSummary {
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
    fileName: file.name,
    fileSize: file.size,
    startTime: minTimestamp,
    endTime: maxTimestamp,
    duration,
    totalMessageCount: totalMessages,
    topics: topics.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export async function readRawMessagesMcap(
  file: File,
  topicName: string,
  limit?: number,
): Promise<RawMessage[]> {
  const meta = await loadMcap(file);
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

export async function readDeserializedMessagesMcap(
  file: File,
  topicName: string,
  limit?: number,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null }[]> {
  const meta = await loadMcap(file);
  const topicInfo = meta.topicMeta.get(topicName);
  if (!topicInfo || !topicInfo.schemaText) return [];

  const raws = await readRawMessagesMcap(file, topicName, limit);
  const out: { timestamp: bigint; value: Record<string, unknown> | null }[] = [];
  for (const raw of raws) {
    try {
      const value = deserializeWithSchema(topicInfo.schemaText, raw.data);
      out.push({ timestamp: raw.timestamp, value });
    } catch {
      out.push({ timestamp: raw.timestamp, value: null });
    }
  }
  return out;
}

export async function getTopicTypeMcap(
  file: File,
  topicName: string,
): Promise<string | undefined> {
  const meta = await loadMcap(file);
  return meta.topicMeta.get(topicName)?.schemaName;
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
 */
export async function readMessageAtTimeMcap(
  file: File,
  topicName: string,
  timeNs: bigint,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null } | null> {
  const meta = await loadMcap(file);
  const topicInfo = meta.topicMeta.get(topicName);
  if (!topicInfo || !topicInfo.schemaText) return null;

  const decode = (raw: Uint8Array) => {
    try {
      return deserializeWithSchema(topicInfo.schemaText!, raw);
    } catch {
      return null;
    }
  };

  if (meta.reader) {
    for await (const msg of meta.reader.readMessages({
      topics: [topicName],
      startTime: timeNs,
    })) {
      return { timestamp: msg.logTime, value: decode(msg.data) };
    }
    // Nothing at or after — fall back to the latest message at or before.
    for await (const msg of meta.reader.readMessages({
      topics: [topicName],
      endTime: timeNs,
      reverse: true,
    })) {
      return { timestamp: msg.logTime, value: decode(msg.data) };
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
      return { timestamp: bestTs, value: decode(bestData) };
    }
  }
  return null;
}
