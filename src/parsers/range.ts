/**
 * Reading a time range of one topic in bounded batches.
 *
 * Exporting frames must not pull a whole image topic into memory, nor ship
 * gigabytes through one postMessage. A caller asks for at most `max` messages
 * between `startNs` and `endNs`, taking every `stride`-th, and gets back where
 * to resume (`nextStartNs`) and how far into the stride it stopped (`phase`),
 * so repeated calls see exactly the messages one long call would have.
 *
 * Two limits, both fine for sensor topics: a batch that fills exactly costs one
 * extra empty call to learn the range is over, and two messages of one topic
 * with the very same timestamp may not be split across a batch boundary (one big
 * call keeps both).
 */

export interface RangeParams {
  /** First time to include, in the bag's own clock (nanoseconds). */
  startNs: bigint;
  /** Last time to include. */
  endNs: bigint;
  /** Take every Nth message (1 takes all). */
  stride: number;
  /** How many messages into the stride the previous batch stopped: 0 on the first call. */
  phase: number;
  /** Most messages to return in this batch. */
  max: number;
}

export interface RangeResult {
  messages: { timestamp: bigint; value: Record<string, unknown> | null }[];
  /** Where to start the next call, or null when the range is finished. */
  nextStartNs: bigint | null;
  /** Pass back as `phase` with `nextStartNs`. */
  phase: number;
}

/** Make a caller's numbers safe: whole, positive, and no larger than they can usefully be. */
export function normalizeRange(p: RangeParams): RangeParams {
  const whole = (n: number, fallback: number) => (Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback);
  return {
    startNs: p.startNs,
    endNs: p.endNs,
    stride: whole(p.stride, 1),
    phase: Number.isFinite(p.phase) && p.phase >= 0 ? Math.floor(p.phase) % whole(p.stride, 1) : 0,
    max: whole(p.max, 1),
  };
}

/**
 * Stateful picker both the format readers and the fallback share, so the
 * stride and the batch boundary mean the same thing everywhere.
 */
export class RangePicker {
  readonly params: RangeParams;
  private seen: number;
  private taken = 0;
  nextStartNs: bigint | null = null;

  constructor(params: RangeParams) {
    this.params = normalizeRange(params);
    this.seen = this.params.phase;
  }

  /** Is `timestamp` inside the asked range? */
  inRange(timestamp: bigint): boolean {
    return timestamp >= this.params.startNs && timestamp <= this.params.endNs;
  }

  /**
   * Account for one raw message in order. Returns true when it should be
   * decoded and returned. Once `max` are taken, `done` is true and the caller
   * should stop reading.
   */
  offer(timestamp: bigint): boolean {
    const take = this.seen % this.params.stride === 0;
    this.seen++;
    if (!take) return false;
    this.taken++;
    if (this.taken >= this.params.max) this.nextStartNs = timestamp + 1n;
    return true;
  }

  get done(): boolean {
    return this.nextStartNs !== null;
  }

  get phase(): number {
    return this.seen % this.params.stride;
  }

  /** The finished batch. `nextStartNs` stays null when the whole range was read. */
  finish(messages: RangeResult['messages']): RangeResult {
    // A batch that ended exactly at the range end has nothing left to resume.
    const resume = this.nextStartNs !== null && this.nextStartNs <= this.params.endNs ? this.nextStartNs : null;
    return { messages, nextStartNs: resume, phase: this.phase };
  }
}

/** Range read over messages already in memory: the fallback for sources with no cheap range access. */
export function rangeFromAll(
  all: ReadonlyArray<{ timestamp: bigint; value: Record<string, unknown> | null }>,
  params: RangeParams,
): RangeResult {
  const picker = new RangePicker(params);
  const out: RangeResult['messages'] = [];
  for (const m of all) {
    if (!picker.inRange(m.timestamp)) continue;
    if (picker.offer(m.timestamp)) out.push(m);
    if (picker.done) break;
  }
  return picker.finish(out);
}
