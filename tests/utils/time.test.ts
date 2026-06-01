import { describe, it, expect } from 'vitest';
import {
  nsToSeconds,
  formatDuration,
  formatRelativeTime,
  formatAbsoluteTime,
  interpolatePlayhead,
} from '../../src/utils/time';

describe('time/nsToSeconds', () => {
  it('converts whole seconds without precision loss', () => {
    expect(nsToSeconds(1_000_000_000n)).toBe(1);
    expect(nsToSeconds(60_000_000_000n)).toBe(60);
  });

  it('keeps millisecond precision (sub-ms truncates by design)', () => {
    // The implementation divides by 1_000_000n (integer ms) then by 1000,
    // so it intentionally truncates below 1 ms to keep the BigInt math fast.
    // 1_234_500_000 ns → 1234 ms → 1.234 s. Sub-millisecond precision is lost.
    expect(nsToSeconds(1_234_500_000n)).toBe(1.234);
    expect(nsToSeconds(1_500_000_000n)).toBe(1.5);
  });

  it('handles values above 2^53 ns without losing seconds precision', () => {
    // 2^53 ns ≈ 104 days. Real bags are short, but ROS timestamps anchor at
    // unix epoch (year-1970), so absolute timestamps live well above 2^53.
    const ns = 1_700_000_000_000_000_000n; // 2023 epoch
    const seconds = nsToSeconds(ns);
    // Number can't represent the ns exactly, but seconds is well under 2^53.
    expect(seconds).toBe(1_700_000_000);
  });

  it('produces a finite zero for a zero timestamp', () => {
    expect(nsToSeconds(0n)).toBe(0);
  });

  it('handles negative deltas (end before start)', () => {
    expect(nsToSeconds(-500_000_000n)).toBeCloseTo(-0.5, 6);
  });
});

describe('time/formatDuration', () => {
  it('formats millisecond durations', () => {
    expect(formatDuration(0.125)).toBe('125ms');
    expect(formatDuration(0)).toBe('0ms');
  });

  it('formats sub-minute durations to one decimal', () => {
    expect(formatDuration(42.345)).toBe('42.3s');
  });

  it('formats minutes + seconds with no decimal on the seconds portion', () => {
    expect(formatDuration(90)).toBe('1m 30s');
    expect(formatDuration(125)).toBe('2m 5s');
  });

  it('formats hours + minutes for long bags', () => {
    expect(formatDuration(3 * 3600 + 12 * 60 + 5)).toBe('3h 12m');
  });
});

describe('time/formatRelativeTime', () => {
  it('reports a relative offset from bag start', () => {
    const start = 1_700_000_000_000_000_000n;
    const tick = start + 12_345_000_000n; // 12.345 s
    expect(formatRelativeTime(tick, start)).toBe('12.345s');
  });

  it('formats negative offsets when the timestamp is before start', () => {
    const start = 1_700_000_000_000_000_000n;
    const tick = start - 500_000_000n;
    expect(formatRelativeTime(tick, start)).toMatch(/^-?0\.500s$/);
  });
});

describe('time/formatAbsoluteTime', () => {
  it('emits an ISO-8601 string for a known epoch', () => {
    // 2023-11-14T22:13:20.000Z corresponds to 1_700_000_000_000_000_000 ns.
    expect(formatAbsoluteTime(1_700_000_000_000_000_000n)).toBe(
      '2023-11-14T22:13:20.000Z',
    );
  });
});

describe('time/interpolatePlayhead', () => {
  const start = 1_000n;
  const end = 11_000n;

  it('returns start at fraction 0 and end at fraction 1', () => {
    expect(interpolatePlayhead(start, end, 0)).toBe(start);
    expect(interpolatePlayhead(start, end, 1)).toBe(end);
  });

  it('clamps out-of-range fractions to [0, 1]', () => {
    expect(interpolatePlayhead(start, end, -1)).toBe(start);
    expect(interpolatePlayhead(start, end, 2)).toBe(end);
  });

  it('interpolates linearly inside the range', () => {
    expect(interpolatePlayhead(start, end, 0.5)).toBe(6_000n);
    expect(interpolatePlayhead(start, end, 0.1)).toBe(2_000n);
  });

  it('produces a bigint even for tiny ranges', () => {
    expect(typeof interpolatePlayhead(0n, 10n, 0.5)).toBe('bigint');
  });
});
