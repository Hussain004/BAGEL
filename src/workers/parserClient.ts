/**
 * Main-thread client for the parser worker.
 *
 * Wraps `parser.worker.ts` with a promise-based API that matches the old
 * synchronous-looking parser surface. Each call gets a unique numeric id
 * so we can multiplex many in-flight reads (image scrubs + a plot decode
 * + a TF load can all run concurrently against the same worker).
 *
 * The worker is created on first use and kept alive for the lifetime of
 * the page — its MCAP reader / sql.js Database caches are what make
 * subsequent reads cheap, so tearing it down would defeat that.
 */

import type { BagFormat, BagSummary, RawMessage } from '../types/bag';
import type { ColorMode, HeightAxis, PointCloudExtraction } from '../utils/pointcloud';
import type { LaserScanExtraction } from '../utils/laserscan';

type DecodedMessage = { timestamp: bigint; value: Record<string, unknown> | null };
type DecodedPointCloud = (PointCloudExtraction & { timestamp: bigint }) | null;
type DecodedLaserScan = (LaserScanExtraction & { timestamp: bigint }) | null;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (decoded: number) => void;
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
      | { id: number; type: 'result'; result: unknown }
      | { id: number; type: 'error'; error: string };
    const pending = this.pending.get(data.id);
    if (!pending) return;

    if (data.type === 'progress') {
      pending.onProgress?.(data.decoded);
      return;
    }
    if (data.type === 'error') {
      this.pending.delete(data.id);
      pending.reject(new Error(data.error));
      return;
    }
    if (data.type === 'result') {
      this.pending.delete(data.id);
      pending.resolve(data.result);
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

  private request<T>(
    method: string,
    params: Record<string, unknown> | undefined,
    onProgress?: (decoded: number) => void,
  ): Promise<T> {
    const worker = this.ensureWorker();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress,
      });
      worker.postMessage({ id, method, params });
    });
  }

  parseBag(file: File): Promise<BagSummary> {
    return this.request<BagSummary>('parseBag', { file });
  }

  readRawMessages(
    file: File,
    format: BagFormat,
    topicName: string,
    limit?: number,
  ): Promise<RawMessage[]> {
    return this.request<RawMessage[]>('readRawMessages', { file, format, topicName, limit });
  }

  readDeserializedMessages(
    file: File,
    format: BagFormat,
    topicName: string,
    limit?: number,
    onProgress?: (decoded: number) => void,
  ): Promise<DecodedMessage[]> {
    return this.request<DecodedMessage[]>(
      'readDeserializedMessages',
      { file, format, topicName, limit },
      onProgress,
    );
  }

  readMessageAtTime(
    file: File,
    format: BagFormat,
    topicName: string,
    timeNs: bigint,
  ): Promise<DecodedMessage | null> {
    return this.request<DecodedMessage | null>('readMessageAtTime', {
      file,
      format,
      topicName,
      timeNs,
    });
  }

  readPointCloudAtTime(
    file: File,
    format: BagFormat,
    topicName: string,
    timeNs: bigint,
    colorMode: ColorMode,
    maxPoints?: number,
    maxRange?: number,
    heightAxis?: HeightAxis,
  ): Promise<DecodedPointCloud> {
    return this.request<DecodedPointCloud>('readPointCloudAtTime', {
      file,
      format,
      topicName,
      timeNs,
      colorMode,
      maxPoints,
      maxRange,
      heightAxis,
    });
  }

  readLaserScanAtTime(
    file: File,
    format: BagFormat,
    topicName: string,
    timeNs: bigint,
  ): Promise<DecodedLaserScan> {
    return this.request<DecodedLaserScan>('readLaserScanAtTime', {
      file,
      format,
      topicName,
      timeNs,
    });
  }

  getTopicType(
    file: File,
    format: BagFormat,
    topicName: string,
  ): Promise<string | undefined> {
    return this.request<string | undefined>('getTopicType', { file, format, topicName });
  }

  disposeParserCaches(): Promise<void> {
    return this.request<void>('disposeParserCaches', undefined);
  }
}

let singleton: ParserClient | null = null;

export function getParserClient(): ParserClient {
  if (!singleton) singleton = new ParserClient();
  return singleton;
}
