import { describe, expect, it } from 'vitest';
import { niceTicks, plotCsv, plotFilename, plotSvg, rangeStats } from '../../src/utils/seriesStats';

const seq = (n: number) => Array.from({ length: n }, (_, i) => i);

describe('rangeStats', () => {
  it('computes the textbook values', () => {
    const s = rangeStats('x', [0, 1, 2, 3], [2, 4, 4, 6], 0, 3)!;
    expect(s.n).toBe(4);
    expect(s.min).toBe(2);
    expect(s.max).toBe(6);
    expect(s.mean).toBe(4);
    expect(s.std).toBeCloseTo(Math.sqrt(8 / 3), 12); // sample std, n - 1
    expect(s.rms).toBeCloseTo(Math.sqrt((4 + 16 + 16 + 36) / 4), 12);
    expect([s.first, s.last]).toEqual([2, 6]);
  });

  it('only counts samples inside the range, inclusive at both ends', () => {
    const s = rangeStats('x', seq(10), seq(10), 3, 6)!;
    expect(s.n).toBe(4);
    expect([s.min, s.max, s.first, s.last]).toEqual([3, 6, 3, 6]);
  });

  it('skips nulls, NaN and Infinity', () => {
    const s = rangeStats('x', seq(5), [1, null, NaN, Infinity, 3], 0, 4)!;
    expect(s.n).toBe(2);
    expect(s.mean).toBe(2);
  });

  it('handles one sample, a constant series, and an empty range', () => {
    const one = rangeStats('x', [0], [5], 0, 1)!;
    expect(one.std).toBe(0);
    expect(rangeStats('x', seq(4), [7, 7, 7, 7], 0, 3)!.std).toBe(0);
    expect(rangeStats('x', seq(4), seq(4), 10, 20)).toBeNull();
    expect(rangeStats('x', [], [], 0, 1)).toBeNull();
  });

  it('stays accurate when a tiny spread sits on a huge offset (Welford, not E[x^2]-E[x]^2)', () => {
    const n = 1000;
    const values = seq(n).map((i) => 1.7e9 + (i % 2 === 0 ? 0.5 : -0.5));
    const s = rangeStats('x', seq(n), values, 0, n)!;
    // True sample std of +/-0.5 alternating is ~0.50025; the naive formula returns 0 or NaN here.
    expect(s.std).toBeGreaterThan(0.49);
    expect(s.std).toBeLessThan(0.51);
    expect(s.mean).toBeCloseTo(1.7e9, 3);
  });

  it('does not assume sorted times (non-monotonic stamps)', () => {
    const s = rangeStats('x', [3, 0, 2, 1], [30, 0, 20, 10], 1, 2)!;
    expect(s.n).toBe(2);
    expect(s.mean).toBe(15);
  });

  it('is fast on a million samples', () => {
    const n = 1_000_000;
    const t = new Float64Array(n).map((_, i) => i);
    const v = new Float64Array(n).map((_, i) => Math.sin(i / 1000));
    const s = rangeStats('x', t, v, 0, n)!;
    expect(s.n).toBe(n);
    expect(Math.abs(s.mean)).toBeLessThan(0.01);
  });
});

describe('plotCsv', () => {
  it('writes a header and only the rows in range, empty cells for gaps', () => {
    const csv = plotCsv([0, 1, 2, 3], [{ name: 'a', values: [1, null, 3, 4] }, { name: 'b', values: [5, 6, NaN, 8] }], 1, 3);
    expect(csv).toBe('t_s,a,b\n1,,6\n2,3,\n3,4,8\n');
  });
  it('quotes names containing commas, quotes or newlines', () => {
    expect(plotCsv([0], [{ name: 'f(a,b)', values: [1] }, { name: 'say "hi"', values: [2] }], 0, 1)).toBe(
      't_s,"f(a,b)","say ""hi"""\n0,1,2\n',
    );
  });
  it('is just the header for an empty range', () => {
    expect(plotCsv([0, 1], [{ name: 'a', values: [1, 2] }], 5, 6)).toBe('t_s,a\n');
  });
});

describe('niceTicks', () => {
  it('uses 1, 2, 5 steps and round values', () => {
    expect(niceTicks(0, 10, 5)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });
  it('does not leak float error into labels', () => {
    for (const v of niceTicks(0, 0.7, 7)) expect(String(v).length).toBeLessThan(6);
  });
  it('copes with negative, tiny, equal and non-finite ranges', () => {
    expect(niceTicks(-1, 1, 4)).toContain(0);
    expect(niceTicks(1e-9, 5e-9, 4).length).toBeGreaterThan(1);
    expect(niceTicks(3, 3)).toEqual([3]);
    expect(niceTicks(NaN, 1)).toEqual([]);
  });
});

describe('plotSvg', () => {
  const base = { title: 'odom', width: 900, height: 420 };

  it('produces a standalone svg with a polyline per series and a legend', () => {
    const svg = plotSvg({
      ...base,
      time: [0, 1, 2],
      columns: [{ name: 'x', values: [0, 1, 0], color: '#3b82f6' }, { name: 'y', values: [1, 1, 1], color: '#f43f5e' }],
      lo: 0,
      hi: 2,
    });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect((svg.match(/<polyline/g) ?? []).length).toBe(2);
    expect(svg).toContain('>x</text>');
    expect(svg).toContain('#3b82f6');
  });

  it('escapes names so the document stays well-formed', () => {
    const svg = plotSvg({ ...base, title: 'a<b & "c"', time: [0, 1], columns: [{ name: '<x>&', values: [1, 2], color: '#000' }], lo: 0, hi: 1 });
    expect(svg).not.toContain('<x>');
    expect(svg).toContain('a&lt;b &amp; &quot;c&quot;');
  });

  it('keeps file size bounded for a million-point series by drawing per-pixel envelopes', () => {
    const n = 1_000_000;
    const time = new Float64Array(n).map((_, i) => i / 1000);
    const values = new Float64Array(n).map((_, i) => Math.sin(i / 500));
    const svg = plotSvg({ ...base, time, columns: [{ name: 's', values, color: '#10b981' }], lo: 0, hi: 1000 });
    const pts = svg.match(/points="([^"]*)"/)![1]!.split(' ').length;
    expect(pts).toBeLessThanOrEqual(2 * (900 - 64 - 16));
    expect(svg.length).toBeLessThan(120_000);
  });

  it('draws only the visible range and tolerates no data at all', () => {
    const svg = plotSvg({ ...base, time: seq(100), columns: [{ name: 'v', values: seq(100), color: '#000' }], lo: 10, hi: 12 });
    expect(svg.match(/points="([^"]*)"/)![1]!.split(' ')).toHaveLength(3);
    const empty = plotSvg({ ...base, time: [], columns: [], lo: 0, hi: 1 });
    expect(empty).toContain('</svg>');
    expect(plotSvg({ ...base, time: [0], columns: [{ name: 'v', values: [null], color: '#000' }], lo: 0, hi: 1 })).not.toContain('<polyline');
  });

  it('handles a flat series without dividing by zero', () => {
    const svg = plotSvg({ ...base, time: [0, 1], columns: [{ name: 'c', values: [5, 5], color: '#000' }], lo: 0, hi: 1 });
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('Infinity');
  });
});

describe('plotFilename', () => {
  it('makes a safe name from the bag and topic', () => {
    expect(plotFilename('run 1.mcap', '/robot/odom', 'svg')).toBe('run 1__robot_odom__plot.svg');
    expect(plotFilename('a.bag', '///x y', 'csv')).toBe('a__x_y__plot.csv');
  });
});
