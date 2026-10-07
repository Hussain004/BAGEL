/**
 * Split recordings: one logical bag stored as several files.
 *
 * `ros2 bag record --max-bag-size` / `--max-bag-duration` writes a directory
 * of `name_0.mcap`, `name_1.mcap`, ... and ROS1 `rosbag record --split` does
 * the same with `.bag`. Each part is a complete, independently indexed file,
 * so rather than teaching three format readers about multi-file input this
 * module sits in front of them: it parses every part once, merges the
 * summaries, and routes each read to the part(s) that hold the data.
 *
 * Things deliberately NOT assumed:
 *  - Channel and schema ids. Every MCAP file numbers its own, so nothing here
 *    merges by id; parts are only ever combined by topic name.
 *  - Parts being disjoint in time. Neighbours can overlap at a split
 *    boundary, so reads that need ordering sort by timestamp.
 *  - Parts arriving in order. They are sorted by start time.
 *  - Every part having every topic, or the same type for a topic.
 *
 * `core.ts` imports this module and this module imports `core.ts` for the
 * single-file readers. That cycle is safe because nothing runs at module
 * load: every use is inside a function body.
 */

import type {
  AllTopicStats,
  BagFormat,
  BagSummary,
  RawMessage,
  TopicInfo,
} from '../types/bag';
import {
  readAllMessageStats as readAllMessageStatsSingle,
  readDeserializedMessages as readDeserializedMessagesSingle,
  readLaserScanAtTime as readLaserScanAtTimeSingle,
  readMessageAtTime as readMessageAtTimeSingle,
  readRawMessages as readRawMessagesSingle,
  readVideoChunkRange as readVideoChunkRangeSingle,
  readVideoChunksAtTime as readVideoChunksAtTimeSingle,
  getTopicType as getTopicTypeSingle,
  parseBag as parseBagSingle,
  detectFormat as detectFormatSingle,
} from './core';
import { sourceKey, sourceDisplayName } from './source';
import type { MultiBagSource, SingleBagSource } from './source';
import type { VideoChunksResult } from './video';

const SPLITTABLE: readonly BagFormat[] = ['mcap', 'db3', 'bag'];

interface Part {
  source: SingleBagSource;
  summary: BagSummary;
  topics: Set<string>;
}

interface Loaded {
  parts: Part[];
  format: BagFormat;
  summary: BagSummary;
}

const loadedCache = new Map<string, Promise<Loaded>>();

export function disposeMultiCache(): void {
  loadedCache.clear();
}

/** Merge per-part summaries. Pure, exported for tests. */
export function mergeSummaries(displayName: string, parts: BagSummary[]): BagSummary {
  const first = parts[0]!;
  let start = first.startTime;
  let end = first.endTime;
  let totalMessageCount = 0;
  let fileSize = 0;
  const topics = new Map<string, TopicInfo>();
  for (const p of parts) {
    if (p.startTime < start) start = p.startTime;
    if (p.endTime > end) end = p.endTime;
    totalMessageCount += p.totalMessageCount;
    fileSize += p.fileSize;
    for (const t of p.topics) {
      const existing = topics.get(t.name);
      if (existing) existing.messageCount += t.messageCount;
      else topics.set(t.name, { ...t });
    }
  }
  const duration = Number(end - start) / 1e9;
  for (const t of topics.values()) {
    if (t.frequency !== undefined) t.frequency = duration > 0 ? t.messageCount / duration : t.frequency;
  }
  return {
    ...first,
    fileName: displayName,
    fileSize,
    startTime: start,
    endTime: end,
    duration,
    totalMessageCount,
    topics: [...topics.values()],
  };
}

