/**
 * Unified Bag File Parser
 *
 * Detects the format of a bag file and delegates to the appropriate parser.
 * Also exposes a single set of message-reading APIs that route by detected
 * format so panels don't have to care about db3 vs mcap.
 */

import type { BagFormat, BagSummary, RawMessage } from '../types/bag';
import {
  parseMcap,
  readRawMessagesMcap,
  readDeserializedMessagesMcap,
  getTopicTypeMcap,
  disposeMcapCache,
} from './mcap';
import {
  parseDb3,
  readRawMessagesDb3,
  readDeserializedMessagesDb3,
  getTopicTypeDb3,
  disposeDb3Cache,
} from './db3';
import { checkMagicBytes } from '../utils/bytes';

const MCAP_MAGIC = [0x89, 0x4d, 0x43, 0x41, 0x50, 0x30, 0x0d, 0x0a];
const SQLITE_MAGIC = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65];

export async function detectFormat(file: File): Promise<BagFormat | 'unknown'> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext === 'mcap') return 'mcap';
  if (ext === 'db3') return 'db3';

  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (checkMagicBytes(header, MCAP_MAGIC)) return 'mcap';
  if (checkMagicBytes(header, SQLITE_MAGIC)) return 'db3';

  return 'unknown';
}

export async function parseBag(file: File): Promise<BagSummary> {
  const format = await detectFormat(file);

  switch (format) {
    case 'mcap':
      return parseMcap(file);
    case 'db3':
      return parseDb3(file);
    default:
      throw new Error(
        `Unsupported file format: "${file.name}". ` +
          'BAGEL supports .db3 (ROS2 SQLite) and .mcap (MCAP) bag files.',
      );
  }
}

/** Read raw CDR-encoded messages for a topic, in chronological order. */
export async function readRawMessages(
  file: File,
  format: BagFormat,
  topicName: string,
  limit?: number,
): Promise<RawMessage[]> {
  if (format === 'mcap') return readRawMessagesMcap(file, topicName, limit);
  return readRawMessagesDb3(file, topicName, limit);
}

/** Read and deserialize messages for a topic, in chronological order. */
export async function readDeserializedMessages(
  file: File,
  format: BagFormat,
  topicName: string,
  limit?: number,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null }[]> {
  if (format === 'mcap') return readDeserializedMessagesMcap(file, topicName, limit);
  return readDeserializedMessagesDb3(file, topicName, limit);
}

export async function getTopicType(
  file: File,
  format: BagFormat,
  topicName: string,
): Promise<string | undefined> {
  if (format === 'mcap') return getTopicTypeMcap(file, topicName);
  return getTopicTypeDb3(file, topicName);
}

export function disposeParserCaches(): void {
  disposeMcapCache();
  disposeDb3Cache();
}

export { parseMcap } from './mcap';
export { parseDb3 } from './db3';
