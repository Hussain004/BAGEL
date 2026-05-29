/// <reference lib="webworker" />
/**
 * BAGEL parser worker.
 *
 * Owns the heavy parsing surface (`@mcap/core`, `sql.js`, `fzstd`, the
 * `@foxglove/rosmsg*` family) so initial bag parsing and per-topic decoding
 * don't block the React render loop. Implements a tiny request/response RPC:
 * every request carries a numeric `id`; the worker streams zero or more
 * `progress` messages with the same id, then exactly one `result` or `error`.
 *
 * The dispatch is intentionally thin — each method just forwards to the
 * existing parser module so the worker doesn't grow its own behavior we'd
 * have to keep in sync.
 */

import type { BagFormat, BagSummary, RawMessage } from '../types/bag';
import {
  parseBag,
  readRawMessages,
  readDeserializedMessages,
  readMessageAtTime,
  readPointCloudAtTime,
  readLaserScanAtTime,
  getTopicType,
  disposeParserCaches,
} from '../parsers/core';
import {
  getSupportedTypes,
  setCustomSchemas,
  validateSchemaText,
} from '../parsers/typeRegistry';
import { clearDb3DecodedCache } from '../parsers/db3';
import type { ColorMode, HeightAxis, PointCloudExtraction } from '../utils/pointcloud';
import type { LaserScanExtraction } from '../utils/laserscan';

type DecodedMessage = { timestamp: bigint; value: Record<string, unknown> | null };

type Method =
  | 'parseBag'
  | 'readRawMessages'
  | 'readDeserializedMessages'
  | 'readMessageAtTime'
  | 'readPointCloudAtTime'
  | 'readLaserScanAtTime'
  | 'getTopicType'
  | 'disposeParserCaches'
  | 'getSupportedTypes'
  | 'setCustomSchemas'
  | 'validateSchema';

interface BaseRequest<P> {
  id: number;
  method: Method;
  params: P;
}

interface ParseBagParams {
  file: File;
}
interface ReadRawMessagesParams {
  file: File;
  format: BagFormat;
  topicName: string;
  limit?: number;
}
type ReadDeserializedMessagesParams = ReadRawMessagesParams;
interface ReadMessageAtTimeParams {
  file: File;
  format: BagFormat;
  topicName: string;
  timeNs: bigint;
}
interface ReadPointCloudAtTimeParams {
  file: File;
  format: BagFormat;
  topicName: string;
  timeNs: bigint;
  colorMode: ColorMode;
  maxPoints?: number;
  maxRange?: number;
  heightAxis?: HeightAxis;
}
interface ReadLaserScanAtTimeParams {
  file: File;
  format: BagFormat;
  topicName: string;
  timeNs: bigint;
}
interface GetTopicTypeParams {
  file: File;
  format: BagFormat;
  topicName: string;
}
interface SetCustomSchemasParams {
  /** typeName -> raw .msg text (concatenated dependencies separated by `=====`). */
  schemas: Record<string, string>;
}
interface ValidateSchemaParams {
  /** Raw `.msg` text to dry-run through the parser. */
  schemaText: string;
}

type WorkerRequest =
  | BaseRequest<ParseBagParams>
  | BaseRequest<ReadRawMessagesParams>
  | BaseRequest<ReadDeserializedMessagesParams>
  | BaseRequest<ReadMessageAtTimeParams>
  | BaseRequest<ReadPointCloudAtTimeParams>
  | BaseRequest<ReadLaserScanAtTimeParams>
  | BaseRequest<GetTopicTypeParams>
  | BaseRequest<SetCustomSchemasParams>
  | BaseRequest<ValidateSchemaParams>
  | BaseRequest<undefined>;

interface ProgressResponse {
  id: number;
  type: 'progress';
  decoded: number;
}
/**
 * Streamed decoded-message batch for `readDeserializedMessages`. The client
 * accumulates these into the full array; the final `result` for streamed
 * methods carries no payload (the data is already on the main thread).
 */
interface BatchResponse {
  id: number;
  type: 'batch';
  batch: DecodedMessage[];
}
interface ResultResponse<T> {
  id: number;
  type: 'result';
  result: T;
}
interface ErrorResponse {
  id: number;
  type: 'error';
  error: string;
}

