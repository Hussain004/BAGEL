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

import { McapIndexedReader, McapStreamReader } from '@mcap/core';
import { BlobReadable } from '@mcap/browser';
import type { BagSummary, RawMessage, TopicInfo } from '../types/bag';
import { deserializeWithSchema } from './cdr';

interface CachedMcap {
  fileName: string;
  fileSize: number;
  reader: McapIndexedReader | null;
  buffer: Uint8Array | null;
  channelById: Map<number, { topic: string; schemaId: number }>;
  schemaById: Map<number, { name: string; encoding: string; data: Uint8Array }>;
  topicMeta: Map<string, { schemaName: string; schemaText: string | null }>;
}

let cached: CachedMcap | null = null;

function decodeSchemaText(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

export function disposeMcapCache(): void {
  cached = null;
}

async function loadMcap(file: File): Promise<CachedMcap> {
  if (
    cached &&
    cached.fileName === file.name &&
    cached.fileSize === file.size
  ) {
    return cached;
  }

  const arrayBuffer = await file.arrayBuffer();
  const blob = new Blob([arrayBuffer]);
  const readable = new BlobReadable(blob);

  let reader: McapIndexedReader | null = null;
  let buffer: Uint8Array | null = null;
  const channelById = new Map<number, { topic: string; schemaId: number }>();
  const schemaById = new Map<number, { name: string; encoding: string; data: Uint8Array }>();
  const topicMeta = new Map<string, { schemaName: string; schemaText: string | null }>();

  try {
    reader = await McapIndexedReader.Initialize({ readable });
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
  } catch {
    // Stream-reader fallback path — keep the buffer for later reads.
    buffer = new Uint8Array(arrayBuffer);
    const streamReader = new McapStreamReader();
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
  const reader = new McapStreamReader();
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
    const reader = new McapStreamReader();
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
