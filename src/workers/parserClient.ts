/**
 * Main-thread client for the parser worker.
 *
 * Wraps `parser.worker.ts` with a promise-based API that matches the old
 * synchronous-looking parser surface. Each call gets a unique numeric id
 * so we can multiplex many in-flight reads (image scrubs + a plot decode
 * + a TF load can all run concurrently against the same worker).
 *
 * v0.9 multi-bag: there is now one worker *per bagId*. Each worker owns its
 * own MCAP reader / sql.js Database / ROS1 Bag caches, so:
 *   - parsing bag B doesn't queue behind a long /tf decode of bag A,
 *   - disposing bag B tears down only its caches without disturbing bag A,
 *   - the inFlight in `useTopicMessages` keys cleanly by (sourceKey, topic).
 *
 * Workers are spun up on first use and kept alive for the lifetime of the bag
 * — disposal happens in `releaseBagWorker(bagId)` which both terminates the
 * worker and drops the singleton entry.
 *
 * For non-bag-tied operations (validate a pasted schema, list supported
 * types, push the custom-schema map) we have a singleton "shared" worker so
 * those don't depend on having any bag loaded.
 */

import type { AllTopicStats, BagFormat, BagSummary, RawMessage } from '../types/bag';
import type { AxisClip, ColorMode, HeightAxis, PointCloudExtraction } from '../utils/pointcloud';
import type { LaserScanExtraction } from '../utils/laserscan';
import type { BagSource } from '../parsers/source';

type DecodedMessage = { timestamp: bigint; value: Record<string, unknown> | null };
type DecodedPointCloud = (PointCloudExtraction & { timestamp: bigint }) | null;
type DecodedLaserScan = (LaserScanExtraction & { timestamp: bigint }) | null;

export interface EditBagResult {
  bytes: Uint8Array;
  messageCount: number;
  startNs: bigint;
  endNs: bigint;
}

export interface Db3TopicResolution {
  topic: string;
  type: string;
  resolvable: boolean;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (decoded: number) => void;
  onBatch?: (batch: DecodedMessage[]) => void;
  /**
   * Accumulator for streamed methods (`readDeserializedMessages`). Each
   * `batch` message pushes into this array; on `result`, the promise
   * resolves with the accumulated array. Non-streamed methods leave this
   * undefined and resolve with `data.result` directly.
   */
  accumulator?: DecodedMessage[];
}

class ParserClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    // Vite's import.meta.url syntax: keeps the worker as a sibling chunk,
    // bundled with its own dependency graph (mcap, sql.js, fzstd, foxglove
    // libs) so none of that ships in the main bundle.
    this.worker = new Worker(new URL('./parser.worker.ts', import.meta.url), {
      type: 'module',
      name: 'bagel-parser',
    });
    this.worker.addEventListener('message', (e: MessageEvent) => this.onMessage(e));
    this.worker.addEventListener('error', (e: ErrorEvent) => this.onWorkerError(e));
    this.worker.addEventListener('messageerror', () => {
      this.rejectAll(new Error('Worker message could not be deserialized.'));
    });
    return this.worker;
  }

  private onMessage(e: MessageEvent) {
    const data = e.data as
      | { id: number; type: 'progress'; decoded: number }
      | { id: number; type: 'batch'; batch: DecodedMessage[] }
      | { id: number; type: 'result'; result: unknown }
      | { id: number; type: 'error'; error: string };
    const pending = this.pending.get(data.id);
    if (!pending) return;

    if (data.type === 'progress') {
      pending.onProgress?.(data.decoded);
      return;
    }
    if (data.type === 'batch') {
      // Forward to the user-supplied streaming callback first so consumers
      // that want incremental rendering get the batch on the same tick it
      // arrives. The accumulator then preserves the data for the eventual
      // promise resolution — needed even when no onBatch is provided.
      pending.onBatch?.(data.batch);
      pending.accumulator?.push(...data.batch);
      return;
    }
    if (data.type === 'error') {
      this.pending.delete(data.id);
      pending.reject(new Error(data.error));
      return;
    }
    if (data.type === 'result') {
      this.pending.delete(data.id);
      // Streamed methods carry their data in the accumulator; non-streamed
      // ones embed it in `data.result`. Picking by presence of accumulator
      // avoids per-method conditionals.
      pending.resolve(pending.accumulator ?? data.result);
    }
  }

  private onWorkerError(e: ErrorEvent) {
    const message = e.message || 'Parser worker crashed.';
    this.rejectAll(new Error(message));
    // Drop the worker so the next request spins up a fresh one. This is rare
    // (OOM, unhandled throw in dependency code) but recovers gracefully.
    this.worker?.terminate();
    this.worker = null;
  }

  private rejectAll(err: Error) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  /** Terminate this worker and reject all pending requests. */
  terminate(): void {
    this.rejectAll(new Error('Parser worker terminated.'));
    this.worker?.terminate();
    this.worker = null;
  }

  private request<T>(
    method: string,
    params: Record<string, unknown> | undefined,
    callbacks?: {
      onProgress?: (decoded: number) => void;
      onBatch?: (batch: DecodedMessage[]) => void;
      streamed?: boolean;
    },
  ): Promise<T> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress: callbacks?.onProgress,
        onBatch: callbacks?.onBatch,
        accumulator: callbacks?.streamed ? [] : undefined,
      });
      worker.postMessage({ id, method, params });
    });
  }

  parseBag(source: BagSource): Promise<BagSummary> {
    return this.request<BagSummary>('parseBag', { source });
  }

  readRawMessages(
    source: BagSource,
    format: BagFormat,
    topicName: string,
    limit?: number,
  ): Promise<RawMessage[]> {
    return this.request<RawMessage[]>('readRawMessages', { source, format, topicName, limit });
  }

  readDeserializedMessages(
    source: BagSource,
    format: BagFormat,
    topicName: string,
    limit?: number,
    onProgress?: (decoded: number) => void,
    onBatch?: (batch: DecodedMessage[]) => void,
  ): Promise<DecodedMessage[]> {
    return this.request<DecodedMessage[]>(
      'readDeserializedMessages',
      { source, format, topicName, limit },
      { onProgress, onBatch, streamed: true },
    );
  }

  readMessageAtTime(
    source: BagSource,
    format: BagFormat,
    topicName: string,
    timeNs: bigint,
  ): Promise<DecodedMessage | null> {
    return this.request<DecodedMessage | null>('readMessageAtTime', {
      source,
      format,
      topicName,
      timeNs,
    });
  }

  readPointCloudAtTime(
    source: BagSource,
    format: BagFormat,
    topicName: string,
    timeNs: bigint,
    colorMode: ColorMode,
    maxPoints?: number,
    maxRange?: number,
    heightAxis?: HeightAxis,
    axisClip?: AxisClip,
  ): Promise<DecodedPointCloud> {
    return this.request<DecodedPointCloud>('readPointCloudAtTime', {
      source,
      format,
      topicName,
      timeNs,
      colorMode,
      maxPoints,
      maxRange,
      heightAxis,
      axisClip,
    });
  }

  readLaserScanAtTime(
    source: BagSource,
    format: BagFormat,
    topicName: string,
    timeNs: bigint,
  ): Promise<DecodedLaserScan> {
    return this.request<DecodedLaserScan>('readLaserScanAtTime', {
      source,
      format,
      topicName,
      timeNs,
    });
  }

  getTopicType(
    source: BagSource,
    format: BagFormat,
    topicName: string,
  ): Promise<string | undefined> {
    return this.request<string | undefined>('getTopicType', { source, format, topicName });
  }

  disposeParserCaches(): Promise<void> {
    return this.request<void>('disposeParserCaches', undefined);
  }

  /** Return every type name the bundled `ros2galactic` registry knows. */
  getSupportedTypes(): Promise<string[]> {
    return this.request<string[]>('getSupportedTypes', undefined);
  }

  /**
   * Push the full custom-schema map (raw `.msg` text per type) to the worker.
   *
   * Replaces the worker's existing custom-schema state wholesale and
   * invalidates both the CDR reader cache and the .db3 decoded-message LRU
   * so a topic whose type just became decodable produces fresh values on
   * the next read. Sending the whole map (not a delta) keeps the protocol
   * idempotent — the worker doesn't have to track ordering or partial state.
   */
  setCustomSchemas(schemas: Record<string, string>): Promise<void> {
    return this.request<void>('setCustomSchemas', { schemas });
  }

  /**
   * Try parsing `schemaText` as a ROS2 `.msg` definition. The paste modal
   * uses this to surface a useful error inline before committing to the
   * store, so the user never has to wonder why decoding stayed broken.
   */
  validateSchema(schemaText: string): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.request<{ ok: true } | { ok: false; error: string }>(
      'validateSchema',
      { schemaText },
    );
  }

  /**
   * Estimate how many messages would survive an edit, without actually
   * writing the output. Used by the BagEdit modal to size its progress
   * bar before the user hits "Edit & download".
   *
   * v1.2: takes a `format` so the worker can dispatch to the right
   * estimator (MCAP statistics scan, ROS1 chunk-info sum, or .db3 SQL count).
   */
  estimateEditCount(
    source: BagSource,
    format: BagFormat,
    startNs: bigint,
    endNs: bigint,
    topics: string[] | null,
  ): Promise<number> {
    return this.request<number>('estimateEditCount', {
      source,
      format,
      startNs,
      endNs,
      topics,
    });
  }

  /**
   * Stream-edit a bag (any supported format): drop messages outside
   * `[startNs, endNs]` and (optionally) outside the topic filter, then return
   * a fresh MCAP `Uint8Array`. Output is always MCAP regardless of input.
   *
   * `onProgress` fires every ~250 messages with the running write count so
   * the BagEdit modal can update its progress bar. The promise resolves
   * once the writer has flushed its summary section + index.
   *
   * v1.2: replaces v1.1's MCAP-only `editMcap`. `format` selects the
   * read path; `includeUnresolvedTopics` is .db3-only (caller opt-in for
   * topics whose type isn't in the bundled registry).
   */
  editBag(
    source: BagSource,
    format: BagFormat,
    startNs: bigint,
    endNs: bigint,
    topics: string[] | null,
    includeUnresolvedTopics?: string[],
    onProgress?: (written: number) => void,
  ): Promise<EditBagResult> {
    return this.request<EditBagResult>(
      'editBag',
      { source, format, startNs, endNs, topics, includeUnresolvedTopics },
      { onProgress },
    );
  }

  /**
   * For `.db3` inputs, return per-topic resolution status against the bundled
   * type registry + custom schemas. The BagEdit modal uses this to render
   * "schema missing" chips and gate the opt-in toggle before submit.
   */
  getResolvableTopicsDb3(source: BagSource): Promise<Db3TopicResolution[]> {
    return this.request<Db3TopicResolution[]>('getResolvableTopicsDb3', { source });
  }

  readAllMessageStats(source: BagSource, format: BagFormat): Promise<AllTopicStats> {
    return this.request<AllTopicStats>('readAllMessageStats', { source, format });
  }
}

