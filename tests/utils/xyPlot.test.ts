import { describe, expect, it } from 'vitest';
import { buildXY, nearestByTime, nearestOnScreen, xyBounds } from '../../src/utils/xyPlot';

describe('buildXY', () => {
  it('pairs two columns on a shared axis', () => {
    const p = buildXY([0, 1, 2], [1, 2, 3], [10, 20, 30], 0, 2, false);
    expect(Array.from(p.x)).toEqual([1, 2, 3]);
    expect(Array.from(p.y)).toEqual([10, 20, 30]);
    expect(Array.from(p.t)).toEqual([0, 1, 2]);
  });

  it('skips rows missing either value when not holding', () => {
    const p = buildXY([0, 1, 2, 3], [1, null, 3, 4], [10, 20, null, 40], 0, 3, false);
    expect(Array.from(p.t)).toEqual([0, 3]);
  });

  it('holds each column forward across topics so sparse rows still pair', () => {
    // x publishes at t=0,2,4; y at t=1,3: with no hold only nothing lines up.
    const time = [0, 1, 2, 3, 4];
    const x = [1, null, 2, null, 3];
    const y = [null, 10, null, 20, null];
    expect(buildXY(time, x, y, 0, 4, false).t).toHaveLength(0);
    const held = buildXY(time, x, y, 0, 4, true);
    // Rows before y's first sample have no y yet, so they are dropped.
    expect(Array.from(held.t)).toEqual([1, 2, 3, 4]);
    expect(Array.from(held.x)).toEqual([1, 2, 2, 3]);
    expect(Array.from(held.y)).toEqual([10, 10, 20, 20]);
  });

  it('only keeps the visible range, inclusive', () => {
    const p = buildXY([0, 1, 2, 3, 4], [0, 1, 2, 3, 4], [0, 1, 2, 3, 4], 1, 3, false);
    expect(Array.from(p.t)).toEqual([1, 2, 3]);
  });

  it('drops non-finite values and tolerates mismatched lengths', () => {
    const p = buildXY([0, 1, 2, 3], [1, NaN, 3, 4, 5], [1, 2, Infinity, 4], 0, 3, false);
    expect(Array.from(p.t)).toEqual([0, 3]);
  });

  it('handles empty input and a million rows', () => {
    expect(buildXY([], [], [], 0, 1, false).x).toHaveLength(0);
    const n = 1_000_000;
    const t = new Float64Array(n).map((_, i) => i);
    const col = Array.from({ length: n }, (_, i) => i);
    expect(buildXY(t, col, col, 0, n, false).x).toHaveLength(n);
  });
});

describe('xyBounds', () => {
  const pts = (x: number[], y: number[]) => ({ x: Float64Array.from(x), y: Float64Array.from(y), t: Float64Array.from(x) });

  it('covers the data with padding', () => {
    const b = xyBounds([pts([0, 10], [0, 4])], false)!;
    expect(b.xMin).toBeLessThan(0);
    expect(b.xMax).toBeGreaterThan(10);
    expect(b.yMax).toBeGreaterThan(4);
  });

  it('is null for no points, and spans several series', () => {
    expect(xyBounds([], false)).toBeNull();
    expect(xyBounds([pts([], [])], false)).toBeNull();
    const b = xyBounds([pts([0, 1], [0, 1]), pts([5, 6], [-3, 9])], false)!;
    expect(b.xMax).toBeGreaterThan(6);
    expect(b.yMin).toBeLessThan(-3);
  });

  it('widens a constant series instead of producing a zero-width range', () => {
    const b = xyBounds([pts([5, 5], [7, 7])], false)!;
    expect(b.xMax).toBeGreaterThan(b.xMin);
    expect(b.yMax).toBeGreaterThan(b.yMin);
  });

  it('gives equal pixels per unit on both axes, whatever the plot shape', () => {
    // 600x300 px plot area (aspect 2): a data unit must span the same pixels on x and y.
    for (const aspect of [1, 2, 0.5, 3.7]) {
      for (const data of [pts([0, 100], [0, 1]), pts([0, 1], [0, 100]), pts([-2, 2], [-2, 2])]) {
        const b = xyBounds([data], true, aspect)!;
        const pxPerUnitX = aspect / (b.xMax - b.xMin);
        const pxPerUnitY = 1 / (b.yMax - b.yMin);
        expect(pxPerUnitX).toBeCloseTo(pxPerUnitY, 9);
      }
    }
  });

  it('keeps the data centred and fully visible under equal scale', () => {
    const b = xyBounds([pts([0, 100], [0, 1])], true, 2)!;
    expect((b.yMin + b.yMax) / 2).toBeCloseTo(0.5, 9);
    expect((b.xMin + b.xMax) / 2).toBeCloseTo(50, 9);
    expect(b.xMin).toBeLessThanOrEqual(0);
    expect(b.xMax).toBeGreaterThanOrEqual(100);
    expect(b.yMin).toBeLessThanOrEqual(0);
    expect(b.yMax).toBeGreaterThanOrEqual(1);
  });

  it('ignores a nonsensical aspect instead of producing NaN bounds', () => {
    for (const aspect of [0, -1, NaN, Infinity]) {
      const b = xyBounds([pts([0, 1], [0, 1])], true, aspect)!;
      expect(Number.isFinite(b.xMin + b.xMax + b.yMin + b.yMax)).toBe(true);
    }
  });
});

describe('nearest lookups', () => {
  it('finds the closest time, with ties going to the first', () => {
    expect(nearestByTime([0, 1, 2, 3], 1.4)).toBe(1);
    expect(nearestByTime([0, 1, 2, 3], 1.6)).toBe(2);
    expect(nearestByTime([0, 2], 1)).toBe(0);
    expect(nearestByTime([], 1)).toBe(-1);
  });
  it('finds the closest screen point only within the radius', () => {
    const sx = [10, 100, 200];
    const sy = [10, 100, 200];
    expect(nearestOnScreen(sx, sy, 98, 102, 12)).toBe(1);
    expect(nearestOnScreen(sx, sy, 150, 150, 12)).toBe(-1);
    expect(nearestOnScreen([], [], 0, 0, 12)).toBe(-1);
  });
});
