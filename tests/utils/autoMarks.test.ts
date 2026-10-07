import { describe, it, expect } from 'vitest';
import {
  AUTO_MARK_MERGE_NS,
  MAX_AUTO_MARKS,
  buildAutoMarks,
  type Anomaly,
} from '../../src/utils/anomalies';

const START = 1_700_000_000_000_000_000n;
const sec = (s: number) => s * 1e9;

function nm(topic: string, atNs: number): Anomaly {
  return { topic, kind: 'non-monotonic-stamp', atNs, detail: '' };
}

describe('buildAutoMarks', () => {
  it('returns nothing for a clean bag', () => {
    expect(buildAutoMarks('b', START, [], [])).toEqual([]);
  });

  it('rebases bag-relative times onto the absolute bag start', () => {
    const marks = buildAutoMarks('b', START, [{ topic: '/scan', atNs: sec(42), gapSec: 1.5 }], []);
    expect(marks).toHaveLength(1);
    expect(marks[0]!.localNs).toBe(START + 42_000_000_000n);
    expect(marks[0]!.label).toBe('Gap 1.50 s on /scan');
    expect(marks[0]!.kind).toBe('gap');
  });

  it('returns marks in time order regardless of input order', () => {
    const marks = buildAutoMarks(
      'b',
      START,
      [
        { topic: '/a', atNs: sec(30), gapSec: 1 },
        { topic: '/b', atNs: sec(10), gapSec: 1 },
      ],
      [nm('/c', sec(20))],
    );
    const times = marks.map((m) => m.localNs);
    expect([...times].sort((x, y) => (x < y ? -1 : 1))).toEqual(times);
    expect(marks).toHaveLength(3);
  });

  it('merges a burst into one mark and keeps the most severe label', () => {
    const marks = buildAutoMarks(
      'b',
      START,
      [{ topic: '/scan', atNs: sec(5) + 1000, gapSec: 2 }],
      [nm('/imu', sec(5)), nm('/imu', sec(5) + 10_000_000)],
    );
    expect(marks).toHaveLength(1);
    expect(marks[0]!.label).toBe('Gap 2.00 s on /scan (+2 nearby)');
  });

  it('does not merge events at least the merge window apart', () => {
    const marks = buildAutoMarks('b', START, [], [nm('/x', 0), nm('/x', AUTO_MARK_MERGE_NS)]);
    expect(marks).toHaveLength(2);
  });

  it('caps a corrupt bag with one anomaly per message, keeping the biggest gaps', () => {
    const noise = Array.from({ length: 5000 }, (_, i) => nm('/imu', sec(i)));
    const big = { topic: '/lidar', atNs: sec(2500) + 500_000_000, gapSec: 9 };
    const marks = buildAutoMarks('b', START, [big], noise);
    expect(marks.length).toBe(MAX_AUTO_MARKS);
    expect(marks.some((m) => m.label.startsWith('Gap 9.00 s'))).toBe(true);
  });

  it('gives each mark a unique id', () => {
    const marks = buildAutoMarks('bag7', START, [], [nm('/x', 0), nm('/x', sec(5)), nm('/x', sec(9))]);
    expect(new Set(marks.map((m) => m.id)).size).toBe(3);
    expect(marks[0]!.id.startsWith('auto-bag7-')).toBe(true);
  });
});
