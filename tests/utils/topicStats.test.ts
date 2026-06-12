import { describe, it, expect } from 'vitest';
import { computeTopicHealth, computeAllTopicHealth } from '../../src/utils/topicStats';
import type { MessageStats, AllTopicStats } from '../../src/types/bag';

function makeStats(timesNs: number[], sizeBytes?: number[]): MessageStats {
  return {
    times: new Float64Array(timesNs),
    sizes: new Uint32Array(sizeBytes ?? timesNs.map(() => 100)),
  };
}

describe('computeTopicHealth / empty input', () => {
  it('returns zero-valued health for empty stats', () => {
    const h = computeTopicHealth('/empty', makeStats([]));
    expect(h.count).toBe(0);
    expect(h.meanHz).toBe(0);
    expect(h.jitterSec).toBe(0);
    expect(h.gapCount).toBe(0);
    expect(h.bandwidthBytesPerSec).toBe(0);
    expect(h.rateOverTime.t).toHaveLength(0);
  });
});

describe('computeTopicHealth / single message', () => {
  it('returns count=1 with zero Hz and zero jitter', () => {
    const h = computeTopicHealth('/single', makeStats([0]));
    expect(h.count).toBe(1);
    expect(h.meanHz).toBe(0);
    expect(h.jitterSec).toBe(0);
    expect(h.gapCount).toBe(0);
  });
});

describe('computeTopicHealth / regular 10 Hz topic', () => {
  it('computes Hz, jitter, bandwidth correctly', () => {
    // 11 messages at 100 ms intervals = 10 Hz over 1 second
    const times = Array.from({ length: 11 }, (_, i) => i * 100_000_000);
    const sizes = times.map(() => 500);
    const h = computeTopicHealth('/imu', makeStats(times, sizes));

    expect(h.count).toBe(11);
    expect(h.durationSec).toBeCloseTo(1.0, 9);
    expect(h.meanHz).toBeCloseTo(10.0, 1);
    expect(h.medianPeriodSec).toBeCloseTo(0.1, 9);
    expect(h.jitterSec).toBeCloseTo(0, 9);
    expect(h.gapCount).toBe(0);
    expect(h.bandwidthBytesPerSec).toBeCloseTo(5500, 0); // 11 * 500 / 1 s
  });

  it('produces 20-bin rateOverTime', () => {
    const times = Array.from({ length: 201 }, (_, i) => i * 100_000_000);
    const h = computeTopicHealth('/imu', makeStats(times));
    expect(h.rateOverTime.t).toHaveLength(20);
    expect(h.rateOverTime.hz).toHaveLength(20);
    // Every window should have ~10 Hz
    for (let i = 0; i < 20; i++) {
      expect(h.rateOverTime.hz[i]).toBeGreaterThan(8);
      expect(h.rateOverTime.hz[i]).toBeLessThan(12);
    }
  });
});

describe('computeTopicHealth / gap detection', () => {
  it('flags a 5x-median gap as a gap', () => {
    // 100 ms nominal, then a 600 ms gap (6x median), then resume
    const times = [
      0, 100_000_000, 200_000_000, 300_000_000,
      900_000_000, // 600 ms gap after 300 ms
      1_000_000_000, 1_100_000_000,
    ];
    const h = computeTopicHealth('/odom', makeStats(times));
    expect(h.gapCount).toBeGreaterThanOrEqual(1);
    expect(h.gaps[0].gapSec).toBeCloseTo(0.6, 3);
  });

  it('does not flag a 2x gap (below threshold)', () => {
    // 100 ms nominal, then 200 ms (2x) — below 3x threshold
    const times = [0, 100_000_000, 300_000_000, 400_000_000, 500_000_000];
    const h = computeTopicHealth('/odom', makeStats(times));
    expect(h.gapCount).toBe(0);
  });
});

describe('computeTopicHealth / bandwidth', () => {
  it('computes bandwidth correctly', () => {
    // 5 messages over 0.4 s, each 1000 bytes
    const times = [0, 100_000_000, 200_000_000, 300_000_000, 400_000_000];
    const sizes = times.map(() => 1000);
    const h = computeTopicHealth('/cam', makeStats(times, sizes));
    // 5000 bytes over 0.4 s = 12500 B/s
    expect(h.bandwidthBytesPerSec).toBeCloseTo(12500, 0);
  });
});

describe('computeAllTopicHealth', () => {
  it('returns one health entry per topic', () => {
    const allStats: AllTopicStats = {
      '/imu': makeStats([0, 100_000_000, 200_000_000]),
      '/camera': makeStats([0, 33_000_000, 66_000_000]),
    };
    const healths = computeAllTopicHealth(allStats);
    expect(healths).toHaveLength(2);
    const topics = healths.map((h) => h.topic).sort();
    expect(topics).toEqual(['/camera', '/imu']);
  });
});
