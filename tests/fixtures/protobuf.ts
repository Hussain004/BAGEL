/**
 * Protobuf test builders: the wire format, a FileDescriptorSet writer, and the
 * Foxglove message definitions BAGEL reads (with `google.protobuf.Timestamp`
 * in its own file, the way `protoc --include_imports` ships them).
 *
 * The encoder is written from the wire-format spec, independent of the decoder
 * under test, and has switches for the choices real producers differ on
 * (packed or unpacked repeated scalars, field order).
 */
import { McapWriter } from '@mcap/core';
import { makeMemoryWritable } from './synth';

export const TYPE = {
  DOUBLE: 1, FLOAT: 2, INT64: 3, UINT64: 4, INT32: 5, FIXED64: 6, FIXED32: 7, BOOL: 8,
  STRING: 9, MESSAGE: 11, BYTES: 12, UINT32: 13, ENUM: 14, SFIXED32: 15, SFIXED64: 16,
  SINT32: 17, SINT64: 18,
} as const;

// --- Wire format ---------------------------------------------------------------

export function concat(...parts: Array<Uint8Array | number[]>): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Unsigned varint; negative numbers and bigints use 64-bit two's complement. */
export function varint(value: number | bigint): number[] {
  let v = BigInt.asUintN(64, BigInt(value));
  const out: number[] = [];
  while (v >= 0x80n) {
    out.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  out.push(Number(v));
  return out;
}

export const tag = (field: number, wire: number): number[] => varint((field << 3) | wire);
export const ld = (field: number, body: Uint8Array | number[]): Uint8Array =>
  concat(tag(field, 2), varint(body.length), body);
export const str = (field: number, s: string): Uint8Array => ld(field, new TextEncoder().encode(s));
export const vint = (field: number, v: number | bigint): Uint8Array => concat(tag(field, 0), varint(v));
export const zigzag = (v: number | bigint): bigint => {
  const b = BigInt(v);
  return BigInt.asUintN(64, (b << 1n) ^ (b >> 63n));
};
export function fixed32(field: number, f: (dv: DataView) => void): Uint8Array {
  const b = new Uint8Array(4);
  f(new DataView(b.buffer));
  return concat(tag(field, 5), b);
}
export function fixed64(field: number, f: (dv: DataView) => void): Uint8Array {
  const b = new Uint8Array(8);
  f(new DataView(b.buffer));
  return concat(tag(field, 1), b);
}

// --- Descriptors ---------------------------------------------------------------

export interface FieldSpec {
  name: string;
  number: number;
  type: number;
  repeated?: boolean;
  /** `.pkg.Message` for message and enum fields. */
  typeName?: string;
}

export interface MessageSpec {
  name: string;
  fields: FieldSpec[];
  nested?: MessageSpec[];
  mapEntry?: boolean;
}

export interface FileSpec {
  name: string;
  pkg: string;
  messages: MessageSpec[];
}

function fieldDescriptor(f: FieldSpec): Uint8Array {
  return concat(
    str(1, f.name),
    vint(3, f.number),
    vint(4, f.repeated ? 3 : 1),
    vint(5, f.type),
    f.typeName ? str(6, f.typeName) : new Uint8Array(0),
  );
}

function messageDescriptor(m: MessageSpec): Uint8Array {
  return concat(
    str(1, m.name),
    ...m.fields.map((f) => ld(2, fieldDescriptor(f))),
    ...(m.nested ?? []).map((n) => ld(3, messageDescriptor(n))),
    m.mapEntry ? ld(7, vint(7, 1)) : new Uint8Array(0),
  );
}

export function descriptorSet(files: FileSpec[]): Uint8Array {
  return concat(
    ...files.map((f) => ld(1, concat(str(1, f.name), str(2, f.pkg), ...f.messages.map((m) => ld(4, messageDescriptor(m)))))),
  );
}

// --- Encoding values against a spec --------------------------------------------

export interface EncodeOptions {
  /** Write repeated scalars as one packed field (proto3 default) or one tag each. */
  packed?: boolean;
  /** Emit fields in descending number order (the wire format allows any order). */
  reverse?: boolean;
}

type Lookup = (typeName: string) => MessageSpec;

function scalar(f: FieldSpec, v: unknown): number[] | Uint8Array {
  switch (f.type) {
    case TYPE.INT32: case TYPE.INT64: case TYPE.UINT32: case TYPE.UINT64: case TYPE.ENUM:
      return varint(v as number | bigint);
    case TYPE.BOOL: return [v ? 1 : 0];
    case TYPE.SINT32: case TYPE.SINT64: return varint(zigzag(v as number | bigint));
    case TYPE.DOUBLE: { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v as number, true); return b; }
    case TYPE.FLOAT: { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v as number, true); return b; }
    case TYPE.FIXED32: { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v as number, true); return b; }
    case TYPE.SFIXED32: { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, v as number, true); return b; }
    case TYPE.FIXED64: { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v as number | bigint), true); return b; }
    case TYPE.SFIXED64: { const b = new Uint8Array(8); new DataView(b.buffer).setBigInt64(0, BigInt(v as number | bigint), true); return b; }
    default: throw new Error(`not a numeric scalar: ${f.type}`);
  }
}

