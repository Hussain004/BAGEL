/**
 * Nanosecond timestamp utilities for ROS2 bag files.
 * ROS2 timestamps are int64 nanoseconds since epoch.
 * We use BigInt to avoid precision loss above 2^53.
 */

export type NanosecondTimestamp = bigint;

/** Convert nanoseconds to seconds (lossy for display) */
export function nsToSeconds(ns: NanosecondTimestamp): number {
  return Number(ns / 1_000_000n) / 1_000;
}

/** Format a duration in seconds to a human-readable string */
export function formatDuration(seconds: number): string {
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) return `${mins}m ${secs.toFixed(0)}s`;
  const hours = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hours}h ${remainMins}m`;
}

/** Format a nanosecond timestamp as a relative time from bag start */
export function formatRelativeTime(
  ns: NanosecondTimestamp,
  startNs: NanosecondTimestamp
): string {
  const relativeSeconds = nsToSeconds(ns - startNs);
  return `${relativeSeconds.toFixed(3)}s`;
}

/** Format a nanosecond timestamp as an absolute ISO date string */
export function formatAbsoluteTime(ns: NanosecondTimestamp): string {
  const ms = Number(ns / 1_000_000n);
  return new Date(ms).toISOString();
}

/** Interpolate a playhead position between start and end timestamps */
export function interpolatePlayhead(
  startNs: NanosecondTimestamp,
  endNs: NanosecondTimestamp,
  fraction: number // 0.0 to 1.0
): NanosecondTimestamp {
  const range = endNs - startNs;
  return startNs + BigInt(Math.floor(Number(range) * Math.max(0, Math.min(1, fraction))));
}
