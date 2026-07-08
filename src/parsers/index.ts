/**
 * Public parser API used by the rest of the app.
 *
 * Routes every call through the per-bag parser Web Worker (see
 * `workers/parserClient.ts`) so heavy lifting — MCAP chunk decompression,
 * sql.js queries, CDR deserialization — runs off the UI thread *and* in a
 * dedicated worker per bag so cross-bag reads don't queue behind each other.
 *
 * v0.9 multi-bag: each call accepts a `bagId`. Functions that exist for
 * back-compat (no bagId) route through the shared worker — that's only used
 * by main-thread schema management (`setCustomSchemas`, `validateSchema`,
 * `getSupportedTypes`) since those don't depend on any one bag's state.
 *
 * The actual parser implementations live in `./core.ts`; only the worker
 * imports them, which keeps the main bundle slim (no @mcap/core, sql.js, or
 * zstd-wasm in the React render path).
 */

import type { BagFormat, BagSummary, RawMessage } from '../types/bag';
import {
  getParserClient,
  getSharedParserClient,
  activeBagWorkerIds,
} from '../workers/parserClient';
import type { AxisClip, ColorMode, HeightAxis, PointCloudExtraction } from '../utils/pointcloud';
import type { LaserScanExtraction } from '../utils/laserscan';
import type { BagSource } from './source';
import type { VideoChunksResult } from './video';

type DecodedMessage = { timestamp: bigint; value: Record<string, unknown> | null };

export type { BagSource } from './source';
export { createFileSource, createUrlSource } from './source';
export { releaseBagWorker } from '../workers/parserClient';

/**
 * Parse a bag's header / summary. The worker assigned to `bagId` owns the
 * reader cache going forward — subsequent per-topic reads against the same
 * bagId reuse it.
 *
 * `bagId` is optional for back-compat (`bagStore.loadBag` calls this with the
 * id it just minted); when omitted we route through the shared worker, which
 * is fine for a one-shot parse but won't benefit from per-bag isolation.
 */
export async function parseBag(source: BagSource, bagId?: string): Promise<BagSummary> {
  return getParserClient(bagId).parseBag(source);
}

export async function readRawMessages(
  bagId: string,
  source: BagSource,
  format: BagFormat,
  topicName: string,
  limit?: number,
): Promise<RawMessage[]> {
  return getParserClient(bagId).readRawMessages(source, format, topicName, limit);
}

export async function readDeserializedMessages(
  bagId: string,
  source: BagSource,
  format: BagFormat,
  topicName: string,
  limit?: number,
  onProgress?: (decoded: number) => void,
  onBatch?: (batch: DecodedMessage[]) => void,
): Promise<DecodedMessage[]> {
  return getParserClient(bagId).readDeserializedMessages(
    source,
    format,
    topicName,
    limit,
    onProgress,
    onBatch,
  );
}

export async function readMessageAtTime(
  bagId: string,
  source: BagSource,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
): Promise<DecodedMessage | null> {
  return getParserClient(bagId).readMessageAtTime(source, format, topicName, timeNs);
}

export async function readPointCloudAtTime(
  bagId: string,
  source: BagSource,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
  colorMode: ColorMode,
  maxPoints?: number,
  maxRange?: number,
  heightAxis?: HeightAxis,
  axisClip?: AxisClip,
): Promise<(PointCloudExtraction & { timestamp: bigint }) | null> {
  return getParserClient(bagId).readPointCloudAtTime(
    source,
    format,
    topicName,
    timeNs,
    colorMode,
    maxPoints,
    maxRange,
    heightAxis,
    axisClip,
  );
}

export async function readLaserScanAtTime(
  bagId: string,
  source: BagSource,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
): Promise<(LaserScanExtraction & { timestamp: bigint }) | null> {
  return getParserClient(bagId).readLaserScanAtTime(source, format, topicName, timeNs);
}