const WIRE: Record<number, number> = {
  [TYPE.INT32]: 0, [TYPE.INT64]: 0, [TYPE.UINT32]: 0, [TYPE.UINT64]: 0, [TYPE.ENUM]: 0, [TYPE.BOOL]: 0,
  [TYPE.SINT32]: 0, [TYPE.SINT64]: 0, [TYPE.DOUBLE]: 1, [TYPE.FIXED64]: 1, [TYPE.SFIXED64]: 1,
  [TYPE.FLOAT]: 5, [TYPE.FIXED32]: 5, [TYPE.SFIXED32]: 5,
};

function encodeOne(f: FieldSpec, v: unknown, lookup: Lookup, opts: EncodeOptions): Uint8Array {
  if (f.type === TYPE.STRING) return str(f.number, v as string);
  if (f.type === TYPE.BYTES) return ld(f.number, v as Uint8Array);
  if (f.type === TYPE.MESSAGE) return ld(f.number, encode(lookup(f.typeName!), v as Record<string, unknown>, lookup, opts));
  return concat(tag(f.number, WIRE[f.type]!), scalar(f, v));
}

export function encode(spec: MessageSpec, value: Record<string, unknown>, lookup: Lookup, opts: EncodeOptions = {}): Uint8Array {
  const fields = [...spec.fields].sort((a, b) => (opts.reverse ? b.number - a.number : a.number - b.number));
  const parts: Uint8Array[] = [];
  for (const f of fields) {
    const v = value[f.name];
    if (v === undefined) continue;
    if (f.repeated) {
      const list = v as unknown[];
      const numeric = f.type !== TYPE.STRING && f.type !== TYPE.BYTES && f.type !== TYPE.MESSAGE;
      if (numeric && opts.packed !== false) {
        if (list.length) parts.push(ld(f.number, concat(...list.map((x) => scalar(f, x)))));
      } else for (const x of list) parts.push(encodeOne(f, x, lookup, opts));
    } else parts.push(encodeOne(f, v, lookup, opts));
  }
  return concat(...parts);
}

// --- Foxglove message definitions ----------------------------------------------

const f = (name: string, number: number, type: number, extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, number, type, ...extra });
const msg = (name: string, typeName: string, number: number, repeated = false): FieldSpec =>
  f(name, number, TYPE.MESSAGE, { typeName, repeated });

const TIMESTAMP = '.google.protobuf.Timestamp';
const DURATION = '.google.protobuf.Duration';

