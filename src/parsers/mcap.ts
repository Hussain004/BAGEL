/**
 * MCAP File Parser
 * 
 * Parses .mcap ROS2 bag files using @mcap/core.
 * MCAP files embed schemas directly, so we can deserialize
 * any message type found in the file.
 */

import { McapIndexedReader, McapStreamReader } from '@mcap/core';
import { BlobReadable } from '@mcap/browser';
import type { BagSummary, TopicInfo } from '../types/bag';

/**
 * Parse an MCAP file and return a BagSummary.
 * 
 * First tries McapIndexedReader (random access, faster for seeking).
 * Falls back to McapStreamReader if the file lacks an index.
 */
export async function parseMcap(file: File): Promise<BagSummary> {
  const blob = new Blob([await file.arrayBuffer()]);
  const readable = new BlobReadable(blob);
  
  try {
    // Try indexed reader first (requires summary section in file)
    const reader = await McapIndexedReader.Initialize({ readable });
    return extractSummaryFromIndexed(reader, file);
  } catch (indexedError) {
    // Fall back to stream reader if no index available
    try {
      console.warn('MCAP indexed reader failed, falling back to stream reader');
      const buffer = await file.arrayBuffer();
      return extractSummaryFromStream(new Uint8Array(buffer), file);
    } catch (streamError) {
      // Both failed — provide a helpful error
      const msg = indexedError instanceof Error ? indexedError.message : String(indexedError);
      
      if (msg.includes('magic') || msg.includes('Expected MCAP')) {
        throw new Error(
          `"${file.name}" does not appear to be a valid MCAP file. ` +
          'The file header does not match the MCAP format. ' +
          'Please ensure you are uploading a .mcap bag file recorded by ROS2.'
        );
      }
      
      throw new Error(
        `Failed to parse "${file.name}" as MCAP: ${msg}`
      );
    }
  }
}

/**
 * Extract bag summary from an indexed MCAP reader.
 */
function extractSummaryFromIndexed(
  reader: McapIndexedReader,
  file: File
): BagSummary {
  const channelMap = new Map<number, { topic: string; schemaId: number; messageCount: number }>();
  const schemaMap = new Map<number, string>(); // schemaId -> schema name
  
  // Collect schemas
  for (const schema of reader.schemasById.values()) {
    schemaMap.set(schema.id, schema.name);
  }
  
  // Collect channels
  for (const channel of reader.channelsById.values()) {
    channelMap.set(channel.id, {
      topic: channel.topic,
      schemaId: channel.schemaId,
      messageCount: 0,
    });
  }
  
  // Count messages per channel from statistics
  if (reader.statistics) {
    for (const [channelId, count] of reader.statistics.channelMessageCounts) {
      const ch = channelMap.get(channelId);
      if (ch) ch.messageCount = Number(count);
    }
  }
  
  // Build topic info
  const topics: TopicInfo[] = [];
  for (const ch of channelMap.values()) {
    const schemaName = schemaMap.get(ch.schemaId) || 'unknown';
    topics.push({
      name: ch.topic,
      type: schemaName,
      messageCount: ch.messageCount,
      serializationFormat: 'cdr',
    });
  }
  
  const startTime = reader.statistics?.messageStartTime ?? 0n;
  const endTime = reader.statistics?.messageEndTime ?? 0n;
  const durationNs = endTime - startTime;
  const duration = Number(durationNs) / 1e9;
  const totalMessageCount = reader.statistics 
    ? Number(reader.statistics.messageCount) 
    : topics.reduce((sum, t) => sum + t.messageCount, 0);
  
  // Calculate frequencies
  if (duration > 0) {
    for (const topic of topics) {
      topic.frequency = Math.round(topic.messageCount / duration * 10) / 10;
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

/**
 * Extract bag summary from a stream-based MCAP reader (fallback).
 */
function extractSummaryFromStream(
  data: Uint8Array,
  file: File
): BagSummary {
  const reader = new McapStreamReader();
  reader.append(data);
  
  const channels = new Map<number, { topic: string; schemaName: string }>(); 
  const messageCounts = new Map<number, number>();
  let minTimestamp = BigInt(Number.MAX_SAFE_INTEGER) * 1000000000n;
  let maxTimestamp = 0n;
  let totalMessages = 0;
  
  for (let record; (record = reader.nextRecord()); ) {
    switch (record.type) {
      case 'Schema':
        // Schemas are stored separately and referenced by channels
        break;
      case 'Channel':
        channels.set(record.id, {
          topic: record.topic,
          schemaName: record.schemaId.toString(), // Will be resolved later
        });
        break;
      case 'Message': {
        totalMessages++;
        const count = messageCounts.get(record.channelId) ?? 0;
        messageCounts.set(record.channelId, count + 1);
        if (record.logTime < minTimestamp) minTimestamp = record.logTime;
        if (record.logTime > maxTimestamp) maxTimestamp = record.logTime;
        break;
      }
    }
  }
  
  const topics: TopicInfo[] = [];
  const durationNs = maxTimestamp - minTimestamp;
  const duration = Number(durationNs) / 1e9;
  
  for (const [channelId, ch] of channels) {
    const count = messageCounts.get(channelId) ?? 0;
    topics.push({
      name: ch.topic,
      type: ch.schemaName,
      messageCount: count,
      serializationFormat: 'cdr',
      frequency: duration > 0 ? Math.round(count / duration * 10) / 10 : undefined,
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
