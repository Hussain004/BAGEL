/**
 * Unified Bag File Parser
 *
 * Detects the format of a bag file and delegates to the appropriate parser.
 * Also exposes a single set of message-reading APIs that route by detected
 * format so panels don't have to care about db3 vs mcap.
 */

import type { AllTopicStats, BagFormat, BagSummary, RawMessage } from '../types/bag';
import {
  parseMcap,
  readRawMessagesMcap,
  readDeserializedMessagesMcap,
  readMessageAtTimeMcap,
  getTopicTypeMcap,
  disposeMcapCache,
  readAllMessageStatsMcap,
} from './mcap';
import {
  parseDb3,
  readRawMessagesDb3,
  readDeserializedMessagesDb3,
  readMessageAtTimeDb3,
  getTopicTypeDb3,
  disposeDb3Cache,
  readAllMessageStatsDb3,
} from './db3';
import {
  parseBagFile,
  readRawMessagesBag,
  readDeserializedMessagesBag,
  readMessageAtTimeBag,
  getTopicTypeBag,
  disposeBagCache,
  readAllMessageStatsBag,
} from './bag';
import {
  parsePcd,
  readPointCloudAtTimePcd,
  disposePcdCache,
  PCD_MAGIC,
} from './pcd';
import {
  parsePly,
  readPointCloudAtTimePly,
  disposePlyCache,
  PLY_MAGIC,
} from './ply';
import { checkMagicBytes } from '../utils/bytes';
import { sourceDisplayName, sourceReadSlice, type BagSource } from './source';
import {
  decodePointCloud2,
  type AxisClip,
  type ColorMode,
  type HeightAxis,
  type PointCloudExtraction,
  type PointCloud2Message,
} from '../utils/pointcloud';
import { decodeLaserScan, type LaserScanExtraction, type LaserScanMessage } from '../utils/laserscan';
import { decodeCustomCloud, looksLikeCustomCloud } from '../utils/customCloud';

const MCAP_MAGIC = [0x89, 0x4d, 0x43, 0x41, 0x50, 0x30, 0x0d, 0x0a];
const SQLITE_MAGIC = [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65];
// `#ROSBAG V2.0\n` — the rosbag v2.0 header. v1.x files start with `#ROSBAG V1.x`
// and aren't supported by `@foxglove/rosbag`; we still detect them by extension
// and surface a clearer error during parse instead of a misleading "unknown format".
const ROSBAG_V2_MAGIC = [
  0x23, 0x52, 0x4f, 0x53, 0x42, 0x41, 0x47, 0x20, 0x56, 0x32, 0x2e, 0x30, 0x0a,
];

export async function detectFormat(source: BagSource): Promise<BagFormat | 'unknown'> {
  const name = sourceDisplayName(source);
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'mcap') return 'mcap';
  if (ext === 'db3') return 'db3';
  if (ext === 'bag') return 'bag';
  if (ext === 'pcd') return 'pcd';
  if (ext === 'ply') return 'ply';

  // Extension-less URL - sniff the first 16 bytes.
  const header = await sourceReadSlice(source, 0, 16);
  if (checkMagicBytes(header, MCAP_MAGIC)) return 'mcap';
  if (checkMagicBytes(header, SQLITE_MAGIC)) return 'db3';
  if (checkMagicBytes(header, ROSBAG_V2_MAGIC)) return 'bag';

  // PCD: first line starts with "# .PCD"
  const headerText = new TextDecoder('ascii').decode(header);
  if (headerText.startsWith(PCD_MAGIC)) return 'pcd';
  if (headerText.startsWith(PLY_MAGIC)) return 'ply';

  return 'unknown';
}

export async function parseBag(source: BagSource): Promise<BagSummary> {
  const format = await detectFormat(source);

  switch (format) {
    case 'mcap':
      return parseMcap(source);
    case 'db3':
      return parseDb3(source);
    case 'bag':
      return parseBagFile(source);
    case 'pcd':
      return parsePcd(source);
    case 'ply':
      return parsePly(source);
    default:
      throw new Error(
        `Unsupported file format: "${sourceDisplayName(source)}". ` +
          'BAGEL supports .mcap, .db3, .bag, .pcd, and .ply files.',
      );
  }
}

/** Read raw (still-serialized) messages for a topic, in chronological order. */
export async function readRawMessages(
  source: BagSource,
  format: BagFormat,
  topicName: string,
  limit?: number,
): Promise<RawMessage[]> {
  if (format === 'pcd' || format === 'ply') return [];
  if (format === 'mcap') return readRawMessagesMcap(source, topicName, limit);
  if (format === 'bag') return readRawMessagesBag(source, topicName, limit);
  return readRawMessagesDb3(source, topicName, limit);
}

