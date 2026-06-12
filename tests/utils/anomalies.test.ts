import { describe, it, expect } from 'vitest';
import { detectNonMonotonicStamps } from '../../src/utils/anomalies';
import type { AllTopicStats } from '../../src/types/bag';

function makeStats(timesNs: number[]): AllTopicStats[string] {
  return {
    times: new Float64Array(timesNs),
    sizes: new Uint32Array(timesNs.map(() => 100)),
  };
}

describe('detectNonMonotonicStamps', () => {
  it('returns empty array for a strictly monotonic topic', () => {
    const stats: AllTopicStats = {
      '/imu': makeStats([0, 100_000_000, 200_000_000, 300_000_000]),
    };
    expect(detectNonMonotonicStamps(stats)).toHaveLength(0);
  });

  it('detects a backwards jump (t[i] < t[i-1])', () => {
    const stats: AllTopicStats = {
      '/odom': makeStats([0, 100_000_000, 50_000_000, 300_000_000]),
    };
    const anomalies = detectNonMonotonicStamps(stats);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].topic).toBe('/odom');
    expect(anomalies[0].kind).toBe('non-monotonic-stamp');
    expect(anomalies[0].atNs).toBe(50_000_000);
  });

  it('detects a duplicate timestamp (t[i] === t[i-1])', () => {
    const stats: AllTopicStats = {
      '/tf': makeStats([0, 100_000_000, 100_000_000, 200_000_000]),
    };
    const anomalies = detectNonMonotonicStamps(stats);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0].atNs).toBe(100_000_000);
  });

  it('reports anomalies across multiple topics', () => {
    const stats: AllTopicStats = {
      '/imu': makeStats([0, 100_000_000, 50_000_000]),
      '/cam': makeStats([0, 33_000_000, 10_000_000]),
      '/odom': makeStats([0, 100_000_000, 200_000_000]),
    };
    const anomalies = detectNonMonotonicStamps(stats);
    expect(anomalies).toHaveLength(2);
    const topics = anomalies.map((a) => a.topic).sort();
    expect(topics).toEqual(['/cam', '/imu']);
  });

  it('handles empty topics without error', () => {
    const stats: AllTopicStats = {
      '/empty': makeStats([]),
    };
    expect(detectNonMonotonicStamps(stats)).toHaveLength(0);
  });
});
