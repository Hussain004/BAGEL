/**
 * Putting series from different topics on one x axis.
 *
 * uPlot wants a single shared x array with one value per series at every x.
 * Topics sample at different rates and times, so the shared axis is the union
 * of every series' timestamps, each column filled where it has a sample and
 * `null` elsewhere (drawn as a line across the gap when `spanGaps` is on).
 *
 * Pure and DOM-free so the alignment rules can be tested without a browser.
 */

/** Read a flattenNumeric-style path (`a.b[2].c`) straight off a message. */
export function readField(value: unknown, path: string): number | null {
  if (value == null || !path) return null;
  let cur: unknown = value;
  // Tokens are property names or array indices; this matches the keys
  // flattenNumeric emits, so every key it produces reads back the same value.
  for (const tok of path.match(/[^.[\]]+/g) ?? []) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[tok];
  }
  if (typeof cur === 'number') return Number.isFinite(cur) ? cur : null;
  if (typeof cur === 'bigint') return Number(cur);
  if (typeof cur === 'boolean') return cur ? 1 : 0;
  return null;
}

export interface TimedColumn {
  /** Seconds on the shared axis. Need not be sorted or unique. */
  times: ArrayLike<number>;
  values: ArrayLike<number | null>;
}

export interface AlignedColumns {
  /** Strictly increasing union of all finite input timestamps. */
  time: number[];
  /** One column per input, same length as `time`. */
  columns: Array<Array<number | null>>;
}

/**
 * Align columns on the union of their timestamps.
 *
 * Handles what real bags do: unsorted stamps (non-monotonic clocks), repeated
 * stamps (the later sample wins), non-finite stamps (dropped), empty inputs,
 * and inputs with different lengths between `times` and `values`.
 */
export function alignColumns(inputs: TimedColumn[]): AlignedColumns {
  const sorted = inputs.map((c) => {
    const n = Math.min(c.times.length, c.values.length);
    const idx: number[] = [];
    let ascending = true;
    let prev = -Infinity;
    for (let i = 0; i < n; i++) {
      const t = c.times[i]!;
      if (!Number.isFinite(t)) continue;
      if (t < prev) ascending = false;
      prev = t;
      idx.push(i);
    }
    // Array.prototype.sort is stable, so equal stamps keep input order and
    // the later sample overwrites the earlier one below.
    if (!ascending) idx.sort((a, b) => c.times[a]! - c.times[b]!);
    return { idx, c };
  });

  let total = 0;
  for (const s of sorted) total += s.idx.length;
  const all = new Float64Array(total);
  let at = 0;
  for (const s of sorted) for (const i of s.idx) all[at++] = s.c.times[i]!;
  all.sort();

  const time: number[] = [];
  for (let i = 0; i < all.length; i++) {
    if (i === 0 || all[i] !== all[i - 1]) time.push(all[i]!);
  }

  const columns = sorted.map(({ idx, c }) => {
    const col: Array<number | null> = new Array(time.length).fill(null);
    let j = 0;
    for (const i of idx) {
      const t = c.times[i]!;
      while (time[j]! < t) j++;
      col[j] = c.values[i] ?? null;
    }
    return col;
  });

  return { time, columns };
}

/**
 * Carry the last known value forward over nulls (zero-order hold).
 *
 * Cross-topic expressions need this: `odom_vx - cmd_vx` has no meaning at an
 * instant where only one of the two topics published, so each input is held at
 * its last sample. Values before a series' first sample stay null.
 */
export function holdForward(col: ReadonlyArray<number | null>): Array<number | null> {
  const out: Array<number | null> = new Array(col.length);
  let last: number | null = null;
  for (let i = 0; i < col.length; i++) {
    const v = col[i] ?? null;
    if (v !== null) last = v;
    out[i] = last;
  }
  return out;
}

/** Identifier-safe expression alias for a (topic, field), unique among `taken`. */
export function defaultAlias(topic: string, field: string, taken: ReadonlySet<string>): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  const leaf = clean(topic.split('/').filter(Boolean).pop() ?? topic) || 'topic';
  const tail = clean(field.split('.').pop() ?? field) || 'value';
  let base = `${leaf}_${tail}`;
  // Identifiers cannot start with a digit.
  if (/^[0-9]/.test(base)) base = `_${base}`;
  let alias = base;
  for (let n = 2; taken.has(alias); n++) alias = `${base}_${n}`;
  return alias;
}

/** Key identifying one (bag, topic) decode shared by every series that reads it. */
export const extraKey = (bagId: string, topic: string) => `${bagId}::${topic}`;

let seriesIdCounter = 0;
/** Unique id for a series added to a plot; unique within a session. */
export function newSeriesId(): string {
  seriesIdCounter += 1;
  return `extra_${Date.now().toString(36)}_${seriesIdCounter}`;
}
