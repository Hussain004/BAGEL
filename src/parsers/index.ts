/**
 * Public parser API used by the rest of the app.
 *
 * Routes every call through the parser Web Worker (see `workers/parser.worker.ts`)
 * so the heavy lifting — MCAP chunk decompression, sql.js queries, CDR
 * deserialization — runs off the UI thread. The function signatures match
 * the previous main-thread implementation so existing callers don't change.
 *
 * The actual parser implementations live in `./core.ts`; only the worker
 * imports them, which keeps the main bundle slim (no @mcap/core, sql.js, or
 * fzstd in the React render path).
 */

import type { BagFormat, BagSummary, RawMessage } from '../types/bag';
import { getParserClient } from '../workers/parserClient';
import type { ColorMode, HeightAxis, PointCloudExtraction } from '../utils/pointcloud';
import type { LaserScanExtraction } from '../utils/laserscan';

type DecodedMessage = { timestamp: bigint; value: Record<string, unknown> | null };

export async function parseBag(file: File): Promise<BagSummary> {
  return getParserClient().parseBag(file);
}

export async function readRawMessages(
  file: File,
  format: BagFormat,
  topicName: string,
  limit?: number,
): Promise<RawMessage[]> {
  return getParserClient().readRawMessages(file, format, topicName, limit);
}

export async function readDeserializedMessages(
  file: File,
  format: BagFormat,
  topicName: string,
  limit?: number,
  onProgress?: (decoded: number) => void,
  onBatch?: (batch: DecodedMessage[]) => void,
): Promise<DecodedMessage[]> {
  return getParserClient().readDeserializedMessages(
    file,
    format,
    topicName,
    limit,
    onProgress,
    onBatch,
  );
}

export async function readMessageAtTime(
  file: File,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
): Promise<DecodedMessage | null> {
  return getParserClient().readMessageAtTime(file, format, topicName, timeNs);
}

export async function readPointCloudAtTime(
  file: File,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
  colorMode: ColorMode,
  maxPoints?: number,
  maxRange?: number,
  heightAxis?: HeightAxis,
): Promise<(PointCloudExtraction & { timestamp: bigint }) | null> {
  return getParserClient().readPointCloudAtTime(
    file,
    format,
    topicName,
    timeNs,
    colorMode,
    maxPoints,
    maxRange,
    heightAxis,
  );
}

export async function readLaserScanAtTime(
  file: File,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
): Promise<(LaserScanExtraction & { timestamp: bigint }) | null> {
  return getParserClient().readLaserScanAtTime(file, format, topicName, timeNs);
}

export async function getTopicType(
  file: File,
  format: BagFormat,
  topicName: string,
): Promise<string | undefined> {
  return getParserClient().getTopicType(file, format, topicName);
}

export function disposeParserCaches(): void {
  // Fire-and-forget: cache disposal doesn't need to block the caller.
  void getParserClient().disposeParserCaches();
}
