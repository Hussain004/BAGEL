/**
 * PX4 ULog (`.ulg`) parser.
 *
 * ULog is the flight log format of PX4 (and, via converters, ArduPilot): a
 * header, a definitions section (message formats, info and parameters), then a
 * stream of data messages for each subscribed topic, logged text, parameter
 * changes and dropout markers. See https://docs.px4.io/main/en/dev_log/ulog_file_format.html
 *
 * The whole file is read into memory once and indexed; messages are decoded on
 * demand from byte offsets, so a topic costs nothing until it is opened.
 *
 * Mapping to what the rest of BAGEL knows:
 *   - each (message name, instance) is a topic: `/vehicle_attitude`, and
 *     `/sensor_gyro_1` for the second instance. Types are `px4/<name>`.
 *   - GPS-position topics are given a `NavSatFix` shape (alongside their own
 *     fields) so the trajectory view with map tiles works unchanged.
 *   - logged text is `/rosout` (a `rcl_interfaces/msg/Log`), so the Log panel works.
 *   - parameters are `/parameters` (the values at start) and `/parameter_changes`.
 *   - dropout markers are `/ulog_dropouts`.
 *
 * Logs from crashes are the most interesting ones and are usually cut off
 * mid-message, so a truncated tail ends the parse quietly, and a damaged stretch
 * is skipped by resynchronising on the next sync message.
 */

import type { AllTopicStats, BagSummary, TopicInfo } from '../types/bag';
import { sourceKey, sourceReadAll, type SingleBagSource } from './source';
import { RangePicker, type RangeParams, type RangeResult } from './range';

export const ULOG_MAGIC = [0x55, 0x4c, 0x6f, 0x67, 0x01, 0x12, 0x35];

type Obj = Record<string, unknown>;
type Decoded = { timestamp: bigint; value: Obj | null };

// ── Formats ───────────────────────────────────────────────────────────────

interface Field {
  /** Primitive name (`float`) or the name of another format. */
  type: string;
  name: string;
  /** Element count for an array field, or null for a single value. */
  count: number | null;
}

interface Format {
  name: string;
  fields: Field[];
  /** Size of one packed message in bytes; -1 until computed, -2 if it cannot be (unknown type, cycle). */
  size: number;
}

const PRIMITIVE_SIZE: Record<string, number> = {
  int8_t: 1,
  uint8_t: 1,
  int16_t: 2,
  uint16_t: 2,
  int32_t: 4,
  uint32_t: 4,
  int64_t: 8,
  uint64_t: 8,
  float: 4,
  double: 8,
  bool: 1,
  char: 1,
};

function parseFormat(text: string): Format | null {
  const colon = text.indexOf(':');
  if (colon < 1) return null;
  const name = text.slice(0, colon);
  const fields: Field[] = [];
  for (const part of text.slice(colon + 1).split(';')) {
    if (!part) continue;
    const space = part.indexOf(' ');
    if (space < 1) return null;
    const rawType = part.slice(0, space);
    const fieldName = part.slice(space + 1);
    const bracket = rawType.indexOf('[');
    if (bracket < 0) {
      fields.push({ type: rawType, name: fieldName, count: null });
    } else {
      const count = Number(rawType.slice(bracket + 1, rawType.indexOf(']')));
      if (!Number.isInteger(count) || count < 1) return null;
      fields.push({ type: rawType.slice(0, bracket), name: fieldName, count });
    }
  }
  return fields.length > 0 ? { name, fields, size: -1 } : null;
}

function formatSize(format: Format, formats: Map<string, Format>, stack: string[] = []): number {
  if (format.size !== -1) return format.size;
  if (stack.includes(format.name)) return (format.size = -2);
  let total = 0;
  for (const f of format.fields) {
    const unit = PRIMITIVE_SIZE[f.type];
    let each: number;
    if (unit !== undefined) each = unit;
    else {
      const nested = formats.get(f.type);
      each = nested ? formatSize(nested, formats, [...stack, format.name]) : -2;
    }
    if (each < 0) return (format.size = -2);
    total += each * (f.count ?? 1);
  }
  return (format.size = total);
}

// ── Decoding one message ──────────────────────────────────────────────────