// ─── Per-bag worker registry ───────────────────────────────────────────────

const SHARED = '__shared__';
const clients = new Map<string, ParserClient>();

/**
 * Resolve the worker for a given bagId (or `SHARED` for non-bag operations).
 *
 * The shared worker handles `setCustomSchemas`, `validateSchema`, and
 * `getSupportedTypes` — none of which depend on a particular bag's caches.
 * Bag-tied operations route through per-bag workers so they don't queue
 * behind each other.
 */
export function getParserClient(bagId: string = SHARED): ParserClient {
  let c = clients.get(bagId);
  if (!c) {
    c = new ParserClient();
    clients.set(bagId, c);
  }
  return c;
}

/**
 * Terminate the worker dedicated to a bagId. Called from `bagStore.removeBag`
 * so the worker, its caches, and any pending requests are freed at once.
 */
export function releaseBagWorker(bagId: string): void {
  const c = clients.get(bagId);
  if (!c) return;
  c.terminate();
  clients.delete(bagId);
}

/**
 * For the shared (non-bag) worker — used by `useCustomSchemaSync` on app boot
 * before any bag is loaded. The shared worker also broadcasts custom-schema
 * updates to every per-bag worker since they need the same schemas.
 */
export function getSharedParserClient(): ParserClient {
  return getParserClient(SHARED);
}

/** Currently-registered per-bag workers (excluding shared). */
export function activeBagWorkerIds(): string[] {
  return Array.from(clients.keys()).filter((id) => id !== SHARED);
}
