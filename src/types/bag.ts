/**
 * Core type definitions for BAGEL bag file handling
 */

export type BagFormat = 'mcap' | 'db3' | 'bag' | 'live';

export interface TopicInfo {
  name: string;
  type: string;
  messageCount: number;
  serializationFormat: string;
  frequency?: number; // messages per second
}

export interface BagSummary {
  format: BagFormat;
  fileName: string;
  fileSize: number;
  startTime: bigint; // nanoseconds since epoch
  endTime: bigint;
  duration: number; // seconds
  totalMessageCount: number;
  topics: TopicInfo[];
}

export interface RawMessage {
  topicName: string;
  timestamp: bigint; // nanoseconds since epoch
  data: Uint8Array;
}
