import type { AllTopicStats } from '../types/bag';

/** Bucket count for the timeline density strip. */
export const DENSITY_BUCKETS = 200;

/**
 * Bin every topic's message timestamps into `bucketCount` buckets spanning
 * [0, durationNs], normalized to [0, 1] against the busiest bucket.
 *
 * `times` in each topic's stats are nanoseconds since bag start (see
 * `MessageStats`), so no bag-start offset needs subtracting here.
 */
export function computeMessageDensity(
  stats: AllTopicStats,
  durationNs: number,
  bucketCount: number = DENSITY_BUCKETS,
): Float32Array {
  const buckets = new Float32Array(bucketCount);
  if (durationNs <= 0) return buckets;
  for (const topic of Object.values(stats)) {
    for (let i = 0; i < topic.times.length; i++) {
      const frac = topic.times[i] / durationNs;
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