export async function readVideoChunksAtTime(
  bagId: string,
  source: BagSource,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
): Promise<VideoChunksResult | null> {
  return getParserClient(bagId).readVideoChunksAtTime(source, format, topicName, timeNs);
}

export async function getTopicType(
  bagId: string,
  source: BagSource,
  format: BagFormat,
  topicName: string,
): Promise<string | undefined> {
  return getParserClient(bagId).getTopicType(source, format, topicName);
}

/** Dispose every per-bag worker's caches at once. */
export function disposeParserCaches(): void {
  // Fire-and-forget: cache disposal doesn't need to block the caller.
  for (const id of activeBagWorkerIds()) {
    void getParserClient(id).disposeParserCaches();
  }
}

/** Dispose a single bag worker's caches without terminating the worker. */
export function disposeParserCachesFor(bagId: string): void {
  void getParserClient(bagId).disposeParserCaches();
}

/** Every type name the bundled `ros2galactic` registry knows about. */
export async function getSupportedTypes(): Promise<string[]> {
  return getSharedParserClient().getSupportedTypes();
}

/**
 * Replace the worker's custom-schema map. Call on app boot (from the saved
 * localStorage state) and after every paste/delete in the schema modal.
 *
 * Multi-bag: we need to broadcast to every per-bag worker since they each
 * have their own CDR-reader cache. The shared worker also gets the update so
 * future bags inherit the schemas.
 */
export async function setCustomSchemas(schemas: Record<string, string>): Promise<void> {
  await Promise.all([
    getSharedParserClient().setCustomSchemas(schemas),
    ...activeBagWorkerIds().map((id) =>
      getParserClient(id).setCustomSchemas(schemas),
    ),
  ]);
}

/** Dry-run a `.msg` text through the parser — used by the paste modal. */
export async function validateSchema(
  schemaText: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  return getSharedParserClient().validateSchema(schemaText);
}

/**
 * Estimate the number of messages that would survive an edit (time-range
 * trim + topic filter). Used by the BagEdit modal to size its progress bar
 * before the actual write begins. v1.2 takes a `format` so the worker picks
 * the right estimator path.
 */
export async function estimateEditCount(
  bagId: string,
  source: BagSource,
  format: BagFormat,
  startNs: bigint,
  endNs: bigint,
  topics: string[] | null,
): Promise<number> {
  return getParserClient(bagId).estimateEditCount(
    source,
    format,
    startNs,
    endNs,
    topics,
  );
}

/**
 * Stream-edit a bag in the per-bag worker: filters by time range and
 * topic set, then returns a fresh in-memory MCAP `Uint8Array` ready for
 * download. The v1.2 banner: covers MCAP, ROS1 `.bag`, and ROS2 `.db3`
 * inputs. Output is always MCAP regardless of source format.
 *
 * `includeUnresolvedTopics` is `.db3`-only: topic names whose type isn't in
 * the bundled registry but the user has explicitly opted in to include.
 * The modal pre-flights this via `getResolvableTopicsDb3`.
 */
export async function editBag(
  bagId: string,
  source: BagSource,
  format: BagFormat,
  startNs: bigint,
  endNs: bigint,
  topics: string[] | null,
  includeUnresolvedTopics: string[] | undefined,
  onProgress?: (written: number) => void,
): Promise<{ bytes: Uint8Array; messageCount: number; startNs: bigint; endNs: bigint }> {
  return getParserClient(bagId).editBag(
    source,
    format,
    startNs,
    endNs,
    topics,
    includeUnresolvedTopics,
    onProgress,
  );
}

/**
 * For `.db3` inputs, return per-topic resolution status against the bundled
 * type registry + custom schemas. The BagEdit modal calls this on mount so it
 * can render "schema missing" chips and offer an opt-in toggle for topics
 * whose type isn't in the registry.
 */
export async function getResolvableTopicsDb3(
  bagId: string,
  source: BagSource,
): Promise<Array<{ topic: string; type: string; resolvable: boolean }>> {
  return getParserClient(bagId).getResolvableTopicsDb3(source);
}
