/**
 * The zoom window on the timeline: which slice of the whole recording the bar
 * currently shows. Kept as fractions of the whole range (0 to 1), so it needs no
 * bigint arithmetic and survives a resize; the Timeline turns fractions back
 * into times.
 */

export interface TimelineView {
  lo: number;
  hi: number;
}

export const FULL_VIEW: TimelineView = { lo: 0, hi: 1 };

/** The tightest window: a millisecond is as fine as the data gets. */
const MIN_VIEW_NS = 1e6;

export const isFullView = (v: TimelineView): boolean => v.lo <= 0 && v.hi >= 1;

/** Smallest window, as a fraction of a recording `durationNs` long. */
export function minSpanFor(durationNs: number): number {
  return durationNs > 0 ? Math.min(1, MIN_VIEW_NS / durationNs) : 1;
}

/** Keep a window inside [0, 1] and no tighter than `minSpan`, preserving its width where possible. */
export function clampView(v: TimelineView, minSpan: number): TimelineView {
  const raw = v.hi - v.lo;
  if (!Number.isFinite(raw) || !Number.isFinite(v.lo)) return FULL_VIEW;
  const span = Math.min(1, Math.max(minSpan, raw));
  if (span >= 1 - 1e-9) return FULL_VIEW;
  const lo = Math.min(Math.max(0, v.lo), 1 - span);
  return { lo, hi: lo + span };
}

/** Window fraction (0 to 1 across the bar) to a fraction of the whole recording. */
export const viewAt = (v: TimelineView, f: number): number => v.lo + f * (v.hi - v.lo);

/** Fraction of the whole recording to a position across the bar; outside 0..1 when off screen. */
export const viewFraction = (v: TimelineView, g: number): number => (g - v.lo) / (v.hi - v.lo);

/** `zoom` of 8 means the bar shows an eighth of the recording. */
export const zoomLevel = (v: TimelineView): number => 1 / (v.hi - v.lo);

/**
 * Scale the window's width by `factor` (below 1 zooms in) while the point under
 * `anchor` (0 to 1 across the bar) stays where it is.
 */
export function zoomView(v: TimelineView, anchor: number, factor: number, minSpan: number): TimelineView {
  const g = viewAt(v, anchor);
  const span = Math.min(1, Math.max(minSpan, (v.hi - v.lo) * factor));
  const lo = g - anchor * span;
  return clampView({ lo, hi: lo + span }, minSpan);
}

/** Slide the window by `delta`, a fraction of the whole recording. */
export function panView(v: TimelineView, delta: number, minSpan: number): TimelineView {
  return clampView({ lo: v.lo + delta, hi: v.hi + delta }, minSpan);
}

/**
 * Two-finger gesture: the window is `startSpan * scale` wide and the point that
 * was under the fingers when it started (`anchorG`, whole-recording fraction)
 * follows the fingers' midpoint, now at `midFrac` across the bar. One formula
 * covers pinching and two-finger panning together.
 */
export function pinchView(anchorG: number, midFrac: number, startSpan: number, scale: number, minSpan: number): TimelineView {
  const span = Math.min(1, Math.max(minSpan, startSpan * scale));
  const lo = anchorG - midFrac * span;
  return clampView({ lo, hi: lo + span }, minSpan);
}

/** Bring `g` into view if it is off screen, leaving it near the left edge so playback has room to run. */
export function followView(v: TimelineView, g: number, minSpan: number): TimelineView {
  if (g >= v.lo && g <= v.hi) return v;
  const span = v.hi - v.lo;
  return clampView({ lo: g - 0.15 * span, hi: g - 0.15 * span + span }, minSpan);
}
