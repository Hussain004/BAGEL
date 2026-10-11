/**
 * Schema-driven protobuf decoding for MCAP channels and live bridges.
 *
 * An MCAP protobuf schema (and a Foxglove bridge `protobuf` channel schema) is a
 * serialized `FileDescriptorSet`. This module reads that set with a minimal
 * wire-format reader, then decodes messages against it. No code generation, no
 * `eval`, no dependency.
 *
 * The output deliberately matches what the JSON path produces for the same
 * schema: proto field names are kept as written (snake_case), `Timestamp` and
 * `Duration` become `{ sec, nsec }`, bytes become `Uint8Array`, enums stay
 * numbers, and proto3 scalar defaults are filled in. That lets
 * `translateFoxgloveMessage` and every panel treat protobuf and JSON alike.
 *
 * 64-bit integers are numbers when they fit in 53 bits and bigints otherwise,
 * so nothing is silently rounded.
 */

const T = {
  DOUBLE: 1, FLOAT: 2, INT64: 3, UINT64: 4, INT32: 5, FIXED64: 6, FIXED32: 7, BOOL: 8,
  STRING: 9, GROUP: 10, MESSAGE: 11, BYTES: 12, UINT32: 13, ENUM: 14,
  SFIXED32: 15, SFIXED64: 16, SINT32: 17, SINT64: 18,
} as const;

const MAX_DEPTH = 64;
const TEXT = new TextDecoder();

interface FieldDef {
  name: string;
  number: number;
  type: number;
  repeated: boolean;
  /** Fully qualified `.pkg.Message` for message and enum fields. */
  typeName: string;
}

interface MessageDef {
  fullName: string;
  fields: Map<number, FieldDef>;
  isMapEntry: boolean;
}

type Defs = Map<string, MessageDef>;

// --- Wire reader ---------------------------------------------------------------

class Reader {
  pos = 0;
  readonly buf: Uint8Array;
  readonly end: number;
  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.end = buf.length;
  }

  get done(): boolean { return this.pos >= this.end; }

  /** Varint as [low32, high32] words so 64-bit values stay exact. */
  varintWords(): [number, number] {
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) throw new Error('protobuf: truncated varint');
      const b = this.buf[this.pos++]!;
      if (i < 4) lo |= (b & 0x7f) << (7 * i);
      else if (i === 4) {
        lo |= (b & 0x0f) << 28;
        hi |= (b & 0x70) >>> 4;
      } else hi |= (b & 0x7f) << (7 * i - 32);
      if (b < 0x80) return [lo >>> 0, hi >>> 0];
    }
    throw new Error('protobuf: varint too long');
  }

  /** Unsigned varint that must fit a JS number (tags, lengths, enum values). */
  varint(): number {
    const [lo, hi] = this.varintWords();
    return hi * 4294967296 + lo;
  }

  bytes(n: number): Uint8Array {
    if (n < 0 || this.pos + n > this.end) throw new Error('protobuf: truncated field');
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  fixed32Words(): number {
    const b = this.bytes(4);
    return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
  }

  fixed64Words(): [number, number] {
    const lo = this.fixed32Words();
    const hi = this.fixed32Words();
    return [lo, hi];
  }

  skip(wire: number, depth = 0): void {
    if (wire === 0) this.varintWords();
    else if (wire === 1) this.bytes(8);
    else if (wire === 2) this.bytes(this.varint());
    else if (wire === 5) this.bytes(4);
    else if (wire === 3) {
      if (depth > MAX_DEPTH) throw new Error('protobuf: groups nested too deeply');
      for (;;) {
        const tag = this.varint();
        const w = tag & 7;
        if (w === 4) return;
        this.skip(w, depth + 1);
      }
    } else throw new Error(`protobuf: bad wire type ${wire}`);
  }
}

function unsigned64(lo: number, hi: number): number | bigint {
  if (hi < 0x200000) return hi * 4294967296 + lo;
  return (BigInt(hi) << 32n) | BigInt(lo);
}

function signed64(lo: number, hi: number): number | bigint {
  if (hi < 0x80000000) return unsigned64(lo, hi);
  // Two's complement negative.
  const v = ((BigInt(hi) << 32n) | BigInt(lo)) - (1n << 64n);
  return v >= -9007199254740991n ? Number(v) : v;
}

function zigzag64(lo: number, hi: number): number | bigint {
  const v = (BigInt(hi) << 32n) | BigInt(lo);
  const d = (v >> 1n) ^ -(v & 1n);
  return d >= -9007199254740991n && d <= 9007199254740991n ? Number(d) : d;
}

// --- Descriptor parsing --------------------------------------------------------