function readPrimitive(view: DataView, at: number, type: string): number | boolean {
  switch (type) {
    case 'int8_t': return view.getInt8(at);
    case 'uint8_t': return view.getUint8(at);
    case 'int16_t': return view.getInt16(at, true);
    case 'uint16_t': return view.getUint16(at, true);
    case 'int32_t': return view.getInt32(at, true);
    case 'uint32_t': return view.getUint32(at, true);
    // 64-bit integers become numbers: exact up to 2^53, which covers microsecond
    // timestamps for 285 years. Larger values lose their low bits.
    case 'int64_t': return Number(view.getBigInt64(at, true));
    case 'uint64_t': return Number(view.getBigUint64(at, true));
    case 'float': return view.getFloat32(at, true);
    case 'double': return view.getFloat64(at, true);
    case 'bool': return view.getUint8(at) !== 0;
    default: return view.getUint8(at);
  }
}

function decodeFormat(format: Format, formats: Map<string, Format>, view: DataView, base: number): { value: Obj; end: number } {
  const out: Obj = {};
  let at = base;
  for (const f of format.fields) {
    const unit = PRIMITIVE_SIZE[f.type];
    const skip = f.name.startsWith('_padding');
    if (unit !== undefined) {
      if (f.type === 'char' && f.count !== null) {
        if (!skip) {
          const bytes = new Uint8Array(view.buffer, view.byteOffset + at, f.count);
          const nul = bytes.indexOf(0);
          out[f.name] = new TextDecoder().decode(nul < 0 ? bytes : bytes.subarray(0, nul));
        }
        at += f.count;
      } else if (f.count === null) {
        if (!skip) out[f.name] = readPrimitive(view, at, f.type);
        at += unit;
      } else {
        if (!skip) {
          const arr = new Array<number | boolean>(f.count);
          for (let i = 0; i < f.count; i++) arr[i] = readPrimitive(view, at + i * unit, f.type);
          out[f.name] = arr;
        }
        at += unit * f.count;
      }
    } else {
      const nested = formats.get(f.type)!;
      const n = f.count ?? 1;
      const items: Obj[] = [];
      for (let i = 0; i < n; i++) {
        const r = decodeFormat(nested, formats, view, at);
        items.push(r.value);
        at = r.end;
      }
      if (!skip) out[f.name] = f.count === null ? items[0] : items;
    }
  }
  return { value: out, end: at };
}

// ── The parsed file ───────────────────────────────────────────────────────

/** A growable list of numbers backed by typed arrays, so a log with millions of messages stays compact. */
class Series {
  times = new Float64Array(256); // microseconds
  offsets = new Uint32Array(256); // where the message's data starts in the file
  count = 0;
  push(timeUs: number, offset: number): void {
    if (this.count === this.times.length) {
      const t = new Float64Array(this.count * 2);
      t.set(this.times);
      this.times = t;
      const o = new Uint32Array(this.count * 2);
      o.set(this.offsets);
      this.offsets = o;
    }
    this.times[this.count] = timeUs;
    this.offsets[this.count] = offset;
    this.count++;
  }
}

interface Topic {
  name: string;
  type: string;
  /** Message format, or null for the synthetic topics built from text. */
  format: Format | null;
  series: Series;
  /** Synthetic topics keep their messages directly. */
  synthetic: Decoded[] | null;
  bytes: number;
}

interface Parsed {
  bytes: Uint8Array;
  view: DataView;
  formats: Map<string, Format>;
  topics: Map<string, Topic>;
  summary: BagSummary;
  warnings: string[];
}

const cache = new Map<string, Parsed>();

const GPS_TOPICS = new Set(['vehicle_global_position', 'vehicle_gps_position', 'sensor_gps']);

function topicName(name: string, multiId: number): string {
  return multiId === 0 ? `/${name}` : `/${name}_${multiId}`;
}

const MSG_TYPES = new Set('BFIMPQARDLCSO'.split('').map((c) => c.charCodeAt(0)));
const SYNC = [0x2f, 0x73, 0x13, 0x20, 0x25, 0x0c, 0xbb, 0x12];