async function load(multi: MultiBagSource): Promise<Loaded> {
  const key = sourceKey(multi);
  const hit = loadedCache.get(key);
  if (hit) return hit;
  const promise = (async (): Promise<Loaded> => {
    if (multi.parts.length === 0) throw new Error('A split recording needs at least one file.');
    const parts: Part[] = [];
    let format: BagFormat | null = null;
    // Sequential on purpose: .db3 parts are loaded whole into memory, and
    // parsing them in parallel would multiply the peak.
    for (const source of multi.parts) {
      // Check the container before parsing so a stray file gets a message
      // that names it, not that format's own parse error.
      const detected = await detectFormatSingle(source);
      if (detected === 'unknown' || !SPLITTABLE.includes(detected)) {
        throw new Error(
          `"${sourceDisplayName(source)}" is not an .mcap, .db3 or .bag file, so it cannot be combined into one recording.`,
        );
      }
      if (format && detected !== format) {
        throw new Error(
          `These files are not all the same format: "${sourceDisplayName(source)}" is ${detected} but the earlier parts are ${format}. Open them as separate bags instead.`,
        );
      }
      const summary = await parseBagSingle(source);
      format = summary.format;
      // An empty trailing part (recorder stopped right after rolling over) has
      // no time range, and a zero start would drag the merged range to 1970.
      if (summary.totalMessageCount === 0) continue;
      parts.push({ source, summary, topics: new Set(summary.topics.map((t) => t.name)) });
    }
    if (!format) throw new Error('A split recording needs at least one file.');
    if (parts.length === 0) {
      // Every part empty: surface the first one's (empty) summary.
      const empty = await parseBagSingle(multi.parts[0]!);
      return { parts: [], format, summary: { ...empty, fileName: multi.displayName } };
    }
    parts.sort((a, b) =>
      a.summary.startTime < b.summary.startTime ? -1 : a.summary.startTime > b.summary.startTime ? 1 : 0,
    );
    return { parts, format, summary: mergeSummaries(multi.displayName, parts.map((p) => p.summary)) };
  })();
  loadedCache.set(key, promise);
  promise.catch(() => loadedCache.delete(key));
  return promise;
}

export async function parseMulti(multi: MultiBagSource): Promise<BagSummary> {
  return (await load(multi)).summary;
}

export async function formatOfMulti(multi: MultiBagSource): Promise<BagFormat> {
  return (await load(multi)).format;
}

/**
 * Nearest-message lookup across parts, matching the single-file contract:
 * the first message at or after `timeNs`, else the latest one before it.
 */
export async function nearest<T extends { timestamp: bigint }>(
  multi: MultiBagSource,
  topicName: string,
  timeNs: bigint,
  read: (part: SingleBagSource) => Promise<T | null>,
): Promise<T | null> {
  const { parts } = await load(multi);
  const holders = parts.filter((p) => p.topics.has(topicName));
  let after: T | null = null;
  let before: T | null = null;
  let latestEnded: Part | null = null;

  for (const p of holders) {
    // Parts are sorted by start, so once we hold a message at or after t,
    // a part starting beyond it cannot contain anything closer.
    if (after && p.summary.startTime > after.timestamp) break;
    if (p.summary.endTime < timeNs) {
      // Wholly before t: only useful as the "latest before" fallback.
      if (!latestEnded || p.summary.endTime > latestEnded.summary.endTime) latestEnded = p;
      continue;
    }
    const m = await read(p.source);
    if (!m) continue;
    if (m.timestamp >= timeNs) {
      if (!after || m.timestamp < after.timestamp) after = m;
    } else if (!before || m.timestamp > before.timestamp) {
      before = m;
    }
  }
  if (after) return after;

  if (latestEnded) {
    const m = await read(latestEnded.source);
    if (m && (!before || m.timestamp > before.timestamp)) before = m;
  }
  return before;
}

export async function readMessageAtTimeMulti(
  multi: MultiBagSource,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
) {
  return nearest(multi, topicName, timeNs, (src) => readMessageAtTimeSingle(src, format, topicName, timeNs));
}

export async function readLaserScanAtTimeMulti(
  multi: MultiBagSource,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
) {
  return nearest(multi, topicName, timeNs, (src) => readLaserScanAtTimeSingle(src, format, topicName, timeNs));
}

export async function getTopicTypeMulti(
  multi: MultiBagSource,
  format: BagFormat,
  topicName: string,
): Promise<string | undefined> {
  const { parts } = await load(multi);
  for (const p of parts) {
    if (!p.topics.has(topicName)) continue;
    const type = await getTopicTypeSingle(p.source, format, topicName);
    if (type) return type;
  }
  return undefined;
}

function byTimestamp<T extends { timestamp: bigint }>(a: T, b: T): number {
  return a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0;
}

export async function readRawMessagesMulti(
  multi: MultiBagSource,
  format: BagFormat,
  topicName: string,
  limit?: number,
): Promise<RawMessage[]> {
  const { parts } = await load(multi);
  const out: RawMessage[] = [];
  for (const p of parts) {
    if (!p.topics.has(topicName)) continue;
    // Once we hold `limit` messages, a part starting after the limit-th one
    // cannot contribute (parts are sorted by start).
    if (limit !== undefined && out.length >= limit) {
      out.sort(byTimestamp);
      if (p.summary.startTime > out[limit - 1]!.timestamp) break;
    }
    out.push(...(await readRawMessagesSingle(p.source, format, topicName, limit)));
  }
  out.sort(byTimestamp);
  return limit === undefined ? out : out.slice(0, limit);
}

