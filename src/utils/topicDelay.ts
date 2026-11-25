/**
 * Per-topic delay: how long after its `header.stamp` each message was logged.
 * "Why is my control loop late" usually reads straight off this: a steady
 * offset is transport or a clock difference, a long tail is a stalled
 * publisher or a busy executor.
 */

import type { BagFormat } from '../types/bag';
import type { BagSource } from '../parsers/source';
import type { RangeResult } from '../parsers/range';
import { headerStampNs } from './frameExport';

export interface DelayStats {
  /** Messages with a usable stamp. */
  n: number;
  /** Sampled messages with no header, or a zero stamp (never filled in). */
  unstamped: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  /** Counts in `bins.length` equal-width bins from minMs to maxMs. */
  bins: number[];
}

/** Log time minus header stamp over the sampled messages; null when none had a stamp. */
export function delayStats(messages: RangeResult['messages'], binCount = 16): DelayStats | null {
  const delays: number[] = [];
  let unstamped = 0;
  for (const m of messages) {
    const stamp = headerStampNs(m.value);
    if (!stamp || stamp === '0') {
      unstamped++;
      continue;
    }
    delays.push(Number(m.timestamp - BigInt(stamp)) / 1e6);
  }
  if (delays.length === 0) return null;
  delays.sort((a, b) => a - b);
  const rank = (q: number) => delays[Math.min(delays.length - 1, Math.ceil(q * delays.length) - 1)]!;
  const minMs = delays[0]!;
  const maxMs = delays[delays.length - 1]!;
  const bins = new Array<number>(binCount).fill(0);
  const width = (maxMs - minMs) / binCount;
  for (const d of delays) bins[width > 0 ? Math.min(binCount - 1, Math.floor((d - minMs) / width)) : 0]!++;
  return { n: delays.length, unstamped, minMs, p50Ms: rank(0.5), p95Ms: rank(0.95), maxMs, bins };
}

/** Most messages to decode for one topic, and the most bytes (an image topic must not ship gigabytes). */
const MAX_SAMPLES = 500;
const MAX_SAMPLE_BYTES = 64 * 1024 * 1024;

/** How many messages to sample, spread evenly over the bag. */
export function delaySampleCount(count: number, bytesPerMessage: number): number {
  const byBytes = Math.floor(MAX_SAMPLE_BYTES / Math.max(1, bytesPerMessage));
  return Math.max(1, Math.min(count, MAX_SAMPLES, Math.max(20, byBytes)));
}

type RangeReader = (source: BagSource, format: BagFormat, topic: string, range: {
  startNs: bigint; endNs: bigint; stride: number; phase: number; max: number;
}) => Promise<RangeResult>;

/** Sample `samples` messages of a topic evenly across [startNs, endNs] and measure their delay. */
export async function measureTopicDelay(
  read: RangeReader,
  source: BagSource,
  format: BagFormat,
  topic: string,
  count: number,
  samples: number,
  startNs: bigint,
  endNs: bigint,
): Promise<DelayStats | null> {
  const stride = Math.max(1, Math.ceil(count / samples));
  const all: RangeResult['messages'] = [];
  let start = startNs;
  let phase = 0;
  for (;;) {
    const res = await read(source, format, topic, { startNs: start, endNs, stride, phase, max: samples });
    all.push(...res.messages);
    if (res.nextStartNs === null || all.length >= samples) break;
    start = res.nextStartNs;
    phase = res.phase;
  }
  return delayStats(all);
}