function findSync(bytes: Uint8Array, from: number): number {
  outer: for (let i = Math.max(from, 3); i + SYNC.length <= bytes.length; i++) {
    for (let k = 0; k < SYNC.length; k++) if (bytes[i + k] !== SYNC[k]) continue outer;
    return i - 3; // the sync message's own 3-byte header sits just before its magic
  }
  return -1;
}

function textOf(bytes: Uint8Array, start: number, end: number): string {
  return new TextDecoder().decode(bytes.subarray(start, end));
}

/** A key like `float PARAM`, `int32_t PARAM`, `char[10] sys_name`, and its value bytes as a JS value. */
function keyedValue(view: DataView, bytes: Uint8Array, at: number, keyLen: number, end: number): { name: string; value: unknown } | null {
  const key = textOf(bytes, at, at + keyLen);
  const space = key.indexOf(' ');
  if (space < 1) return null;
  const rawType = key.slice(0, space);
  const name = key.slice(space + 1);
  const valueAt = at + keyLen;
  const bracket = rawType.indexOf('[');
  const type = bracket < 0 ? rawType : rawType.slice(0, bracket);
  const count = bracket < 0 ? null : Number(rawType.slice(bracket + 1, rawType.indexOf(']')));
  const unit = PRIMITIVE_SIZE[type];
  if (unit === undefined) return null;
  if (type === 'char' && count !== null) {
    const raw = bytes.subarray(valueAt, Math.min(end, valueAt + count));
    const nul = raw.indexOf(0);
    return { name, value: new TextDecoder().decode(nul < 0 ? raw : raw.subarray(0, nul)) };
  }
  const n = count ?? 1;
  if (valueAt + unit * n > end) return null;
  if (count === null) return { name, value: readPrimitive(view, valueAt, type) };
  return { name, value: Array.from({ length: n }, (_, i) => readPrimitive(view, valueAt + i * unit, type)) };
}

const ROS_LEVEL = [50, 50, 50, 40, 30, 20, 20, 10]; // ULog 0..7 (emergency..debug) to ROS 2 log levels

function header(timeUs: number, frame = ''): Obj {
  const sec = Math.floor(timeUs / 1e6);
  return { stamp: { sec, nanosec: Math.round((timeUs - sec * 1e6) * 1000) }, frame_id: frame };
}

