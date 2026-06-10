import type { AllTopicStats, MessageStats } from '../types/bag';

export type { AllTopicStats, MessageStats };

export interface TopicHealth {
  topic: string;
  count: number;
  durationSec: number;
  meanHz: number;
  medianPeriodSec: number;
  jitterSec: number;
  gapCount: number;
  gaps: Array<{ atNs: number; gapSec: number }>;
  bandwidthBytesPerSec: number;
  rateOverTime: { t: Float64Array; hz: Float64Array };
}

const RATE_WINDOWS = 20;
const GAP_THRESHOLD_MULTIPLE = 3;
const MIN_GAP_SEC = 0.05;

export function computeTopicHealth(topic: string, stats: MessageStats): TopicHealth {
  const { times, sizes } = stats;
  const n = times.length;

  if (n === 0) {
    return {
      topic, count: 0, durationSec: 0, meanHz: 0, medianPeriodSec: 0,
      jitterSec: 0, gapCount: 0, gaps: [], bandwidthBytesPerSec: 0,
      rateOverTime: { t: new Float64Array(0), hz: new Float64Array(0) },
    };
  }

  const durationNs = times[n - 1] - times[0];
  const durationSec = durationNs / 1e9;
  const meanHz = durationSec > 0 ? (n - 1) / durationSec : 0;

  // Inter-arrival periods
  const periods = new Float64Array(n - 1);
  for (let i = 1; i < n; i++) periods[i - 1] = (times[i] - times[i - 1]) / 1e9;

  // Median period via sorted copy
  const sorted = Float64Array.from(periods).sort();
  const medianPeriodSec = n > 1 ? sorted[Math.floor(sorted.length / 2)] : 0;

  // Jitter = std dev of inter-arrival periods
  let jitterSec = 0;
  if (periods.length > 1) {
    let sum = 0;
    for (let i = 0; i < periods.length; i++) sum += periods[i];
    const mean = sum / periods.length;
    let sqSum = 0;
    for (let i = 0; i < periods.length; i++) sqSum += (periods[i] - mean) ** 2;
    jitterSec = Math.sqrt(sqSum / periods.length);
  }

  // Gaps: periods exceeding GAP_THRESHOLD_MULTIPLE * median and at least MIN_GAP_SEC
  const gapThreshold = medianPeriodSec * GAP_THRESHOLD_MULTIPLE;
  const gaps: Array<{ atNs: number; gapSec: number }> = [];
  for (let i = 0; i < periods.length; i++) {
    if (periods[i] > gapThreshold && periods[i] > MIN_GAP_SEC) {
      gaps.push({ atNs: times[i], gapSec: periods[i] });
    }
  }

  // Total bandwidth
  let totalBytes = 0;
  for (let i = 0; i < sizes.length; i++) totalBytes += sizes[i];
  const bandwidthBytesPerSec = durationSec > 0 ? totalBytes / durationSec : 0;

  const rateOverTime = computeRateOverTime(times);

  return {
    topic, count: n, durationSec, meanHz, medianPeriodSec,
    jitterSec, gapCount: gaps.length, gaps,
    bandwidthBytesPerSec, rateOverTime,
  };
}

function computeRateOverTime(times: Float64Array): { t: Float64Array; hz: Float64Array } {
  const n = times.length;
  if (n < 2) return { t: new Float64Array(0), hz: new Float64Array(0) };

  const startNs = times[0];
  const endNs = times[n - 1];
  const totalNs = endNs - startNs;
  const windowNs = totalNs / RATE_WINDOWS;
  if (windowNs <= 0) return { t: new Float64Array(0), hz: new Float64Array(0) };

  const t = new Float64Array(RATE_WINDOWS);
  const hz = new Float64Array(RATE_WINDOWS);

  for (let w = 0; w < RATE_WINDOWS; w++) {
    const wStart = startNs + w * windowNs;
    const wEnd = wStart + windowNs;
    t[w] = (wStart + windowNs / 2) / 1e9;

    // Binary search for the window boundaries
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < wStart) lo = mid + 1; else hi = mid;
    }
    const firstIdx = lo;
    lo = 0; hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < wEnd) lo = mid + 1; else hi = mid;
    }
    hz[w] = (lo - firstIdx) / (windowNs / 1e9);
  }

  return { t, hz };
}

export function computeAllTopicHealth(stats: AllTopicStats): TopicHealth[] {
  return Object.entries(stats).map(([topic, s]) => computeTopicHealth(topic, s));
}
