import type { AllTopicStats } from '../types/bag';

/** Bucket count for the timeline density strip. */
export const DENSITY_BUCKETS = 200;

/**
 * Bin every topic's message timestamps into `bucketCount` buckets spanning
 * [0, durationNs] (or the `window` slice of it), normalized to [0, 1] against the busiest bucket.
 *
 * `times` in each topic's stats are nanoseconds since bag start (see
 * `MessageStats`), so no bag-start offset needs subtracting here.
 */
export function computeMessageDensity(
  stats: AllTopicStats,
  durationNs: number,
  bucketCount: number = DENSITY_BUCKETS,
  /** Zoom window as fractions of the whole range; the buckets then span just this slice. */
  window: { lo: number; hi: number } = { lo: 0, hi: 1 },
): Float32Array {
  const buckets = new Float32Array(bucketCount);
  if (durationNs <= 0 || !(window.hi > window.lo)) return buckets;
  const width = window.hi - window.lo;
  for (const topic of Object.values(stats)) {
    for (let i = 0; i < topic.times.length; i++) {
      const frac = (topic.times[i] / durationNs - window.lo) / width;
      if (frac < 0 || frac > 1 || !Number.isFinite(frac)) continue;
      const bucket = Math.min(bucketCount - 1, Math.floor(frac * bucketCount));
      buckets[bucket]++;
    }
  }
  let max = 0;
  for (let i = 0; i < buckets.length; i++) if (buckets[i] > max) max = buckets[i];
  if (max > 0) {
    for (let i = 0; i < buckets.length; i++) buckets[i] /= max;
  }
  return buckets;
}