type Decoded = { timestamp: bigint; value: Record<string, unknown> | null };

export async function readDeserializedMessagesMulti(
  multi: MultiBagSource,
  format: BagFormat,
  topicName: string,
  limit?: number,
  onProgress?: (decoded: number) => void,
  onBatch?: (batch: Decoded[]) => void,
): Promise<Decoded[]> {
  const { parts } = await load(multi);
  const out: Decoded[] = [];
  for (const p of parts) {
    if (!p.topics.has(topicName)) continue;
    if (limit !== undefined && out.length >= limit) {
      out.sort(byTimestamp);
      if (p.summary.startTime > out[limit - 1]!.timestamp) break;
    }
    const base = out.length;
    const got = await readDeserializedMessagesSingle(
      p.source,
      format,
      topicName,
      limit,
      onProgress ? (n) => onProgress(base + n) : undefined,
      onBatch,
    );
    out.push(...got);
  }
  out.sort(byTimestamp);
  return limit === undefined ? out : out.slice(0, limit);
}

export async function readAllMessageStatsMulti(
  multi: MultiBagSource,
  format: BagFormat,
): Promise<AllTopicStats> {
  const { parts, summary } = await load(multi);
  const timeChunks = new Map<string, Float64Array[]>();
  const sizeChunks = new Map<string, Uint32Array[]>();
  for (const p of parts) {
    const stats = await readAllMessageStatsSingle(p.source, format);
    // Per-part stats are relative to that part's own start; shift onto the
    // merged start so the density strip and health table share one axis.
    const shift = Number(p.summary.startTime - summary.startTime);
    for (const [topic, { times, sizes }] of Object.entries(stats)) {
      const shifted = new Float64Array(times.length);
      for (let i = 0; i < times.length; i++) shifted[i] = times[i]! + shift;
      (timeChunks.get(topic) ?? timeChunks.set(topic, []).get(topic)!).push(shifted);
      (sizeChunks.get(topic) ?? sizeChunks.set(topic, []).get(topic)!).push(sizes);
    }
  }
  // Concatenated in part order, not re-sorted: the non-monotonic-stamp
  // check in Bag Health must keep seeing each file's own message order.
  const result: AllTopicStats = {};
  for (const [topic, chunks] of timeChunks) {
    const sizeParts = sizeChunks.get(topic)!;
    const times = new Float64Array(chunks.reduce((n, c) => n + c.length, 0));
    const sizes = new Uint32Array(times.length);
    let at = 0;
    chunks.forEach((c, i) => {
      times.set(c, at);
      sizes.set(sizeParts[i]!, at);
      at += c.length;
    });
    result[topic] = { times, sizes };
  }
  return result;
}

export async function readVideoChunksAtTimeMulti(
  multi: MultiBagSource,
  format: BagFormat,
  topicName: string,
  timeNs: bigint,
): Promise<VideoChunksResult | null> {
  // Latest part that starts at or before t and carries the topic; if that
  // part has no keyframe yet, fall back to earlier ones.
  const { parts } = await load(multi);
  const candidates = parts.filter((p) => p.topics.has(topicName) && p.summary.startTime <= timeNs);
  for (let i = candidates.length - 1; i >= 0; i--) {
    const r = await readVideoChunksAtTimeSingle(candidates[i]!.source, format, topicName, timeNs);
    if (r && r.chunks.length > 0) return r;
  }
  return null;
}

export async function readVideoChunkRangeMulti(
  multi: MultiBagSource,
  format: BagFormat,
  topicName: string,
  startNs: bigint,
  endNs: bigint,
): Promise<VideoChunksResult | null> {
  const { parts } = await load(multi);
  let merged: VideoChunksResult | null = null;
  for (const p of parts) {
    if (!p.topics.has(topicName)) continue;
    if (p.summary.endTime < startNs || p.summary.startTime > endNs) continue;
    const r = await readVideoChunkRangeSingle(p.source, format, topicName, startNs, endNs);
    if (!r) continue;
    if (merged) merged.chunks.push(...r.chunks);
    else merged = { ...r, chunks: [...r.chunks] };
  }
  return merged;
}