async function load(source: SingleBagSource): Promise<Parsed> {
  const key = sourceKey(source);
  const hit = cache.get(key);
  if (hit) return hit;

  const bytes = await sourceReadAll(source);
  if (bytes.length < 16 || !ULOG_MAGIC.every((b, i) => bytes[i] === b)) {
    throw new Error('Not a ULog file: the header is missing or damaged.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerTimeUs = Number(view.getBigUint64(8, true));
  const fileName = source.kind === 'file' ? source.file.name : source.displayName;

  const formats = new Map<string, Format>();
  const subs = new Map<number, { topic: Topic }>();
  const topics = new Map<string, Topic>();
  const warnings: string[] = [];
  const info: Obj = {};
  const params: Obj = {};
  const paramChanges: Decoded[] = [];
  const dropouts: Decoded[] = [];
  const logs: Decoded[] = [];
  let lastTimeUs = headerTimeUs;
  /** False while reading the definitions section, which ends at the first data-section message. */
  let inData = false;
  let minUs = Infinity;
  let maxUs = -Infinity;
  const see = (t: number) => {
    if (t < minUs) minUs = t;
    if (t > maxUs) maxUs = t;
  };

  const synthetic = (name: string, type: string, list: Decoded[]): Topic => {
    const t: Topic = { name, type, format: null, series: new Series(), synthetic: list, bytes: 0 };
    return t;
  };

  let pos = 16;
  while (pos + 3 <= bytes.length) {
    const size = view.getUint16(pos, true);
    const type = bytes[pos + 2]!;
    const body = pos + 3;
    const end = body + size;
    if (!MSG_TYPES.has(type) || end > bytes.length) {
      // Damage (or a message cut off at the end of the file): jump to the next sync marker.
      // With none left this is the end of the log, which is how a crash usually ends it.
      const next = findSync(bytes, pos + 4); // a sync message starting after `pos` has its magic at pos + 4 or later
      if (next < 0) break;
      warnings.push(`skipped ${next - pos} damaged bytes at ${pos}`);
      pos = next;
      continue;
    }

    const kind = String.fromCharCode(type);
    if (kind === 'A' || kind === 'R' || kind === 'D' || kind === 'L' || kind === 'C' || kind === 'O') inData = true;
    switch (kind) {
      case 'B': {
        if (size >= 16) {
          // incompat_flags[8] follows compat_flags[8]; bit 0 is DATA_APPENDED, the only one defined.
          const incompat = bytes.subarray(body + 8, body + 16);
          if ((incompat[0]! & ~1) !== 0 || incompat.slice(1).some((b) => b !== 0)) {
            throw new Error('This ULog uses features this version of BAGEL cannot read.');
          }
        }
        break;
      }
      case 'F': {
        const f = parseFormat(textOf(bytes, body, end));
        if (f) formats.set(f.name, f);
        break;
      }
      case 'I': {
        const keyLen = bytes[body]!;
        const kv = keyedValue(view, bytes, body + 1, keyLen, end);
        if (kv) info[kv.name] = kv.value;
        break;
      }
      case 'M': {
        // [is_continued u8][key_len u8][key][value]: a value that can repeat, so each key holds a list.
        const keyLen = bytes[body + 1]!;
        const kv = keyedValue(view, bytes, body + 2, keyLen, end);
        if (kv) {
          const prev = info[kv.name];
          info[kv.name] = Array.isArray(prev) && typeof kv.value === 'string' ? [...prev, kv.value] : typeof kv.value === 'string' ? [kv.value] : kv.value;
        }
        break;
      }
      case 'P': {
        const keyLen = bytes[body]!;
        const kv = keyedValue(view, bytes, body + 1, keyLen, end);
        if (kv) {
          // In the definitions these are the starting values; later ones are changes at that moment.
          if (!inData) params[kv.name] = kv.value;
          else paramChanges.push({ timestamp: BigInt(Math.round(lastTimeUs)) * 1000n, value: { name: kv.name, value: kv.value } });
        }
        break;
      }
      case 'Q':
        break; // default values for parameters: not shown
      case 'A': {
        const multiId = bytes[body]!;
        const msgId = view.getUint16(body + 1, true);
        const name = textOf(bytes, body + 3, end);
        const format = formats.get(name);
        if (!format || formatSize(format, formats) < 0) {
          warnings.push(`no usable format for "${name}"`);
          break;
        }
        const tn = topicName(name, multiId);
        let topic = topics.get(tn);
        if (!topic) {
          topic = {
            name: tn,
            type: GPS_TOPICS.has(name) ? 'sensor_msgs/msg/NavSatFix' : `px4/${name}`,
            format,
            series: new Series(),
            synthetic: null,
            bytes: 0,
          };
          topics.set(tn, topic);
        }
        subs.set(msgId, { topic });
        break;
      }
      case 'R':
        subs.delete(view.getUint16(body, true));
        break;
      case 'D': {
        const sub = subs.get(view.getUint16(body, true));
        if (sub && sub.topic.format) {
          const data = body + 2;
          const need = formatSize(sub.topic.format, formats);
          const first = sub.topic.format.fields[0];
          // Every message starts with its own `timestamp` (microseconds); one without it cannot be placed in time.
          if (first?.name === 'timestamp' && first.type === 'uint64_t' && end - data >= need) {
            const t = Number(view.getBigUint64(data, true));
            sub.topic.series.push(t, data);
            sub.topic.bytes += size;
            lastTimeUs = t;
            see(t);
          }
        }
        break;
      }
      case 'L':
      case 'C': {
        const tagged = type === 'C'.charCodeAt(0);
        const level = bytes[body]!;
        const tag = tagged ? view.getUint16(body + 1, true) : 0;
        const tAt = body + (tagged ? 3 : 1);
        const t = Number(view.getBigUint64(tAt, true));
        const text = textOf(bytes, tAt + 8, end);
        logs.push({
          timestamp: BigInt(Math.round(t)) * 1000n,
          value: { stamp: header(t).stamp, level: ROS_LEVEL[level] ?? 20, name: tagged ? `tag ${tag}` : 'px4', msg: text, file: '', function: '', line: 0 },
        });
        see(t);
        break;
      }
      case 'O':
        dropouts.push({ timestamp: BigInt(Math.round(lastTimeUs)) * 1000n, value: { duration_ms: view.getUint16(body, true) } });
        break;
      default:
        break; // 'S' sync: nothing to keep
    }
    pos = end;
  }

  const startUs = Number.isFinite(minUs) ? minUs : headerTimeUs;
  const endUs = Number.isFinite(maxUs) ? maxUs : startUs;
  const at0 = BigInt(Math.round(startUs)) * 1000n;

  const extras: Topic[] = [];
  if (logs.length > 0) extras.push(synthetic('/rosout', 'rcl_interfaces/msg/Log', logs));
  if (Object.keys(params).length > 0) extras.push(synthetic('/parameters', 'px4/Parameters', [{ timestamp: at0, value: { params } }]));
  if (paramChanges.length > 0) extras.push(synthetic('/parameter_changes', 'px4/ParameterChange', paramChanges));
  if (dropouts.length > 0) extras.push(synthetic('/ulog_dropouts', 'px4/Dropout', dropouts));
  if (Object.keys(info).length > 0) extras.push(synthetic('/info', 'px4/LogInfo', [{ timestamp: at0, value: { info } }]));
  for (const t of extras) topics.set(t.name, t);

  const durationSec = Math.max(0, (endUs - startUs) / 1e6);
  const topicInfos: TopicInfo[] = [];
  let total = 0;
  for (const t of [...topics.values()].filter((x) => (x.synthetic ? x.synthetic.length : x.series.count) > 0).sort((a, b) => a.name.localeCompare(b.name))) {
    const count = t.synthetic ? t.synthetic.length : t.series.count;
    total += count;
    const first = t.synthetic ? Number(t.synthetic[0]!.timestamp) / 1000 : t.series.times[0]!;
    const last = t.synthetic ? Number(t.synthetic[count - 1]!.timestamp) / 1000 : t.series.times[count - 1]!;
    topicInfos.push({
      name: t.name,
      type: t.type,
      messageCount: count,
      serializationFormat: 'ulog',
      frequency: count > 1 && last > first ? (count - 1) / ((last - first) / 1e6) : undefined,
    });
  }
  // A topic with nothing in it is not a topic.
  for (const [name, t] of [...topics]) if ((t.synthetic ? t.synthetic.length : t.series.count) === 0) topics.delete(name);

  const parsed: Parsed = {
    bytes,
    view,
    formats,
    topics,
    warnings,
    summary: {
      format: 'ulog',
      fileName,
      fileSize: bytes.length,
      startTime: at0,
      endTime: BigInt(Math.round(endUs)) * 1000n,
      duration: durationSec,
      totalMessageCount: total,
      topics: topicInfos,
    },
  };
  cache.set(key, parsed);
  return parsed;
}

// ── Reading ───────────────────────────────────────────────────────────────

/** Give GPS topics a NavSatFix shape on top of their own fields. */
function asNavSatFix(raw: Obj, timeUs: number, fields: Format): Obj {
  const latField = fields.fields.find((f) => f.name === 'lat');
  const scaled = latField?.type === 'int32_t'; // sensor_gps stores 1e-7 degrees and millimetres
  const lat = Number(raw.lat ?? 0);
  const lon = Number(raw.lon ?? 0);
  const alt = Number(raw.alt ?? 0);
  const fix = Number(raw.fix_type ?? 3);
  return {
    ...raw,
    header: header(timeUs, 'gps'),
    status: { status: fix >= 3 ? 0 : -1, service: 1 },
    latitude: scaled ? lat * 1e-7 : lat,
    longitude: scaled ? lon * 1e-7 : lon,
    altitude: scaled ? alt * 1e-3 : alt,
    position_covariance: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    position_covariance_type: 0,
  };
}

function decodeAt(p: Parsed, topic: Topic, i: number): Decoded {
  if (topic.synthetic) return topic.synthetic[i]!;
  const t = topic.series.times[i]!;
  const { value } = decodeFormat(topic.format!, p.formats, p.view, topic.series.offsets[i]!);
  return { timestamp: BigInt(Math.round(t)) * 1000n, value: GPS_TOPICS.has(topic.format!.name) ? asNavSatFix(value, t, topic.format!) : value };
}

function countOf(topic: Topic): number {
  return topic.synthetic ? topic.synthetic.length : topic.series.count;
}

function timeNsAt(topic: Topic, i: number): bigint {
  return topic.synthetic ? topic.synthetic[i]!.timestamp : BigInt(Math.round(topic.series.times[i]!)) * 1000n;
}

export async function parseUlog(source: SingleBagSource): Promise<BagSummary> {
  return (await load(source)).summary;
}

export async function readDeserializedMessagesUlog(
  source: SingleBagSource,
  topicName: string,
  limit?: number,
  onProgress?: (decoded: number) => void,
  onBatch?: (batch: Decoded[]) => void,
): Promise<Decoded[]> {
  const p = await load(source);
  const topic = p.topics.get(topicName);
  if (!topic) return [];
  const n = limit ? Math.min(limit, countOf(topic)) : countOf(topic);
  const out: Decoded[] = [];
  let flushed = 0;
  for (let i = 0; i < n; i++) {
    out.push(decodeAt(p, topic, i));
    if (out.length % 2000 === 0) {
      onProgress?.(out.length);
      if (onBatch) {
        onBatch(out.slice(flushed));
        flushed = out.length;
      }
      // Hand the event loop back so progress messages reach the page.
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(out.length);
  if (onBatch && out.length > flushed) onBatch(out.slice(flushed));
  return out;
}

/** Index of the first message at or after `timeNs`, or `count` when there is none. */
function lowerBound(topic: Topic, timeNs: bigint): number {
  let lo = 0;
  let hi = countOf(topic);
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeNsAt(topic, mid) < timeNs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The message at or after `timeNs`; failing that, the last one before it. */
export async function readMessageAtTimeUlog(source: SingleBagSource, topicName: string, timeNs: bigint): Promise<Decoded | null> {
  const p = await load(source);
  const topic = p.topics.get(topicName);
  if (!topic || countOf(topic) === 0) return null;
  const i = lowerBound(topic, timeNs);
  return decodeAt(p, topic, i < countOf(topic) ? i : countOf(topic) - 1);
}

export async function readRangeUlog(source: SingleBagSource, topicName: string, params: RangeParams): Promise<RangeResult> {
  const p = await load(source);
  const topic = p.topics.get(topicName);
  if (!topic) return { messages: [], nextStartNs: null, phase: 0 };
  const picker = new RangePicker(params);
  const out: Decoded[] = [];
  for (let i = lowerBound(topic, picker.params.startNs); i < countOf(topic); i++) {
    const t = timeNsAt(topic, i);
    if (t > picker.params.endNs) break;
    if (picker.offer(t)) out.push(decodeAt(p, topic, i));
    if (picker.done) break;
  }
  return picker.finish(out);
}

export async function getTopicTypeUlog(source: SingleBagSource, topicName: string): Promise<string | undefined> {
  return (await load(source)).topics.get(topicName)?.type;
}

export async function readAllMessageStatsUlog(source: SingleBagSource): Promise<AllTopicStats> {
  const p = await load(source);
  const start = Number(p.summary.startTime);
  const out: AllTopicStats = {};
  for (const topic of p.topics.values()) {
    const n = countOf(topic);
    const times = new Float64Array(n);
    const sizes = new Uint32Array(n);
    const each = topic.synthetic ? 0 : n > 0 ? Math.round(topic.bytes / n) : 0;
    for (let i = 0; i < n; i++) {
      times[i] = Number(timeNsAt(topic, i)) - start;
      sizes[i] = each;
    }
    out[topic.name] = { times, sizes };
  }
  return out;
}

/** Why parts of the file were skipped, for tests and diagnostics. */
export async function ulogWarnings(source: SingleBagSource): Promise<string[]> {
  return (await load(source)).warnings;
}

export function disposeUlogCache(): void {
  cache.clear();
}
