import { describe, expect, it } from 'vitest';
import { RangePicker, normalizeRange, rangeFromAll, type RangeParams } from '../../src/parsers/range';

const msgs = (n: number, step = 10n) => Array.from({ length: n }, (_, i) => ({ timestamp: 100n + BigInt(i) * step, value: { i } }));
const params = (extra: Partial<RangeParams> = {}): RangeParams => ({ startNs: 0n, endNs: 10_000n, stride: 1, phase: 0, max: 1000, ...extra });

/** Read the whole range by repeated bounded calls, the way the exporter does. */
function drain(all: ReturnType<typeof msgs>, base: RangeParams) {
  const got: number[] = [];
  let start: bigint | null = base.startNs;
  let phase = 0;
  let calls = 0;
  while (start !== null && calls++ < 1000) {
    const r = rangeFromAll(all, { ...base, startNs: start, phase });
    got.push(...r.messages.map((m) => m.value!.i as number));
    start = r.nextStartNs;
    phase = r.phase;
  }
  return { got, calls };
}

describe('range batches', () => {
  it('returns everything in range in one call when it fits', () => {
    const r = rangeFromAll(msgs(5), params());
    expect(r.messages.map((m) => m.value!.i)).toEqual([0, 1, 2, 3, 4]);
    expect(r.nextStartNs).toBeNull();
  });

  it('honours the range on both ends, inclusive', () => {
    const r = rangeFromAll(msgs(10), params({ startNs: 120n, endNs: 150n }));
    expect(r.messages.map((m) => m.timestamp)).toEqual([120n, 130n, 140n, 150n]);
    expect(rangeFromAll(msgs(3), params({ startNs: 5_000n })).messages).toEqual([]);
  });

  it('many small batches see exactly what one big call sees, for every stride and batch size', () => {
    const all = msgs(97, 7n);
    for (const stride of [1, 2, 3, 5, 10, 96, 97, 200]) {
      const whole = rangeFromAll(all, params({ stride, max: 10_000 })).messages.map((m) => m.value!.i);
      for (const max of [1, 2, 3, 7, 50, 97, 1000]) {
        const { got } = drain(all, params({ stride, max }));
        expect(got, `stride ${stride}, batch ${max}`).toEqual(whole);
      }
    }
  });

  it('a stride takes the first message and then every Nth', () => {
    expect(rangeFromAll(msgs(10), params({ stride: 3 })).messages.map((m) => m.value!.i)).toEqual([0, 3, 6, 9]);
  });

  it('a batch that fills exactly cannot know the range is over: the next call comes back empty and finishes', () => {
    const all = msgs(5);
    const first = rangeFromAll(all, params({ max: 5 }));
    expect(first.messages).toHaveLength(5);
    expect(first.nextStartNs).not.toBeNull();
    const next = rangeFromAll(all, params({ max: 5, startNs: first.nextStartNs!, phase: first.phase }));
    expect(next).toEqual({ messages: [], nextStartNs: null, phase: next.phase });
  });

  it('timestamps that need all 64 bits survive the resume', () => {
    const base = 1_700_000_000_123_456_789n;
    const all = Array.from({ length: 6 }, (_, i) => ({ timestamp: base + BigInt(i), value: { i } }));
    const first = rangeFromAll(all, { startNs: base, endNs: base + 10n, stride: 1, phase: 0, max: 2 });
    expect(first.nextStartNs).toBe(base + 2n);
    const rest = rangeFromAll(all, { startNs: first.nextStartNs!, endNs: base + 10n, stride: 1, phase: first.phase, max: 100 });
    expect(rest.messages.map((m) => m.value!.i)).toEqual([2, 3, 4, 5]);
  });

  it('an empty topic and duplicate timestamps are fine', () => {
    expect(rangeFromAll([], params())).toEqual({ messages: [], nextStartNs: null, phase: 0 });
    const dup = [0, 1, 2, 3].map((i) => ({ timestamp: 50n, value: { i } }));
    // Two messages share a timestamp: a batch boundary between them cannot split them by time alone.
    // The picker resumes after the timestamp, which is the documented limit; one big call is exact.
    expect(rangeFromAll(dup, params({ max: 100 })).messages).toHaveLength(4);
  });
});

describe('normalizeRange', () => {
  it('makes bad numbers safe', () => {
    for (const bad of [0, -3, NaN, Infinity]) {
      const n = normalizeRange({ ...params(), stride: bad, max: bad, phase: bad });
      expect(n.stride).toBe(1);
      expect(n.max).toBe(1);
      expect(n.phase).toBe(0);
    }
    expect(normalizeRange({ ...params(), stride: 2.9, max: 4.7, phase: 5 })).toMatchObject({ stride: 2, max: 4, phase: 1 });
  });

  it('a picker built from nonsense still terminates', () => {
    const p = new RangePicker({ ...params(), max: 0, stride: 0 });
    expect(p.offer(10n)).toBe(true);
    expect(p.done).toBe(true);
  });
});
