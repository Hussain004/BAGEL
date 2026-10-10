/**
 * Builds ULog files byte by byte, following the PX4 file format spec, so the
 * parser is tested against shapes a real flight stack produces and ones it
 * only sometimes does: several instances of a topic, nested formats, subscribe
 * and unsubscribe mid-log, parameters changing in flight, dropouts, tagged
 * logs, appended data and a log cut off mid-message.
 */

const enc = new TextEncoder();
const SYNC = [0x2f, 0x73, 0x13, 0x20, 0x25, 0x0c, 0xbb, 0x12];

export function msg(type: string, body: Uint8Array | number[]): Uint8Array {
  const b = body instanceof Uint8Array ? body : Uint8Array.from(body);
  const out = new Uint8Array(3 + b.length);
  new DataView(out.buffer).setUint16(0, b.length, true);
  out[2] = type.charCodeAt(0);
  out.set(b, 3);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  return concatAll(parts);
}

/** Like `concat`, for lists too long to spread into arguments. */
export function concatAll(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function u64(v: number | bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
  return b;
}
const u16 = (v: number) => Uint8Array.from([v & 255, v >> 8]);

export const header = (startUs = 0, version = 1): Uint8Array =>
  concat(Uint8Array.from([0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35, version]), u64(startUs));

export const flagBits = (incompat = 0): Uint8Array => msg('B', concat(new Uint8Array(8), Uint8Array.from([incompat, 0, 0, 0, 0, 0, 0, 0]), new Uint8Array(0)));
/** Flag bits message with 40 reserved bytes of appended-data offsets, as PX4 writes it. */
export const flagBitsFull = (incompat = 0): Uint8Array => msg('B', concat(new Uint8Array(8), Uint8Array.from([incompat, 0, 0, 0, 0, 0, 0, 0]), new Uint8Array(24)));

export const format = (text: string): Uint8Array => msg('F', enc.encode(text));
export const sync = (): Uint8Array => msg('S', SYNC);
export const dropout = (ms: number): Uint8Array => msg('O', u16(ms));
export const addLogged = (multiId: number, msgId: number, name: string): Uint8Array => msg('A', concat(Uint8Array.from([multiId]), u16(msgId), enc.encode(name)));
export const removeLogged = (msgId: number): Uint8Array => msg('R', u16(msgId));
export const logText = (level: number, timeUs: number, text: string): Uint8Array => msg('L', concat(Uint8Array.from([level]), u64(timeUs), enc.encode(text)));
export const taggedLog = (level: number, tag: number, timeUs: number, text: string): Uint8Array => msg('C', concat(Uint8Array.from([level]), u16(tag), u64(timeUs), enc.encode(text)));

function keyed(key: string, value: Uint8Array): Uint8Array {
  return concat(Uint8Array.from([key.length]), enc.encode(key), value);
}
const f32 = (v: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  return b;
};
const i32 = (v: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, v, true);
  return b;
};
export const infoString = (name: string, value: string): Uint8Array => msg('I', keyed(`char[${value.length}] ${name}`, enc.encode(value)));
export const infoU32 = (name: string, value: number): Uint8Array => msg('I', keyed(`uint32_t ${name}`, i32(value)));
export const infoMulti = (name: string, value: string, continued = 0): Uint8Array => msg('M', concat(Uint8Array.from([continued]), keyed(`char[${value.length}] ${name}`, enc.encode(value))));
export const paramF = (name: string, value: number): Uint8Array => msg('P', keyed(`float ${name}`, f32(value)));
export const paramI = (name: string, value: number): Uint8Array => msg('P', keyed(`int32_t ${name}`, i32(value)));

/** A data message: subscription id then the packed fields. */
export function data(msgId: number, fields: Uint8Array): Uint8Array {
  return msg('D', concat(u16(msgId), fields));
}

export const pack = {
  u64,
  u8: (v: number) => Uint8Array.from([v]),
  u16,
  i16: (v: number) => {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setInt16(0, v, true);
    return b;
  },
  i32,
  u32: (v: number) => {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    return b;
  },
  f32,
  f64: (v: number) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, true);
    return b;
  },
  bool: (v: boolean) => Uint8Array.from([v ? 1 : 0]),
  str: (s: string, n: number) => {
    const b = new Uint8Array(n);
    b.set(enc.encode(s).subarray(0, n));
    return b;
  },
};

export const SYNC_BYTES = Uint8Array.from(SYNC);

/** The definitions every test log starts with. */
export const ATTITUDE_FORMAT = 'vehicle_attitude:uint64_t timestamp;float[4] q;float rollspeed;uint8_t[3] _padding0;';
export const attitude = (t: number, q: [number, number, number, number], roll = 0): Uint8Array =>
  concat(pack.u64(t), ...q.map(pack.f32), pack.f32(roll), new Uint8Array(3));

/** `sensor_gps` as PX4 writes it: lat/lon in 1e-7 degrees, alt in millimetres. */
export const GPS_FORMAT = 'sensor_gps:uint64_t timestamp;int32_t lat;int32_t lon;int32_t alt;uint8_t fix_type;uint8_t[3] _padding0;';
export const gps = (t: number, latDeg: number, lonDeg: number, altM: number, fix = 3): Uint8Array =>
  concat(pack.u64(t), pack.i32(Math.round(latDeg * 1e7)), pack.i32(Math.round(lonDeg * 1e7)), pack.i32(Math.round(altM * 1000)), pack.u8(fix), new Uint8Array(3));
