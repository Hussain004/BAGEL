/**
 * Building and reading service calls. The request is edited as JSON in the UI,
 * then written in whatever encoding the server advertised for that service.
 */

import { parse as parseRosMsgDefinition } from '@foxglove/rosmsg';
import { MessageReader as Ros2Reader, MessageWriter as Ros2Writer } from '@foxglove/rosmsg2-serialization';
import { MessageReader as Ros1Reader, MessageWriter as Ros1Writer } from '@foxglove/rosmsg-serialization';
import type { FoxgloveService } from './foxgloveClient';

type Defs = ReturnType<typeof parseRosMsgDefinition>;

function parseSchema(text: string, ros2: boolean): Defs {
  return parseRosMsgDefinition(text, { ros2 });
}

/** A request with every field present and zeroed: a starting point to edit. */
export function skeletonFor(schema: string, ros2 = true): Record<string, unknown> {
  if (!schema.trim()) return {};
  const defs = parseSchema(schema, ros2);
  const byName = new Map(defs.filter((d) => d.name).map((d) => [d.name!, d]));
  const build = (def: Defs[number], depth: number): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of def.definitions) {
      if (f.isConstant) continue;
      if (f.isArray) {
        out[f.name] = f.arrayLength && !f.isComplex ? Array.from({ length: f.arrayLength }, () => primitiveZero(f.type)) : [];
      } else if (f.isComplex) {
        const nested = byName.get(f.type);
        out[f.name] = nested && depth < 6 ? build(nested, depth + 1) : {};
      } else {
        out[f.name] = f.defaultValue !== undefined ? f.defaultValue : primitiveZero(f.type);
      }
    }
    return out;
  };
  return build(defs[0]!, 0);
}

function primitiveZero(type: string): unknown {
  if (type === 'string' || type === 'wstring') return '';
  if (type === 'bool') return false;
  return 0;
}

export class ServiceEncodingError extends Error {}

export function encodeRequest(service: FoxgloveService, request: unknown): { encoding: string; payload: Uint8Array } {
  const encoding = service.requestEncoding;
  if (encoding === 'json') return { encoding, payload: new TextEncoder().encode(JSON.stringify(request)) };
  const ros2 = encoding === 'cdr';
  if (!ros2 && encoding !== 'ros1') throw new ServiceEncodingError(`This service uses "${encoding}", which BAGEL cannot write.`);
  if (!service.requestSchema.trim()) {
    // An empty schema is a message with no fields (std_srvs/Empty).
    return { encoding, payload: ros2 ? new Ros2Writer(parseSchema('', true)).writeMessage({}) : new Uint8Array(0) };
  }
  const defs = parseSchema(service.requestSchema, ros2);
  const writer = ros2 ? new Ros2Writer(defs) : new Ros1Writer(defs);
  return { encoding, payload: writer.writeMessage(request) };
}

export function decodeResponse(service: FoxgloveService, encoding: string, payload: Uint8Array): unknown {
  if (encoding === 'json') return JSON.parse(new TextDecoder().decode(payload));
  const ros2 = encoding === 'cdr';
  if (!ros2 && encoding !== 'ros1') throw new ServiceEncodingError(`The response is "${encoding}", which BAGEL cannot read.`);
  if (!service.responseSchema.trim()) return {};
  const defs = parseSchema(service.responseSchema, ros2);
  return (ros2 ? new Ros2Reader(defs) : new Ros1Reader(defs)).readMessage(payload);
}

/** JSON text for a value that may contain bigints or typed arrays. */
export function toJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_k, v) => (typeof v === 'bigint' ? v.toString() : ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v),
    2,
  );
}
