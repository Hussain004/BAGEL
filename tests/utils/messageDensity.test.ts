import { describe, it, expect } from 'vitest';
import { computeMessageDensity } from '../../src/utils/messageDensity';
import type { MessageStats, AllTopicStats } from '../../src/types/bag';

function makeStats(timesNs: number[]): MessageStats {
  return {
    times: new Float64Array(timesNs),
    sizes: new Uint32Array(timesNs.map(() => 100)),
  };
}

describe('computeMessageDensity', () => {
  it('returns all-zero buckets for zero duration', () => {
    const stats: AllTopicStats = { '/a': makeStats([0, 100]) };
    const buckets = computeMessageDensity(stats, 0, 10);
    expect(buckets).toHaveLength(10);
    expect(Array.from(buckets)).toEqual(new Array(10).fill(0));
  });

  it('returns all-zero buckets for no topics', () => {
    const buckets = computeMessageDensity({}, 1000, 10);
    expect(Array.from(buckets)).toEqual(new Array(10).fill(0));
  });

  it('bins messages into the correct bucket and normalizes to the busiest one', () => {
    // Duration 1000ns, 10 buckets -> each bucket spans 100ns.
    const stats: AllTopicStats = {
      '/a': makeStats([0, 50]), // bucket 0: 2 messages
      '/b': makeStats([950]), // bucket 9: 1 message
    };
    const buckets = computeMessageDensity(stats, 1000, 10);
    expect(buckets[0]).toBe(1); // busiest bucket normalizes to 1
    expect(buckets[9]).toBeCloseTo(0.5);
    expect(buckets[5]).toBe(0);
  });

  it('clamps a timestamp exactly at the end of the range into the last bucket', () => {
    const stats: AllTopicStats = { '/a': makeStats([1000]) };
    const buckets = computeMessageDensity(stats, 1000, 10);
    expect(buckets[9]).toBe(1);
  });

  it('ignores out-of-range timestamps (negative or beyond duration)', () => {
    const stats: AllTopicStats = { '/a': makeStats([-10, 2000, 500]) };
    const buckets = computeMessageDensity(stats, 1000, 10);
    const total = buckets.reduce((a, b) => a + b, 0);
    expect(total).toBe(1); // only the in-range timestamp (500) counted
  });

  it('defaults to DENSITY_BUCKETS when bucketCount is omitted', () => {
    const buckets = computeMessageDensity({ '/a': makeStats([0]) }, 1000);
    expect(buckets).toHaveLength(200);
  });
});
