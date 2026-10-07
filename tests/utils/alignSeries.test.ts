import { describe, expect, it } from 'vitest';
import { alignColumns, defaultAlias, holdForward, readField } from '../../src/utils/alignSeries';
import { flattenNumeric } from '../../src/utils/messages';

const seq = (n: number, hz: number, t0 = 0) => Array.from({ length: n }, (_, i) => t0 + i / hz);

describe('alignColumns', () => {
  it('aligns a 100 Hz and a 10 Hz topic on the union, with nulls between slow samples', () => {
    const fast = { times: seq(101, 100), values: seq(101, 100).map((t) => t * 10) };
    const slow = { times: seq(11, 10), values: seq(11, 10).map((t) => -t) };
    const { time, columns } = alignColumns([fast, slow]);
    // Every 100 Hz stamp is already a superset of the 10 Hz stamps.
    expect(time).toHaveLength(101);
    expect(columns[0]!.every((v) => v !== null)).toBe(true);
    const slowHits = columns[1]!.filter((v) => v !== null);
    expect(slowHits).toHaveLength(11);
    expect(columns[1]![10]).toBeCloseTo(-0.1);
    expect(columns[1]![5]).toBeNull();
  });

  it('keeps the union strictly increasing for interleaved topics', () => {
    const a = { times: [0, 2, 4], values: [1, 2, 3] };
    const b = { times: [1, 3, 5], values: [10, 20, 30] };
    const { time, columns } = alignColumns([a, b]);
    expect(time).toEqual([0, 1, 2, 3, 4, 5]);
    expect(columns[0]).toEqual([1, null, 2, null, 3, null]);
    expect(columns[1]).toEqual([null, 10, null, 20, null, 30]);
  });

  it('merges identical timestamps into one row', () => {
    const { time, columns } = alignColumns([
      { times: [0, 1, 2], values: [1, 2, 3] },
      { times: [0, 1, 2], values: [4, 5, 6] },
    ]);
    expect(time).toEqual([0, 1, 2]);
    expect(columns).toEqual([[1, 2, 3], [4, 5, 6]]);
  });

  it('survives a topic with a long gap', () => {
    const a = { times: [0, 1, 2, 7, 8], values: [1, 1, 1, 1, 1] };
    const b = { times: seq(9, 1), values: seq(9, 1) };
    const { time, columns } = alignColumns([a, b]);
    expect(time).toEqual(seq(9, 1));
    expect(columns[0]).toEqual([1, 1, 1, null, null, null, null, 1, 1]);
  });

  it('sorts non-monotonic stamps instead of corrupting the axis', () => {
    const { time, columns } = alignColumns([{ times: [3, 1, 2, 0], values: [30, 10, 20, 0] }]);
    expect(time).toEqual([0, 1, 2, 3]);
    expect(columns[0]).toEqual([0, 10, 20, 30]);
  });

  it('lets the later sample win when a stamp repeats', () => {
    const { time, columns } = alignColumns([{ times: [1, 1, 2], values: [5, 6, 7] }]);
    expect(time).toEqual([1, 2]);
    expect(columns[0]).toEqual([6, 7]);
  });

  it('drops non-finite stamps and tolerates mismatched lengths', () => {
    const { time, columns } = alignColumns([
      { times: [0, NaN, 1, Infinity, 2], values: [0, 9, 1, 9, 2] },
      { times: [0, 1, 2, 3], values: [7, 8] },
    ]);
    expect(time).toEqual([0, 1, 2]);
    expect(columns[0]).toEqual([0, 1, 2]);
    expect(columns[1]).toEqual([7, 8, null]);
  });

  it('handles empty inputs', () => {
    expect(alignColumns([])).toEqual({ time: [], columns: [] });
    const { time, columns } = alignColumns([
      { times: [], values: [] },
      { times: [1], values: [2] },
    ]);
    expect(time).toEqual([1]);
    expect(columns).toEqual([[null], [2]]);
  });

  it('keeps null values in the input as null', () => {
    const { columns } = alignColumns([{ times: [0, 1], values: [null, 4] }]);
    expect(columns[0]).toEqual([null, 4]);
  });

  it('aligns a large pair quickly and exactly', () => {
    const n = 100_000;
    const a = { times: seq(n, 1000), values: seq(n, 1000) };
    const b = { times: seq(n / 10, 100, 0.0005), values: seq(n / 10, 100) };
    const { time, columns } = alignColumns([a, b]);
    expect(time).toHaveLength(n + n / 10);
    expect(columns[0]!.filter((v) => v !== null)).toHaveLength(n);
    expect(columns[1]!.filter((v) => v !== null)).toHaveLength(n / 10);
    for (let i = 1; i < time.length; i++) if (!(time[i]! > time[i - 1]!)) throw new Error(`not increasing at ${i}`);
  });
});

describe('holdForward', () => {
  it('carries values over gaps and leaves the lead-in null', () => {
    expect(holdForward([null, null, 1, null, null, 2, null])).toEqual([null, null, 1, 1, 1, 2, 2]);
  });
  it('is the identity when there are no gaps', () => {
    expect(holdForward([1, 2, 3])).toEqual([1, 2, 3]);
    expect(holdForward([])).toEqual([]);
  });
});

describe('readField agrees with flattenNumeric', () => {
  const samples: unknown[] = [
    { header: { stamp: { sec: 5, nanosec: 7 }, frame_id: 'odom' }, pose: { position: { x: 1.5, y: -2, z: 0 } } },
    { data: [1, 2, 3], flag: true, big: 123n, nested: { arr: [{ a: 1 }] } },
    { covariance: new Float64Array(36).map((_, i) => i * 0.5), name: 'x' },
    { ranges: new Float32Array([0.25, 0.5, 1]), flags: [true, false] },
    { text: 'hello', maybe: null, n: NaN, inf: Infinity, zero: 0, neg: -0.001 },
  ];

  it('reads back every key flattenNumeric emits, with the same value', () => {
    let keys = 0;
    for (const s of samples) {
      for (const [k, v] of Object.entries(flattenNumeric(s))) {
        keys++;
        expect(readField(s, k), k).toBe(v);
      }
    }
    expect(keys).toBeGreaterThan(40);
  });

  it('returns null for paths that do not resolve to a finite number', () => {
    const s = samples[4];
    expect(readField(s, 'text')).toBeNull();
    expect(readField(s, 'maybe')).toBeNull();
    expect(readField(s, 'n')).toBeNull();
    expect(readField(s, 'inf')).toBeNull();
    expect(readField(s, 'missing.deeper')).toBeNull();
    expect(readField(null, 'a')).toBeNull();
    expect(readField(s, '')).toBeNull();
  });
});

describe('defaultAlias', () => {
  it('builds an expression-safe identifier from topic leaf and field tail', () => {
    expect(defaultAlias('/odom', 'twist.twist.linear.x', new Set())).toBe('odom_x');
    expect(defaultAlias('/robot-1/cmd_vel', 'linear.x', new Set())).toBe('cmd_vel_x');
    expect(defaultAlias('/imu/data', 'covariance[0]', new Set())).toBe('data_covariance_0');
  });
  it('de-duplicates against taken names', () => {
    const taken = new Set(['odom_x', 'odom_x_2']);
    expect(defaultAlias('/odom', 'a.x', taken)).toBe('odom_x_3');
  });
  it('never starts with a digit', () => {
    expect(defaultAlias('/3d', '1', new Set())).toMatch(/^[a-zA-Z_]/);
  });
});
