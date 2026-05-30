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
import type { BagSource } from './source';

type DecodedMessage = { timestamp: bigint; value: Record<string, unknown> | null };

export type { BagSource } from './source';
export { createFileSource, createUrlSource } from './source';

export async function parseBag(source: BagSource): Promise<BagSummary> {
  return getParserClient().parseBag(source);
}

export async function readRawMessages(
  source: BagSource,
  format: BagFormat,
  topicName: string,
  limit?: number,
): Promise<RawMessage[]> {
  return getParserClient().readRawMessages(source, format, topicName, limit);
}

export async function readDeserializedMessages(
  source: BagSource,
  format: BagFormat,
  topicName: string,
  limit?: number,
  onProgress?: (decoded: number) => void,
  onBatch?: (batch: DecodedMessage[]) => void,
): Promise<DecodedMessage[]> {
  return getParserClient().readDeserializedMessages(
    source,
    format,
    topicName,
    limit,
    onProgress,
    onBatch,
  );
}

export async function readMessageAtTime(
  source: BagSource,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
): Promise<DecodedMessage | null> {
  return getParserClient().readMessageAtTime(source, format, topicName, timeNs);
}

export async function readPointCloudAtTime(
  source: BagSource,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
  colorMode: ColorMode,
  maxPoints?: number,
  maxRange?: number,
  heightAxis?: HeightAxis,
): Promise<(PointCloudExtraction & { timestamp: bigint }) | null> {
  return getParserClient().readPointCloudAtTime(
    source,
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
  source: BagSource,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
): Promise<(LaserScanExtraction & { timestamp: bigint }) | null> {
  return getParserClient().readLaserScanAtTime(source, format, topicName, timeNs);
}

export async function getTopicType(
  source: BagSource,
  format: BagFormat,
  topicName: string,
): Promise<string | undefined> {
  return getParserClient().getTopicType(source, format, topicName);
}

export function disposeParserCaches(): void {
  // Fire-and-forget: cache disposal doesn't need to block the caller.
  void getParserClient().disposeParserCaches();
}

/** Every type name the bundled `ros2galactic` registry knows about. */
export async function getSupportedTypes(): Promise<string[]> {
  return getParserClient().getSupportedTypes();
}

/**
 * Replace the worker's custom-schema map. Call on app boot (from the saved
 * localStorage state) and after every paste/delete in the schema modal.
 */
export async function setCustomSchemas(schemas: Record<string, string>): Promise<void> {
  return getParserClient().setCustomSchemas(schemas);
}

/** Dry-run a `.msg` text through the parser — used by the paste modal. */
export async function validateSchema(
  schemaText: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return getParserClient().validateSchema(schemaText);
}