const FILES: FileSpec[] = [
  {
    name: 'google/protobuf/timestamp.proto',
    pkg: 'google.protobuf',
    messages: [
      { name: 'Timestamp', fields: [f('seconds', 1, TYPE.INT64), f('nanos', 2, TYPE.INT32)] },
      { name: 'Duration', fields: [f('seconds', 1, TYPE.INT64), f('nanos', 2, TYPE.INT32)] },
    ],
  },
  {
    name: 'foxglove.proto',
    pkg: 'foxglove',
    messages: [
      { name: 'Color', fields: [f('r', 1, TYPE.DOUBLE), f('g', 2, TYPE.DOUBLE), f('b', 3, TYPE.DOUBLE), f('a', 4, TYPE.DOUBLE)] },
      { name: 'Point2', fields: [f('x', 1, TYPE.DOUBLE), f('y', 2, TYPE.DOUBLE)] },
      { name: 'Vector3', fields: [f('x', 1, TYPE.DOUBLE), f('y', 2, TYPE.DOUBLE), f('z', 3, TYPE.DOUBLE)] },
      { name: 'Quaternion', fields: [f('x', 1, TYPE.DOUBLE), f('y', 2, TYPE.DOUBLE), f('z', 3, TYPE.DOUBLE), f('w', 4, TYPE.DOUBLE)] },
      { name: 'Pose', fields: [msg('position', '.foxglove.Vector3', 1), msg('orientation', '.foxglove.Quaternion', 2)] },
      {
        name: 'CompressedImage',
        fields: [msg('timestamp', TIMESTAMP, 1), f('frame_id', 2, TYPE.STRING), f('data', 3, TYPE.BYTES), f('format', 4, TYPE.STRING)],
      },
      {
        name: 'RawImage',
        fields: [
          msg('timestamp', TIMESTAMP, 1), f('frame_id', 2, TYPE.STRING), f('width', 3, TYPE.FIXED32), f('height', 4, TYPE.FIXED32),
          f('encoding', 5, TYPE.STRING), f('step', 6, TYPE.FIXED32), f('data', 7, TYPE.BYTES),
        ],
      },
      {
        name: 'CircleAnnotation',
        fields: [
          msg('timestamp', TIMESTAMP, 1), msg('position', '.foxglove.Point2', 2), f('diameter', 3, TYPE.DOUBLE),
          f('thickness', 4, TYPE.DOUBLE), msg('fill_color', '.foxglove.Color', 5), msg('outline_color', '.foxglove.Color', 6),
        ],
      },
      {
        name: 'PointsAnnotation',
        fields: [
          msg('timestamp', TIMESTAMP, 1), f('type', 2, TYPE.ENUM, { typeName: '.foxglove.PointsAnnotation.Type' }),
          msg('points', '.foxglove.Point2', 3, true), msg('outline_color', '.foxglove.Color', 4),
          msg('outline_colors', '.foxglove.Color', 5, true), msg('fill_color', '.foxglove.Color', 6), f('thickness', 7, TYPE.DOUBLE),
        ],
      },
      {
        name: 'TextAnnotation',
        fields: [
          msg('timestamp', TIMESTAMP, 1), msg('position', '.foxglove.Point2', 2), f('text', 3, TYPE.STRING),
          f('font_size', 4, TYPE.DOUBLE), msg('text_color', '.foxglove.Color', 5), msg('background_color', '.foxglove.Color', 6),
        ],
      },
      {
        name: 'ImageAnnotations',
        fields: [
          msg('circles', '.foxglove.CircleAnnotation', 1, true), msg('points', '.foxglove.PointsAnnotation', 2, true),
          msg('texts', '.foxglove.TextAnnotation', 3, true),
        ],
      },
      { name: 'CubePrimitive', fields: [msg('pose', '.foxglove.Pose', 1), msg('size', '.foxglove.Vector3', 2), msg('color', '.foxglove.Color', 3)] },
      {
        name: 'LinePrimitive',
        fields: [
          f('type', 1, TYPE.ENUM, { typeName: '.foxglove.LinePrimitive.Type' }), msg('pose', '.foxglove.Pose', 2),
          f('thickness', 3, TYPE.DOUBLE), f('scale_invariant', 4, TYPE.BOOL), msg('points', '.foxglove.Vector3', 5, true),
          msg('color', '.foxglove.Color', 6), msg('colors', '.foxglove.Color', 7, true), f('indices', 8, TYPE.FIXED32, { repeated: true }),
        ],
      },
      {
        name: 'SceneEntity',
        fields: [
          msg('timestamp', TIMESTAMP, 1), f('frame_id', 2, TYPE.STRING), f('id', 3, TYPE.STRING), msg('lifetime', DURATION, 4),
          f('frame_locked', 5, TYPE.BOOL), msg('cubes', '.foxglove.CubePrimitive', 8, true), msg('lines', '.foxglove.LinePrimitive', 11, true),
        ],
      },
      {
        name: 'SceneEntityDeletion',
        fields: [msg('timestamp', TIMESTAMP, 1), f('type', 2, TYPE.ENUM, { typeName: '.foxglove.SceneEntityDeletion.Type' }), f('id', 3, TYPE.STRING)],
      },
      {
        name: 'SceneUpdate',
        fields: [msg('deletions', '.foxglove.SceneEntityDeletion', 1, true), msg('entities', '.foxglove.SceneEntity', 2, true)],
      },
    ],
  },
];

export const foxgloveDescriptorSet = (): Uint8Array => descriptorSet(FILES);

/** Encode a Foxglove message by its full name, e.g. `foxglove.ImageAnnotations`. */
export function encodeFoxglove(fullName: string, value: Record<string, unknown>, opts?: EncodeOptions): Uint8Array {
  const byName = new Map<string, MessageSpec>();
  for (const file of FILES) for (const m of file.messages) byName.set(`.${file.pkg}.${m.name}`, m);
  const lookup: Lookup = (n) => {
    const m = byName.get(n);
    if (!m) throw new Error(`fixture has no ${n}`);
    return m;
  };
  return encode(lookup(`.${fullName}`), value, lookup, opts);
}

export const ts = (sec: number, nsec = 0) => ({ seconds: sec, nanos: nsec });

// --- MCAP ----------------------------------------------------------------------

export interface ProtobufTopic {
  topic: string;
  /** e.g. `foxglove.ImageAnnotations`. */
  schemaName: string;
  messages: Array<{ logTime: bigint; data: Uint8Array }>;
  /** Defaults to the Foxglove set above. */
  schema?: Uint8Array;
}

export async function writeProtobufMcap(topics: ProtobufTopic[]): Promise<Uint8Array> {
  const writable = makeMemoryWritable();
  const writer = new McapWriter({ writable, useChunks: true });
  await writer.start({ profile: '', library: 'bagel-protobuf-fixture' });
  const ids: number[] = [];
  for (const t of topics) {
    const schemaId = await writer.registerSchema({ name: t.schemaName, encoding: 'protobuf', data: t.schema ?? foxgloveDescriptorSet() });
    ids.push(await writer.registerChannel({ schemaId, topic: t.topic, messageEncoding: 'protobuf', metadata: new Map() }));
  }
  const events = topics.flatMap((t, i) => t.messages.map((m) => ({ channelId: ids[i]!, logTime: m.logTime, data: m.data })));
  events.sort((a, b) => (a.logTime < b.logTime ? -1 : a.logTime > b.logTime ? 1 : 0));
  let sequence = 0;
  for (const e of events) await writer.addMessage({ channelId: e.channelId, sequence: sequence++, logTime: e.logTime, publishTime: e.logTime, data: e.data });
  await writer.end();
  return writable.getBytes();
}