function readFieldDescriptor(r: Reader): FieldDef {
  const f = { name: '', number: 0, type: 0, repeated: false, typeName: '' };
  let label = 1;
  while (!r.done) {
    const tag = r.varint();
    const num = tag >>> 3;
    const wire = tag & 7;
    if (num === 1 && wire === 2) f.name = TEXT.decode(r.bytes(r.varint()));
    else if (num === 3 && wire === 0) f.number = r.varint();
    else if (num === 4 && wire === 0) label = r.varint();
    else if (num === 5 && wire === 0) f.type = r.varint();
    else if (num === 6 && wire === 2) f.typeName = TEXT.decode(r.bytes(r.varint()));
    else r.skip(wire);
  }
  f.repeated = label === 3;
  return f;
}

function readMessageDescriptor(r: Reader, scope: string, defs: Defs): void {
  let name = '';
  const fields: FieldDef[] = [];
  const nested: Uint8Array[] = [];
  let isMapEntry = false;
  while (!r.done) {
    const tag = r.varint();
    const num = tag >>> 3;
    const wire = tag & 7;
    if (num === 1 && wire === 2) name = TEXT.decode(r.bytes(r.varint()));
    else if (num === 2 && wire === 2) fields.push(readFieldDescriptor(new Reader(r.bytes(r.varint()))));
    else if (num === 3 && wire === 2) nested.push(r.bytes(r.varint()));
    else if (num === 7 && wire === 2) {
      // MessageOptions: map_entry = 7
      const o = new Reader(r.bytes(r.varint()));
      while (!o.done) {
        const t = o.varint();
        if (t >>> 3 === 7 && (t & 7) === 0) isMapEntry = o.varint() !== 0;
        else o.skip(t & 7);
      }
    } else r.skip(wire);
  }
  const fullName = `${scope}.${name}`;
  defs.set(fullName, {
    fullName,
    fields: new Map(fields.map((f) => [f.number, f])),
    isMapEntry,
  });
  for (const n of nested) readMessageDescriptor(new Reader(n), fullName, defs);
}

/** Every message type in a serialized FileDescriptorSet, keyed `.pkg.Outer.Inner`. */
export function parseDescriptorSet(bytes: Uint8Array): Defs {
  const defs: Defs = new Map();
  const set = new Reader(bytes);
  while (!set.done) {
    const tag = set.varint();
    if (tag >>> 3 !== 1 || (tag & 7) !== 2) {
      set.skip(tag & 7);
      continue;
    }
    const file = new Reader(set.bytes(set.varint()));
    let pkg = '';
    const messages: Uint8Array[] = [];
    while (!file.done) {
      const t = file.varint();
      const num = t >>> 3;
      const wire = t & 7;
      if (num === 2 && wire === 2) pkg = TEXT.decode(file.bytes(file.varint()));
      else if (num === 4 && wire === 2) messages.push(file.bytes(file.varint()));
      else file.skip(wire);
    }
    for (const m of messages) readMessageDescriptor(new Reader(m), pkg ? `.${pkg}` : '', defs);
  }
  return defs;
}

// --- Message decoding ----------------------------------------------------------

const PACKABLE = new Set<number>([
  T.DOUBLE, T.FLOAT, T.INT64, T.UINT64, T.INT32, T.FIXED64, T.FIXED32, T.BOOL,
  T.UINT32, T.ENUM, T.SFIXED32, T.SFIXED64, T.SINT32, T.SINT64,
]);

function scalarDefault(type: number): unknown {
  if (type === T.STRING) return '';
  if (type === T.BYTES) return new Uint8Array(0);
  if (type === T.BOOL) return false;
  if (type === T.MESSAGE || type === T.GROUP) return undefined;
  return 0;
}

function readScalar(r: Reader, type: number, wire: number): unknown {
  switch (type) {
    case T.DOUBLE: {
      const b = r.bytes(8);
      return new DataView(b.buffer, b.byteOffset, 8).getFloat64(0, true);
    }
    case T.FLOAT: {
      const b = r.bytes(4);
      return new DataView(b.buffer, b.byteOffset, 4).getFloat32(0, true);
    }
    case T.INT64: { const [lo, hi] = r.varintWords(); return signed64(lo, hi); }
    case T.UINT64: { const [lo, hi] = r.varintWords(); return unsigned64(lo, hi); }
    case T.INT32: { const [lo] = r.varintWords(); return lo | 0; }
    case T.UINT32: { const [lo] = r.varintWords(); return lo; }
    case T.ENUM: { const [lo] = r.varintWords(); return lo | 0; }
    case T.BOOL: { const [lo, hi] = r.varintWords(); return lo !== 0 || hi !== 0; }
    case T.SINT32: { const [lo] = r.varintWords(); return (lo >>> 1) ^ -(lo & 1); }
    case T.SINT64: { const [lo, hi] = r.varintWords(); return zigzag64(lo, hi); }
    case T.FIXED32: return r.fixed32Words();
    case T.SFIXED32: return r.fixed32Words() | 0;
    case T.FIXED64: { const [lo, hi] = r.fixed64Words(); return unsigned64(lo, hi); }
    case T.SFIXED64: { const [lo, hi] = r.fixed64Words(); return signed64(lo, hi); }
    case T.STRING: return TEXT.decode(r.bytes(r.varint()));
    case T.BYTES: return r.bytes(r.varint()).slice();
    default:
      throw new Error(`protobuf: unsupported field type ${type} (wire ${wire})`);
  }
}