export type WorkerResponse =
  | ProgressResponse
  | BatchResponse
  | ResultResponse<BagSummary>
  | ResultResponse<RawMessage[]>
  | ResultResponse<DecodedMessage[]>
  | ResultResponse<DecodedMessage | null>
  | ResultResponse<(PointCloudExtraction & { timestamp: bigint }) | null>
  | ResultResponse<(LaserScanExtraction & { timestamp: bigint }) | null>
  | ResultResponse<string | undefined>
  | ResultResponse<string[]>
  | ResultResponse<{ ok: true } | { ok: false; error: string }>
  | ResultResponse<void>
  | ErrorResponse;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const respond = <T>(payload: T, transfer?: Transferable[]) => {
    const msg = { id: req.id, type: 'result', result: payload } satisfies ResultResponse<T>;
    if (transfer && transfer.length > 0) {
      ctx.postMessage(msg, transfer);
    } else {
      ctx.postMessage(msg);
    }
  };
  const fail = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ id: req.id, type: 'error', error: message } satisfies ErrorResponse);
  };

  try {
    switch (req.method) {
      case 'parseBag': {
        const { file } = req.params as ParseBagParams;
        respond(await parseBag(file));
        return;
      }
      case 'readRawMessages': {
        const { file, format, topicName, limit } = req.params as ReadRawMessagesParams;
        respond(await readRawMessages(file, format, topicName, limit));
        return;
      }
      case 'readDeserializedMessages': {
        const { file, format, topicName, limit } = req.params as ReadDeserializedMessagesParams;
        // Stream batches to the client as they're decoded, then finish with
        // an empty result that just signals completion. The client builds
        // the final array from the batches — sending `out` here too would
        // double-ship the full payload through structured clone.
        await readDeserializedMessages(
          file,
          format,
          topicName,
          limit,
          (decoded) =>
            ctx.postMessage({ id: req.id, type: 'progress', decoded } satisfies ProgressResponse),
          (batch) =>
            ctx.postMessage({ id: req.id, type: 'batch', batch } satisfies BatchResponse),
        );
        respond(undefined);
        return;
      }
      case 'readMessageAtTime': {
        const { file, format, topicName, timeNs } = req.params as ReadMessageAtTimeParams;
        respond(await readMessageAtTime(file, format, topicName, timeNs));
        return;
      }
      case 'readPointCloudAtTime': {
        const { file, format, topicName, timeNs, colorMode, maxPoints, maxRange, heightAxis } =
          req.params as ReadPointCloudAtTimeParams;
        const result = await readPointCloudAtTime(
          file,
          format,
          topicName,
          timeNs,
          colorMode,
          maxPoints,
          maxRange,
          heightAxis,
        );
        // Transfer the Float32Array backing buffers — zero copy to the main
        // thread. positions / colors are unique per decode, never shared.
        const transfer = result
          ? [result.positions.buffer, result.colors.buffer]
          : undefined;
        respond(result, transfer as Transferable[] | undefined);
        return;
      }
      case 'readLaserScanAtTime': {
        const { file, format, topicName, timeNs } =
          req.params as ReadLaserScanAtTimeParams;
        const result = await readLaserScanAtTime(file, format, topicName, timeNs);
        const transfer = result
          ? [result.positions.buffer, result.colors.buffer]
          : undefined;
        respond(result, transfer as Transferable[] | undefined);
        return;
      }
      case 'getTopicType': {
        const { file, format, topicName } = req.params as GetTopicTypeParams;
        respond(await getTopicType(file, format, topicName));
        return;
      }
      case 'disposeParserCaches': {
        disposeParserCaches();
        respond(undefined);
        return;
      }
      case 'getSupportedTypes': {
        respond(await getSupportedTypes());
        return;
      }
      case 'setCustomSchemas': {
        const { schemas } = req.params as SetCustomSchemasParams;
        setCustomSchemas(schemas);
        // .db3 holds a per-(topic, timestamp) decoded LRU; entries cached as
        // `null` while a schema was missing would still be returned after the
        // user pastes the schema. Wipe them so the next read decodes fresh.
        clearDb3DecodedCache();
        respond(undefined);
        return;
      }
      case 'validateSchema': {
        const { schemaText } = req.params as ValidateSchemaParams;
        respond(validateSchemaText(schemaText));
        return;
      }
      default:
        throw new Error(`Unknown worker method: ${(req as { method: string }).method}`);
    }
  } catch (err) {
    fail(err);
  }
});
