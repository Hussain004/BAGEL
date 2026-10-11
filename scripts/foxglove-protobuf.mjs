/**
 * Write Foxglove messages as protobuf for the sample bag, the way the Foxglove
 * SDKs record them.
 *
 * foxglove-protobuf.json holds the real FileDescriptorSets and field tables for
 * foxglove.ImageAnnotations and foxglove.SceneUpdate, taken from the official
 * `foxglove-schemas-protobuf` Python package (descriptor -> FileDescriptorSet
 * with its dependencies, plus name -> [number, type, label, message type] per
 * field). Regenerate it from that package if Foxglove changes the schemas.
 *
 * Values are plain objects keyed by the proto field names; Timestamp and
 * Duration are { seconds, nanos }. Unset fields are left out, as proto3 does.
 */

import { readFileSync } from 'node:fs';

const DATA = JSON.parse(readFileSync(new URL('./foxglove-protobuf.json', import.meta.url), 'utf8'));

/** The FileDescriptorSet an MCAP `protobuf` schema record carries. */
export function foxgloveSchema(name) {
  const b64 = DATA.schemas[name];
  if (!b64) throw new Error(`no descriptor set for ${name}`);
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

const T = { DOUBLE: 1, FLOAT: 2, INT64: 3, UINT64: 4, INT32: 5, FIXED64: 6, FIXED32: 7, BOOL: 8, STRING: 9, MESSAGE: 11, BYTES: 12, UINT32: 13, ENUM: 14, SFIXED32: 15, SFIXED64: 16, SINT32: 17, SINT64: 18 };
const LENGTH_DELIMITED = new Set([T.STRING, T.MESSAGE, T.BYTES]);
const WIRE = { [T.DOUBLE]: 1, [T.FIXED64]: 1, [T.SFIXED64]: 1, [T.FLOAT]: 5, [T.FIXED32]: 5, [T.SFIXED32]: 5 };

function varint(value) {
  let v = BigInt.asUintN(64, BigInt(value));
  const out = [];
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}

function scalar(type, v) {
  const fixed = (n, set) => {
    const b = Buffer.alloc(n);
    set(b);
    return [...b];
  };
  switch (type) {
    case T.DOUBLE: return fixed(8, (b) => b.writeDoubleLE(v));
    case T.FLOAT: return fixed(4, (b) => b.writeFloatLE(v));
    case T.FIXED32: return fixed(4, (b) => b.writeUInt32LE(v));
    case T.SFIXED32: return fixed(4, (b) => b.writeInt32LE(v));
    case T.FIXED64: return fixed(8, (b) => b.writeBigUInt64LE(BigInt(v)));
    case T.SFIXED64: return fixed(8, (b) => b.writeBigInt64LE(BigInt(v)));
    case T.BOOL: return [v ? 1 : 0];
    case T.SINT32:
    case T.SINT64: {
      const n = BigInt(v);
      return varint((n << 1n) ^ (n >> 63n));
    }
    default: return varint(Math.round(Number(v)) === Number(v) ? v : Math.round(v));
  }
}

const tag = (number, wire) => varint((number << 3) | wire);
const ld = (number, body) => [...tag(number, 2), ...varint(body.length), ...body];

/** Encode `value` as the protobuf message `name` (e.g. `foxglove.SceneUpdate`). */
export function encodeFoxglove(name, value) {
  const fields = DATA.messages[name];
  if (!fields) throw new Error(`no field table for ${name}`);
  const out = [];
  const entries = Object.entries(fields).sort((a, b) => a[1][0] - b[1][0]);
  for (const [fieldName, [number, type, label, typeName]] of entries) {
    const v = value[fieldName];
    if (v === undefined || v === null) continue;
    const list = label === 3 ? v : [v];
    if (label === 3 && !LENGTH_DELIMITED.has(type)) {
      if (list.length) out.push(...ld(number, list.flatMap((x) => scalar(type, x))));
      continue;
    }
    for (const x of list) {
      if (type === T.MESSAGE) out.push(...ld(number, encodeFoxglove(typeName, x)));
      else if (type === T.STRING) out.push(...ld(number, [...Buffer.from(x, 'utf8')]));
      else if (type === T.BYTES) out.push(...ld(number, [...x]));
      else out.push(...tag(number, WIRE[type] ?? 0), ...scalar(type, x));
    }
  }
  return Uint8Array.from(out);
}
