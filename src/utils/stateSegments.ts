/**
 * State timelines: a message stream's scalar fields as runs of constant value.
 *
 * A robot is a state machine (nav goal status, control mode, an e-stop bool, a
 * behaviour-tree node name), and plotting those as numbers is useless: a string
 * has no line. The right view is a lane of coloured segments with the value
 * written on each, which is what this module feeds.
 *
 * Pure and DOM-free so the run-length and field-discovery rules can be tested
 * without a browser.
 */

export type Scalar = string | number | boolean;

export interface Segment {
  /** Start and end on the caller's time axis (seconds). */
  start: number;
  end: number;
  /** The value held across the segment; null where messages lack the field. */
  value: Scalar | null;
  /** How many consecutive messages carried this value. */
  count: number;
}

/** Message types whose payload is one scalar `data` field a state lane suits. */
export function isStateScalarType(type: string): boolean {
  return /^std_msgs\/(msg\/)?(Bool|String|Char|Byte|U?Int(8|16|32|64))$/.test(type);
}

/** Cap so a message with a huge array of structs cannot flood the field list. */
const MAX_FIELDS = 64;
const MAX_DEPTH = 8;

/**
 * Dot-paths of every scalar leaf (string, boolean, number, bigint) in a message,
 * skipping arrays, which have no single value per message.
 */
export function scalarFieldPaths(value: unknown, prefix = '', out: string[] = [], depth = 0): string[] {
  if (out.length >= MAX_FIELDS || depth > MAX_DEPTH || value == null) return out;
  const t = typeof value;
  if (t === 'string' || t === 'boolean' || t === 'number' || t === 'bigint') {
    if (prefix) out.push(prefix);
    return out;
  }
  if (t !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    scalarFieldPaths(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/** Read a dot-path from a message as a scalar, or null if it is absent or not a scalar. */
export function readScalar(value: unknown, path: string): Scalar | null {
  let cur: unknown = value;
  for (const tok of path.match(/[^.[\]]+/g) ?? []) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[tok];
  }
  if (typeof cur === 'string' || typeof cur === 'boolean') return cur;
  if (typeof cur === 'number') return Number.isFinite(cur) ? cur : null;
  if (typeof cur === 'bigint') return Number(cur);
  return null;
}

/**
 * Run-length encode a stream. Each segment runs from its first message to the
 * next message with a DIFFERENT value (or `endTime` for the last), so segment
 * boundaries are the instants the state changed and the segments tile the axis
 * with no gaps.
 *
 * Times need not be sorted (non-monotonic clocks occur); they are ordered first.
 * Equality is by value and type, so `1` and `"1"` are different states.
 */
export function buildSegments(
  times: ArrayLike<number>,
  values: ArrayLike<Scalar | null>,
  endTime: number,
): Segment[] {
  const n = Math.min(times.length, values.length);
  const order: number[] = [];
  let sorted = true;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(times[i]!)) continue;
    if (order.length > 0 && times[i]! < times[order[order.length - 1]!]!) sorted = false;
    order.push(i);
  }
  if (!sorted) order.sort((a, b) => times[a]! - times[b]!);

  const out: Segment[] = [];
  for (const i of order) {
    const t = times[i]!;
    const v = values[i] ?? null;
    const last = out[out.length - 1];
    if (last && last.value === v) {
      last.count += 1;
      continue;
    }
    if (last) last.end = t;
    out.push({ start: t, end: t, value: v, count: 1 });
  }
  const tail = out[out.length - 1];
  if (tail) tail.end = Math.max(endTime, tail.start);
  return out;
}

/** Number of state changes in a lane (segments minus one). */
export function transitionCount(segments: readonly Segment[]): number {
  return Math.max(0, segments.length - 1);
}

/** Index of the segment containing time `t`, or -1 before the first / after the last. */
export function segmentIndexAt(segments: readonly Segment[], t: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segments[mid]!;
    if (t < s.start) hi = mid - 1;
    else if (t > s.end || (t === s.end && mid < segments.length - 1)) lo = mid + 1;
    else return mid;
  }
  return -1;
}

const PALETTE = ['#3b82f6', '#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f43f5e', '#14b8a6', '#a855f7', '#eab308'];

/** Colour for a state value. Booleans get fixed on/off colours; anything else hashes. */
export function stateColor(value: Scalar | null): string {
  if (value === null) return '#64748b';
  if (value === true) return '#10b981';
  if (value === false) return '#64748b';
  const key = String(value);
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return PALETTE[(h >>> 0) % PALETTE.length]!;
}

/** Text written on a segment. */
export function stateLabel(value: Scalar | null): string {
  if (value === null) return '-';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

/** Fields worth showing by default: not `header.*`, and few enough to read. */
export function defaultStateFields(paths: readonly string[]): string[] {
  const body = paths.filter((p) => !p.startsWith('header.'));
  const pool = body.length > 0 ? body : [...paths];
  if (pool.length <= 3) return pool;
  const named = pool.find((p) => /(^|\.)(data|status|state|mode|phase|id)$/.test(p));
  return [named ?? pool[0]!];
}
