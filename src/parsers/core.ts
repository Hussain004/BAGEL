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
  readMessageAtTimeMcap,
  getTopicTypeMcap,
  disposeMcapCache,
} from './mcap';
import {
  parseDb3,
  readRawMessagesDb3,
  readDeserializedMessagesDb3,
  readMessageAtTimeDb3,
  getTopicTypeDb3,
  disposeDb3Cache,
} from './db3';
import { checkMagicBytes } from '../utils/bytes';
import {
  decodePointCloud2,
  type ColorMode,
  type PointCloudExtraction,
  type PointCloud2Message,
} from '../utils/pointcloud';
import { decodeLaserScan, type LaserScanExtraction, type LaserScanMessage } from '../utils/laserscan';
import { decodeCustomCloud, looksLikeCustomCloud } from '../utils/customCloud';

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
  onProgress?: (decoded: number) => void,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null }[]> {
  if (format === 'mcap')
    return readDeserializedMessagesMcap(file, topicName, limit, onProgress);
  return readDeserializedMessagesDb3(file, topicName, limit, onProgress);
}

/**
 * Read just one message — the one nearest `timeNs` — for a topic.
 *
 * Used by panels that only need the current frame at the playhead time
 * (Image, Raw inspector). Skips loading every message on the topic,
 * which would be many GB for image streams in compressed bags.
 */
export async function readMessageAtTime(
  file: File,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null } | null> {
  if (format === 'mcap') return readMessageAtTimeMcap(file, topicName, timeNs);
  return readMessageAtTimeDb3(file, topicName, timeNs);
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

/**
 * Decode a single PointCloud2 message at `timeNs` and return Float32Array
 * positions + colors. Output buffers are transferable so the worker can
 * ship them back to the main thread without copying.
 *
 * Returns null if the topic has no message at the requested time or the
 * message is malformed.
 */
export async function readPointCloudAtTime(
  file: File,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
  colorMode: ColorMode = 'height',
  maxPoints?: number,
  maxRange?: number,
): Promise<(PointCloudExtraction & { timestamp: bigint }) | null> {
  const message =
    format === 'mcap'
      ? await readMessageAtTimeMcap(file, topicName, timeNs)
      : await readMessageAtTimeDb3(file, topicName, timeNs);
  if (!message || !message.value) return null;
  // Dispatch by message shape: sensor_msgs/PointCloud2 carries `fields` + a
  // packed `data` buffer, whereas list-of-structs clouds (Livox CustomMsg
  // and similar) carry a `points: []` array of {x,y,z,...}. Most bags only
  // produce one or the other for a given topic, but checking shape rather
  // than type name means converted bags with non-standard names still work.
  const value = message.value;
  const hasPointCloud2Fields = Array.isArray((value as { fields?: unknown[] }).fields);
  const opts = { colorMode, maxPoints, maxRange };
  // Try the PointCloud2 path first when the shape matches, otherwise the
  // list-of-points path (Livox CustomMsg and similar). Fall back to the
  // other decoder if the preferred one returns null — a few converted bags
  // carry both shapes side-by-side, and one of them will succeed.
  const decoded = hasPointCloud2Fields
    ? (decodePointCloud2(value as PointCloud2Message, opts) ??
      decodeCustomCloud(value, opts))
    : looksLikeCustomCloud(value)
      ? (decodeCustomCloud(value, opts) ??
        decodePointCloud2(value as PointCloud2Message, opts))
      : null;
  if (!decoded) return null;
  return { ...decoded, timestamp: message.timestamp };
}

/**
 * Decode a single LaserScan message at `timeNs` and return positions / colors
 * as transferable Float32Arrays.
 */
export async function readLaserScanAtTime(
  file: File,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
): Promise<(LaserScanExtraction & { timestamp: bigint }) | null> {
  const message =
    format === 'mcap'
      ? await readMessageAtTimeMcap(file, topicName, timeNs)
      : await readMessageAtTimeDb3(file, topicName, timeNs);
  if (!message || !message.value) return null;
  const decoded = decodeLaserScan(message.value as LaserScanMessage);
  if (!decoded) return null;
  return { ...decoded, timestamp: message.timestamp };
}

export { parseMcap } from './mcap';
export { parseDb3 } from './db3';
