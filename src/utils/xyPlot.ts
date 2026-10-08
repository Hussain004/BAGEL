/**
 * Geometry for the XY (field vs field) plot.
 *
 * Plotting one field against another covers a controller's phase plot, a
 * position's x against y, and a motor's current against speed. The path is
 * coloured by time so direction is readable, and the playhead is a marker on
 * the sample nearest it. Pure and DOM-free so the pairing and scaling rules can
 * be tested without a canvas.
 */

import { holdForward } from './alignSeries';

export interface XYPoints {
  x: Float64Array;
  y: Float64Array;
  /** Time of each point on the plot's time axis (seconds). */
  t: Float64Array;
}

/**
 * Pair two columns into points inside `lo <= t <= hi`.
 *
 * `hold` carries each column's last value forward first. It is needed when the
 * columns come from different topics: on the union time axis a row where only
 * one topic published has no partner, so without holding almost every row would
 * be dropped. Without it (one topic), a row missing either value is skipped.
 */
export function buildXY(
  time: ArrayLike<number>,
  xCol: ReadonlyArray<number | null>,
  yCol: ReadonlyArray<number | null>,
  lo: number,
  hi: number,
  hold: boolean,
): XYPoints {
  const xs = hold ? holdForward(xCol) : xCol;
  const ys = hold ? holdForward(yCol) : yCol;
  const n = Math.min(time.length, xs.length, ys.length);
  const x: number[] = [];
  const y: number[] = [];
  const t: number[] = [];
  for (let i = 0; i < n; i++) {
    const ti = time[i]!;
    const xv = xs[i];
    const yv = ys[i];
    if (!(ti >= lo && ti <= hi)) continue;
    if (xv === null || xv === undefined || yv === null || yv === undefined) continue;
    if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
    x.push(xv);
    y.push(yv);
    t.push(ti);
  }
  return { x: Float64Array.from(x), y: Float64Array.from(y), t: Float64Array.from(t) };
}

export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/**
 * Axis bounds covering every point, padded 5%. A constant series would give a
 * zero-width range, which divides by zero when mapping to pixels, so it is
 * widened.
 *
 * With `equalScale`, one data unit spans the same number of PIXELS on both axes,
 * so a circle in the data is a circle on screen (what you want for x vs y
 * position). That depends on the plot area's shape, not just the data's:
 * `aspect` is the plot area's width over its height, and the axis that would
 * otherwise be squashed is widened to match.
 */
export function xyBounds(points: readonly XYPoints[], equalScale: boolean, aspect = 1): Bounds | null {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const p of points) {
    for (let i = 0; i < p.x.length; i++) {
      const x = p.x[i]!;
      const y = p.y[i]!;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  if (!Number.isFinite(xMin)) return null;
  if (xMin === xMax) {
    xMin -= 1;
    xMax += 1;
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  if (equalScale && aspect > 0 && Number.isFinite(aspect)) {
    const xMid = (xMin + xMax) / 2;
    const yMid = (yMin + yMax) / 2;
    let xSpan = xMax - xMin;
    let ySpan = yMax - yMin;
    // Equal pixels per unit means xSpan / pw == ySpan / ph, i.e. xSpan / ySpan == aspect.
    if (xSpan / ySpan < aspect) xSpan = ySpan * aspect;
    else ySpan = xSpan / aspect;
    xMin = xMid - xSpan / 2;
    xMax = xMid + xSpan / 2;
    yMin = yMid - ySpan / 2;
    yMax = yMid + ySpan / 2;
  }
  const px = (xMax - xMin) * 0.05;
  const py = (yMax - yMin) * 0.05;
  return { xMin: xMin - px, xMax: xMax + px, yMin: yMin - py, yMax: yMax + py };
}

/** Index of the point whose time is closest to `t`, or -1 for no points. */
export function nearestByTime(times: ArrayLike<number>, t: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < times.length; i++) {
    const d = Math.abs(times[i]! - t);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Index of the point nearest a screen position, or -1 if none is within `maxDist` pixels. */
export function nearestOnScreen(
  sx: ArrayLike<number>,
  sy: ArrayLike<number>,
  px: number,
  py: number,
  maxDist: number,
): number {
  let best = -1;
  let bestD = maxDist * maxDist;
  for (let i = 0; i < sx.length; i++) {
    const dx = sx[i]! - px;
    const dy = sy[i]! - py;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

