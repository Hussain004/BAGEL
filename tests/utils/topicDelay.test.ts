import { describe, it, expect } from 'vitest';
import { delaySampleCount, delayStats, measureTopicDelay } from '../../src/utils/topicDelay';
import { rangeFromAll, type RangeParams, type RangeResult } from '../../src/parsers/range';
import type { BagSource } from '../../src/parsers/source';

const S = 1_000_000_000n;
/** A message logged at `logNs` whose header was stamped `delayMs` earlier, ROS 2 or ROS 1 field names. */
const msg = (logNs: bigint, delayMs: number | null, ros1 = false) => {
  if (delayMs === null) return { timestamp: logNs, value: { data: 1 } };
  const stampNs = logNs - BigInt(Math.round(delayMs * 1e6));
  const sec = stampNs / S;
  const ns = stampNs % S;
  const stamp = ros1 ? { secs: Number(sec), nsecs: Number(ns) } : { sec: Number(sec), nanosec: Number(ns) };
  return { timestamp: logNs, value: { header: { stamp, frame_id: 'f' } } };
};

describe('delayStats', () => {
  it('reports percentiles of log time minus header stamp, for ROS 1 and ROS 2 stamps', () => {
    const base = 1_700_000_000n * S; // a real epoch, so a lossy float would show
    const msgs = Array.from({ length: 100 }, (_, i) => msg(base + BigInt(i) * 10_000_000n, i + 1, i % 2 === 0));
    const d = delayStats(msgs)!;
    expect(d.n).toBe(100);
    expect(d.minMs).toBeCloseTo(1, 6);
    expect(d.p50Ms).toBeCloseTo(50, 6);
    expect(d.p95Ms).toBeCloseTo(95, 6);
    expect(d.maxMs).toBeCloseTo(100, 6);
    expect(d.bins.reduce((a, b) => a + b, 0)).toBe(100);
    expect(d.bins).toHaveLength(16);
  });

  it('counts messages without a header or with a zero stamp, and returns null when none have one', () => {
    const zero = { timestamp: 5n * S, value: { header: { stamp: { sec: 0, nanosec: 0 } } } };
    expect(delayStats([msg(5n * S, null), zero])).toBeNull();
    const d = delayStats([msg(5n * S, null), zero, msg(6n * S, 3)])!;
    expect([d.n, d.unstamped]).toEqual([1, 2]);
    expect(d.bins[0]).toBe(1); // a single value lands in the first bin, not NaN
  });

  it('keeps negative delays (a clock ahead of the recorder)', () => {
    const d = delayStats([msg(10n * S, -4), msg(11n * S, 2)])!;
    expect(d.minMs).toBeCloseTo(-4, 6);
  });

  it('accepts bigint stamp fields', () => {
    const d = delayStats([{ timestamp: 3n * S + 7_000_000n, value: { header: { stamp: { sec: 3n, nanosec: 2_000_000n } } } }])!;
    expect(d.p50Ms).toBeCloseTo(5, 6);
  });
});

describe('delaySampleCount', () => {
  it('caps at 500, never exceeds the topic, and shrinks for heavy messages', () => {
    expect(delaySampleCount(10_000, 100)).toBe(500);
    expect(delaySampleCount(42, 100)).toBe(42);
    expect(delaySampleCount(10_000, 6 * 1024 * 1024)).toBe(20); // 6 MB images: the 20-message floor
    expect(delaySampleCount(10_000, 512 * 1024)).toBe(128);
    expect(delaySampleCount(0, 0)).toBe(1);
  });
});

describe('measureTopicDelay', () => {
  /** The real in-memory range reader, with batches smaller than asked so resuming is exercised. */
  function reader(times: bigint[], batchMax: number) {
    const all = times.map((t) => msg(t, 7));
    const calls: RangeParams[] = [];
    const read = async (_s: BagSource, _f: string, _t: string, p: RangeParams): Promise<RangeResult> => {
      calls.push(p);
      return rangeFromAll(all, { ...p, max: Math.min(p.max, batchMax) });
    };
    return { read, calls };
  }

  it('spreads the sample over the whole bag, resuming across batches', async () => {
    const times = Array.from({ length: 10_000 }, (_, i) => 100n * S + BigInt(i) * 1_000_000n);
    const { read, calls } = reader(times, 120);
    const d = await measureTopicDelay(read, {} as BagSource, 'mcap', '/t', times.length, 500, times[0]!, times.at(-1)!);
    expect(d!.n).toBe(500);
    expect(d!.p50Ms).toBeCloseTo(7, 6);
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((c) => c.stride === 20)).toBe(true);
  });
});