function timeLike(msg: Record<string, unknown>): { sec: number; nsec: number } {
  const sec = msg['seconds'];
  const nsec = msg['nanos'];
  return {
    sec: typeof sec === 'bigint' ? Number(sec) : (sec as number) ?? 0,
    nsec: (nsec as number) ?? 0,
  };
}

function decodeMessage(r: Reader, def: MessageDef, defs: Defs, depth: number): Record<string, unknown> {
  if (depth > MAX_DEPTH) throw new Error('protobuf: messages nested too deeply');
  const out: Record<string, unknown> = {};
  for (const f of def.fields.values()) {
    if (f.repeated) out[f.name] = f.type === T.MESSAGE && defs.get(f.typeName)?.isMapEntry ? {} : [];
    else out[f.name] = scalarDefault(f.type);
  }
  while (!r.done) {
    const tag = r.varint();
    const num = tag >>> 3;
    const wire = tag & 7;
    const f = def.fields.get(num);
    if (!f) {
      r.skip(wire);
      continue;
    }
    if (f.type === T.GROUP) {
      r.skip(wire);
      continue;
    }
    if (f.type === T.MESSAGE) {
      if (wire !== 2) throw new Error(`protobuf: field ${f.name} has wire type ${wire}`);
      const sub = new Reader(r.bytes(r.varint()));
      const value = decodeNested(sub, f.typeName, defs, depth + 1);
      const target = defs.get(f.typeName);
      if (f.repeated && target?.isMapEntry) {
        const e = value as { key: unknown; value: unknown };
        (out[f.name] as Record<string, unknown>)[String(e.key)] = e.value;
      } else if (f.repeated) (out[f.name] as unknown[]).push(value);
      else out[f.name] = value;
      continue;
    }
    if (f.repeated && wire === 2 && PACKABLE.has(f.type)) {
      const sub = new Reader(r.bytes(r.varint()));
      const list = out[f.name] as unknown[];
      while (!sub.done) list.push(readScalar(sub, f.type, wire));
      continue;
    }
    const value = readScalar(r, f.type, wire);
    if (f.repeated) (out[f.name] as unknown[]).push(value);
    else out[f.name] = value;
  }
  return out;
}

function decodeNested(r: Reader, typeName: string, defs: Defs, depth: number): unknown {
  const def = defs.get(typeName);
  if (!def) {
    // A well-known type whose file was not shipped in the set, or a missing dependency.
    if (typeName === '.google.protobuf.Timestamp' || typeName === '.google.protobuf.Duration') {
      return timeLike(decodeMessage(r, WELL_KNOWN_TIME, defs, depth));
    }
    throw new Error(`protobuf: schema does not define ${typeName}`);
  }
  const msg = decodeMessage(r, def, defs, depth);
  if (typeName === '.google.protobuf.Timestamp' || typeName === '.google.protobuf.Duration') {
    return timeLike(msg);
  }
  return msg;
}

const WELL_KNOWN_TIME: MessageDef = {
  fullName: '.google.protobuf.Timestamp',
  isMapEntry: false,
  fields: new Map([
    [1, { name: 'seconds', number: 1, type: T.INT64, repeated: false, typeName: '' }],
    [2, { name: 'nanos', number: 2, type: T.INT32, repeated: false, typeName: '' }],
  ]),
};

export type ProtobufDecoder = (raw: Uint8Array) => Record<string, unknown>;

const decoderCache = new Map<string, ProtobufDecoder>();
const setCache = new WeakMap<Uint8Array, Defs>();

/**
 * Build a decoder for `messageName` (e.g. `foxglove.CompressedImage`) from a
 * serialized FileDescriptorSet. Descriptor parsing is cached per set so the
 * same schema is not re-read for every call.
 */
export function createProtobufDecoder(descriptorSet: Uint8Array, messageName: string): ProtobufDecoder {
  let defs = setCache.get(descriptorSet);
  if (!defs) {
    defs = parseDescriptorSet(descriptorSet);
    setCache.set(descriptorSet, defs);
  }
  const name = messageName.startsWith('.') ? messageName : `.${messageName}`;
  const def = defs.get(name);
  if (!def) throw new Error(`protobuf: schema does not define ${messageName}`);
  const all = defs;
  return (raw) => decodeMessage(new Reader(raw), def, all, 0);
}

/** Live bridges send the descriptor set base64-encoded; cache by that text. */
export function createProtobufDecoderFromBase64(schemaB64: string, messageName: string): ProtobufDecoder {
  // The channel's schema string is one instance, so V8 hashes it once.
  const key = `${messageName}\0${schemaB64}`;
  let dec = decoderCache.get(key);
  if (!dec) {
    const bin = atob(schemaB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    dec = createProtobufDecoder(bytes, messageName);
    decoderCache.set(key, dec);
  }
  return dec;
}

export function clearProtobufCache(): void {
  decoderCache.clear();
}