/** Read and deserialize messages for a topic, in chronological order. */
export async function readDeserializedMessages(
  source: BagSource,
  format: BagFormat,
  topicName: string,
  limit?: number,
  onProgress?: (decoded: number) => void,
  onBatch?: (batch: { timestamp: bigint; value: Record<string, unknown> | null }[]) => void,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null }[]> {
  if (format === 'pcd' || format === 'ply') return [];
  if (format === 'mcap')
    return readDeserializedMessagesMcap(source, topicName, limit, onProgress, onBatch);
  if (format === 'bag')
    return readDeserializedMessagesBag(source, topicName, limit, onProgress, onBatch);
  return readDeserializedMessagesDb3(source, topicName, limit, onProgress, onBatch);
}

/**
 * Read just one message - the one nearest `timeNs` - for a topic.
 *
 * Used by panels that only need the current frame at the playhead time
 * (Image, Raw inspector). Skips loading every message on the topic,
 * which would be many GB for image streams in compressed bags.
 */
export async function readMessageAtTime(
  source: BagSource,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null } | null> {
  if (format === 'pcd' || format === 'ply') return null;
  if (format === 'mcap') return readMessageAtTimeMcap(source, topicName, timeNs);
  if (format === 'bag') return readMessageAtTimeBag(source, topicName, timeNs);
  return readMessageAtTimeDb3(source, topicName, timeNs);
}

export async function getTopicType(
  source: BagSource,
  format: BagFormat,
  topicName: string,
): Promise<string | undefined> {
  if (format === 'pcd' || format === 'ply') return 'sensor_msgs/PointCloud2';
  if (format === 'mcap') return getTopicTypeMcap(source, topicName);
  if (format === 'bag') return getTopicTypeBag(source, topicName);
  return getTopicTypeDb3(source, topicName);
}

export function disposeParserCaches(): void {
  disposeMcapCache();
  disposeDb3Cache();
  disposeBagCache();
  disposePcdCache();
  disposePlyCache();
}

export async function readAllMessageStats(
  source: BagSource,
  format: BagFormat,
): Promise<AllTopicStats> {
  if (format === 'pcd' || format === 'ply') return {};
  if (format === 'mcap') return readAllMessageStatsMcap(source);
  if (format === 'bag') return readAllMessageStatsBag(source);
  return readAllMessageStatsDb3(source);
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
  source: BagSource,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
  colorMode: ColorMode = 'height',
  maxPoints?: number,
  maxRange?: number,
  heightAxis: HeightAxis = '+z',
  axisClip?: AxisClip,
): Promise<(PointCloudExtraction & { timestamp: bigint }) | null> {
  if (format === 'pcd') {
    return readPointCloudAtTimePcd(source, colorMode, maxPoints, maxRange, heightAxis, axisClip);
  }
  if (format === 'ply') {
    return readPointCloudAtTimePly(source, colorMode, maxPoints, maxRange, heightAxis, axisClip);
  }

  const message =
    format === 'mcap'
      ? await readMessageAtTimeMcap(source, topicName, timeNs)
      : format === 'bag'
        ? await readMessageAtTimeBag(source, topicName, timeNs)
        : await readMessageAtTimeDb3(source, topicName, timeNs);
  if (!message || !message.value) return null;
  // Dispatch by message shape: sensor_msgs/PointCloud2 carries `fields` + a
  // packed `data` buffer, whereas list-of-structs clouds (Livox CustomMsg
  // and similar) carry a `points: []` array of {x,y,z,...}. Most bags only
  // produce one or the other for a given topic, but checking shape rather
  // than type name means converted bags with non-standard names still work.
  const value = message.value;
  const hasPointCloud2Fields = Array.isArray((value as { fields?: unknown[] }).fields);
  const opts = { colorMode, maxPoints, maxRange, heightAxis, axisClip };
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
  source: BagSource,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
): Promise<(LaserScanExtraction & { timestamp: bigint }) | null> {
  const message =
    format === 'mcap'
      ? await readMessageAtTimeMcap(source, topicName, timeNs)
      : format === 'bag'
        ? await readMessageAtTimeBag(source, topicName, timeNs)
        : await readMessageAtTimeDb3(source, topicName, timeNs);
  if (!message || !message.value) return null;
  const decoded = decodeLaserScan(message.value as LaserScanMessage);
  if (!decoded) return null;
  return { ...decoded, timestamp: message.timestamp };
}

export { parseMcap } from './mcap';
export { parseDb3 } from './db3';
