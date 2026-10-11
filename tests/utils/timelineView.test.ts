import { describe, expect, it } from 'vitest';
import {
  FULL_VIEW, clampView, followView, isFullView, minSpanFor, panView, pinchView, viewAt, viewFraction, zoomLevel, zoomView,
} from '../../src/utils/timelineView';
import { computeMessageDensity } from '../../src/utils/messageDensity';

const MIN = 0.001;

describe('timeline zoom window', () => {
  it('zooming keeps the point under the cursor where it was', () => {
    for (const anchor of [0, 0.25, 0.5, 0.9, 1]) {
      const before: { lo: number; hi: number } = { lo: 0.2, hi: 0.8 };
      const g = viewAt(before, anchor);
      const after = zoomView(before, anchor, 0.5, MIN);
      expect(viewFraction(after, g)).toBeCloseTo(anchor, 9);
      expect(after.hi - after.lo).toBeCloseTo(0.3, 9);
    }
  });

  it('zooms in from the full view and back out to it', () => {
    const z = zoomView(FULL_VIEW, 0.5, 0.25, MIN);
    expect(z.lo).toBeCloseTo(0.375, 9);
    expect(zoomLevel(z)).toBeCloseTo(4, 9);
    expect(isFullView(zoomView(z, 0.5, 8, MIN))).toBe(true);
  });

  it('cannot zoom past the minimum span, and an edge anchor stays put while it clamps', () => {
    let v = FULL_VIEW;
    for (let i = 0; i < 100; i++) v = zoomView(v, 0, 0.5, MIN);
    expect(v.hi - v.lo).toBeCloseTo(MIN, 9);
    expect(v.lo).toBeCloseTo(0, 9);
  });

  it('zooming out near an edge stays inside the recording and keeps its width', () => {
    const v = zoomView({ lo: 0.9, hi: 1 }, 1, 3, MIN);
    expect(v.hi).toBeCloseTo(1, 9);
    expect(v.hi - v.lo).toBeCloseTo(0.3, 9);
  });

  it('panning slides the window and stops at both ends without changing its width', () => {
    const v = { lo: 0.4, hi: 0.5 };
    expect(panView(v, 0.2, MIN)).toEqual({ lo: expect.closeTo(0.6, 9), hi: expect.closeTo(0.7, 9) });
    const end = panView(v, 5, MIN);
    expect(end.hi).toBeCloseTo(1, 9);
    expect(end.hi - end.lo).toBeCloseTo(0.1, 9);
    const start = panView(v, -5, MIN);
    expect(start.lo).toBe(0);
    expect(start.hi - start.lo).toBeCloseTo(0.1, 9);
  });

  it('clampView repairs nonsense instead of passing it on', () => {
    expect(clampView({ lo: NaN, hi: 1 }, MIN)).toEqual(FULL_VIEW);
    expect(clampView({ lo: 0.5, hi: 0.4 }, MIN).hi - clampView({ lo: 0.5, hi: 0.4 }, MIN).lo).toBeCloseTo(MIN, 9);
    expect(clampView({ lo: -3, hi: 9 }, MIN)).toEqual(FULL_VIEW);
    expect(clampView({ lo: 0.9995, hi: 1.2 }, MIN).hi).toBeLessThanOrEqual(1);
  });

  it('a pinch zooms by the finger spread and drags with the midpoint', () => {
    const start = { lo: 0.2, hi: 0.6 };
    const anchorG = viewAt(start, 0.5); // fingers started over the middle
    // Fingers twice as far apart (scale 0.5), midpoint unmoved: the same point stays under them.
    const zoomed = pinchView(anchorG, 0.5, 0.4, 0.5, MIN);
    expect(viewFraction(zoomed, anchorG)).toBeCloseTo(0.5, 9);
    expect(zoomed.hi - zoomed.lo).toBeCloseTo(0.2, 9);
    // Same spread, midpoint moved right by a tenth of the bar: the window slides left under the fingers.
    const dragged = pinchView(anchorG, 0.6, 0.4, 1, MIN);
    expect(viewFraction(dragged, anchorG)).toBeCloseTo(0.6, 9);
    expect(dragged.hi - dragged.lo).toBeCloseTo(0.4, 9);
  });

  it('follows the playhead off screen, leaving room ahead of it, and leaves it alone when visible', () => {
    const v = { lo: 0.2, hi: 0.3 };
    expect(followView(v, 0.25, MIN)).toBe(v);
    const f = followView(v, 0.31, MIN);
    expect(viewFraction(f, 0.31)).toBeCloseTo(0.15, 9);
    expect(followView(v, 0.05, MIN).lo).toBeCloseTo(0.05 - 0.015, 9);
    expect(followView({ lo: 0.8, hi: 0.9 }, 1, MIN).hi).toBeCloseTo(1, 9); // clamps at the end
  });

  it('the tightest window is a millisecond of the recording', () => {
    expect(minSpanFor(10e9)).toBeCloseTo(1e-4, 12);
    expect(minSpanFor(0)).toBe(1);
    expect(minSpanFor(1e5)).toBe(1); // a recording shorter than a millisecond cannot zoom
  });
});

describe('message density for a zoom window', () => {
  const stats = { '/a': { times: [0, 100, 250, 500, 900, 1000], count: 6 } } as never;

  it('bins only what falls inside the window, across the window', () => {
    // Whole recording: 1000 ns. Window: the second half.
    const d = computeMessageDensity(stats, 1000, 2, { lo: 0.5, hi: 1 });
    expect(Array.from(d)).toEqual([0.5, 1]); // 500 alone in the first bucket; 900 and 1000 in the second
    const first = computeMessageDensity(stats, 1000, 2, { lo: 0, hi: 0.5 });
    expect(Array.from(first)).toEqual([1, 1]); // 0 and 100, then 250 and the 500 at the very edge
  });

  it('is unchanged without a window', () => {
    expect(Array.from(computeMessageDensity(stats, 1000, 2))).toEqual(Array.from(computeMessageDensity(stats, 1000, 2, { lo: 0, hi: 1 })));
  });
});
