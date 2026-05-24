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
  getTopicType,
  disposeParserCaches,
} from '../parsers/core';

type DecodedMessage = { timestamp: bigint; value: Record<string, unknown> | null };

type Method =
  | 'parseBag'
  | 'readRawMessages'
  | 'readDeserializedMessages'
  | 'readMessageAtTime'
  | 'getTopicType'
  | 'disposeParserCaches';

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
interface GetTopicTypeParams {
  file: File;
  format: BagFormat;
  topicName: string;
}

type WorkerRequest =
  | BaseRequest<ParseBagParams>
  | BaseRequest<ReadRawMessagesParams>
  | BaseRequest<ReadDeserializedMessagesParams>
  | BaseRequest<ReadMessageAtTimeParams>
  | BaseRequest<GetTopicTypeParams>
  | BaseRequest<undefined>;

interface ProgressResponse {
  id: number;
  type: 'progress';
  decoded: number;
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
  | ResultResponse<BagSummary>
  | ResultResponse<RawMessage[]>
  | ResultResponse<DecodedMessage[]>
  | ResultResponse<DecodedMessage | null>
  | ResultResponse<string | undefined>
  | ResultResponse<void>
  | ErrorResponse;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener('message', async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const respond = <T>(payload: T) =>
    ctx.postMessage({ id: req.id, type: 'result', result: payload } satisfies ResultResponse<T>);
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
        const out = await readDeserializedMessages(
          file,
          format,
          topicName,
          limit,
          (decoded) =>
            ctx.postMessage({ id: req.id, type: 'progress', decoded } satisfies ProgressResponse),
        );
        respond(out);
        return;
      }
      case 'readMessageAtTime': {
        const { file, format, topicName, timeNs } = req.params as ReadMessageAtTimeParams;
        respond(await readMessageAtTime(file, format, topicName, timeNs));
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
      default:
        throw new Error(`Unknown worker method: ${(req as { method: string }).method}`);
    }
  } catch (err) {
    fail(err);
  }
});
