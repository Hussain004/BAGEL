/**
 * Split recordings, tested end to end through the real MCAP reader.
 *
 * The fixtures deliberately vary the things real `ros2 bag record
 * --max-bag-size` output varies: parts that overlap at the boundary, a topic
 * that only exists in one part, parts handed over out of order, an empty
 * trailing part, and per-file channel/schema ids that disagree.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  detectFormat,
  disposeParserCaches,
  getTopicType,
  parseBag,
  readAllMessageStats,
  readDeserializedMessages,
  readMessageAtTime,
  readRawMessages,
} from '../../src/parsers/core';
import { mergeSummaries } from '../../src/parsers/multi';
import { assertSingleSource, sourceDisplayName, sourceKey, sourceSize } from '../../src/parsers/source';
import type { BagSource, MultiBagSource } from '../../src/parsers/source';
import { bytesToFile, writeSyntheticMcap, type SynthTopic } from '../fixtures/synth';

const S = 1_000_000_000n;

type Msg = { logTime: bigint; value: Record<string, unknown> };

function strings(secs: number[], tag: string): Msg[] {
  return secs.map((t) => ({ logTime: BigInt(t * 1000) * (S / 1000n), value: { data: `${tag}@${t}` } }));
}

function topic(name: string, secs: number[], tag: string): SynthTopic {
  return { topic: name, type: 'std_msgs/msg/String', messages: strings(secs, tag) };
}

async function part(name: string, topics: SynthTopic[]) {
  return { kind: 'file' as const, file: bytesToFile(await writeSyntheticMcap(topics), name) };
}

function multi(parts: MultiBagSource['parts'], displayName = 'run (parts)'): MultiBagSource {
  return { kind: 'multi', parts, displayName };
}

const data = (m: { value: Record<string, unknown> | null } | null) => m?.value?.data;

beforeEach(() => disposeParserCaches());

describe('merged summary', () => {
  it('unions topics, sums counts, and spans the full time range', async () => {
    const p0 = await part('r_0.mcap', [topic('/a', [1, 2, 3], 'p0'), topic('/only0', [1], 'x')]);
    const p1 = await part('r_1.mcap', [topic('/a', [4, 5], 'p1')]);
    const src = multi([p0, p1], 'r (2 parts)');
    const summary = await parseBag(src);

    expect(summary.format).toBe('mcap');
    expect(summary.fileName).toBe('r (2 parts)');
    expect(summary.totalMessageCount).toBe(6);
    expect(summary.startTime).toBe(1n * S);
    expect(summary.endTime).toBe(5n * S);
    expect(summary.duration).toBeCloseTo(4);
    const a = summary.topics.find((t) => t.name === '/a')!;
    expect(a.messageCount).toBe(5);
    expect(summary.topics.map((t) => t.name).sort()).toEqual(['/a', '/only0']);
    expect(await detectFormat(src)).toBe('mcap');
  });

  it('is independent of the order the parts are handed over', async () => {
    const p0 = await part('r_0.mcap', [topic('/a', [1, 2], 'p0')]);
    const p1 = await part('r_1.mcap', [topic('/a', [3, 4], 'p1')]);
    const p2 = await part('r_2.mcap', [topic('/a', [5, 6], 'p2')]);
    const inOrder = await parseBag(multi([p0, p1, p2]));
    disposeParserCaches();
    const shuffled = await parseBag(multi([p2, p0, p1]));
    expect(shuffled.startTime).toBe(inOrder.startTime);
    expect(shuffled.endTime).toBe(inOrder.endTime);
    const msgs = await readRawMessages(multi([p2, p0, p1]), 'mcap', '/a');
    expect(msgs.map((m) => m.timestamp)).toEqual([1n, 2n, 3n, 4n, 5n, 6n].map((s) => s * S));
  });

  it('skips an empty trailing part instead of dragging the range to 1970', async () => {
    const p0 = await part('r_0.mcap', [topic('/a', [10, 11], 'p0')]);
    const empty = await part('r_1.mcap', [{ topic: '/a', type: 'std_msgs/msg/String', messages: [] }]);
    const summary = await parseBag(multi([p0, empty]));
    expect(summary.startTime).toBe(10n * S);
    expect(summary.totalMessageCount).toBe(2);
  });

  it('rejects mixed formats with a message naming the offending file', async () => {
    const p0 = await part('r_0.mcap', [topic('/a', [1], 'p0')]);
    const fake = { kind: 'file' as const, file: bytesToFile(new Uint8Array(64), 'r_1.pcd') };
    await expect(parseBag(multi([p0, fake]))).rejects.toThrow(/r_1\.pcd/);
  });

  it('mergeSummaries keeps a topic type from the first part that has it', () => {
    const base = {
      format: 'mcap' as const,
      fileName: 'x',
      fileSize: 10,
      startTime: 0n,
      endTime: 2n * S,
      duration: 2,
      totalMessageCount: 2,
    };
    const merged = mergeSummaries('m', [
      { ...base, topics: [{ name: '/t', type: 'A', messageCount: 2, serializationFormat: 'cdr', frequency: 1 }] },
      { ...base, startTime: 2n * S, endTime: 4n * S, topics: [{ name: '/t', type: 'B', messageCount: 2, serializationFormat: 'cdr', frequency: 1 }] },
    ]);
    expect(merged.topics).toHaveLength(1);
    expect(merged.topics[0]!.type).toBe('A');
    expect(merged.topics[0]!.messageCount).toBe(4);
    expect(merged.topics[0]!.frequency).toBeCloseTo(1);
    expect(merged.fileSize).toBe(20);
  });
});

describe('reads across parts', () => {
  it('readRawMessages returns every message in time order, with limit', async () => {
    const p0 = await part('r_0.mcap', [topic('/a', [1, 2, 3], 'p0')]);
    const p1 = await part('r_1.mcap', [topic('/a', [4, 5, 6], 'p1')]);
    const src = multi([p0, p1]);
    const all = await readRawMessages(src, 'mcap', '/a');
    expect(all).toHaveLength(6);
    const limited = await readRawMessages(src, 'mcap', '/a', 4);
    expect(limited.map((m) => m.timestamp)).toEqual([1n, 2n, 3n, 4n].map((s) => s * S));
  });

  it('interleaves parts that overlap at the boundary', async () => {
    const p0 = await part('r_0.mcap', [topic('/a', [1, 3, 5], 'p0')]);
    const p1 = await part('r_1.mcap', [topic('/a', [2, 4, 6], 'p1')]);
    const out = await readDeserializedMessages(multi([p0, p1]), 'mcap', '/a');
    expect(out.map((m) => m.value?.data)).toEqual(['p0@1', 'p1@2', 'p0@3', 'p1@4', 'p0@5', 'p1@6']);
  });

  it('skips parts without the topic and reports progress and batches', async () => {
    const p0 = await part('r_0.mcap', [topic('/a', [1, 2], 'p0'), topic('/b', [1], 'b')]);
    const p1 = await part('r_1.mcap', [topic('/a', [3, 4], 'p1')]);
    const progress: number[] = [];
    let batched = 0;
    const out = await readDeserializedMessages(
      multi([p0, p1]),
      'mcap',
      '/a',
      undefined,
      (n) => progress.push(n),
      (batch) => {
        batched += batch.length;
      },
    );
    expect(out).toHaveLength(4);
    expect(batched).toBe(4);
    // Progress counts messages decoded so far across parts, never going backwards.
    expect(progress.length).toBeGreaterThan(0);
    expect([...progress].sort((x, y) => x - y)).toEqual(progress);
    expect(await readDeserializedMessages(multi([p0, p1]), 'mcap', '/b')).toHaveLength(1);
  });

  it('getTopicType finds a topic that exists in only a later part', async () => {
    const p0 = await part('r_0.mcap', [topic('/a', [1], 'p0')]);
    const p1 = await part('r_1.mcap', [topic('/late', [5], 'p1')]);
    expect(await getTopicType(multi([p0, p1]), 'mcap', '/late')).toBe('std_msgs/msg/String');
    expect(await getTopicType(multi([p0, p1]), 'mcap', '/nope')).toBeUndefined();
  });

  it('survives parts whose channel and schema ids disagree', async () => {
    // Part 0 registers /x first (id 1) then /y; part 1 registers /y first, so
    // the same topic has a different channel id in each file.
    const p0 = await part('r_0.mcap', [topic('/x', [1, 2], 'x0'), topic('/y', [1, 2], 'y0')]);
    const p1 = await part('r_1.mcap', [topic('/y', [3, 4], 'y1'), topic('/x', [3, 4], 'x1')]);
    const src = multi([p0, p1]);
    const y = await readDeserializedMessages(src, 'mcap', '/y');
    expect(y.map((m) => m.value?.data)).toEqual(['y0@1', 'y0@2', 'y1@3', 'y1@4']);
    const x = await readDeserializedMessages(src, 'mcap', '/x');
    expect(x.map((m) => m.value?.data)).toEqual(['x0@1', 'x0@2', 'x1@3', 'x1@4']);
  });
});

describe('readMessageAtTime matches the single-file contract', () => {
  async function fixture() {
    const p0 = await part('r_0.mcap', [topic('/a', [1, 2, 3], 'p0')]);
    const p1 = await part('r_1.mcap', [topic('/a', [10, 11], 'p1')]);
    return multi([p0, p1]);
  }

  it('returns the first message at or after t, from whichever part holds it', async () => {
    const src = await fixture();
    expect(data(await readMessageAtTime(src, 'mcap', '/a', 2n * S))).toBe('p0@2');
    // In the gap between parts: first at-or-after is the next part's first.
    expect(data(await readMessageAtTime(src, 'mcap', '/a', 5n * S))).toBe('p1@10');
    expect(data(await readMessageAtTime(src, 'mcap', '/a', 10n * S))).toBe('p1@10');
    expect(data(await readMessageAtTime(src, 'mcap', '/a', 0n))).toBe('p0@1');
  });

  it('falls back to the latest message before t when nothing is at or after', async () => {
    const src = await fixture();
    expect(data(await readMessageAtTime(src, 'mcap', '/a', 99n * S))).toBe('p1@11');
  });

  it('falls back across parts when only an earlier part has the topic', async () => {
    const p0 = await part('r_0.mcap', [topic('/a', [1, 2], 'p0'), topic('/cam', [2], 'c0')]);
    const p1 = await part('r_1.mcap', [topic('/a', [10, 11], 'p1')]);
    expect(data(await readMessageAtTime(multi([p0, p1]), 'mcap', '/cam', 11n * S))).toBe('c0@2');
  });

  it('returns null for an unknown topic', async () => {
    expect(await readMessageAtTime(await fixture(), 'mcap', '/missing', 1n * S)).toBeNull();
  });

  it('picks the closest at-or-after when parts overlap', async () => {
    const p0 = await part('r_0.mcap', [topic('/a', [1, 6], 'p0')]);
    const p1 = await part('r_1.mcap', [topic('/a', [4, 8], 'p1')]);
    expect(data(await readMessageAtTime(multi([p0, p1]), 'mcap', '/a', 3n * S))).toBe('p1@4');
  });

  it('does many varied sequential lookups on the reused readers', async () => {
    const src = await fixture();
    const expected = (t: number) => (t <= 1 ? 'p0@1' : t <= 2 ? 'p0@2' : t <= 3 ? 'p0@3' : t <= 10 ? 'p1@10' : t <= 11 ? 'p1@11' : 'p1@11');
    for (let i = 0; i < 200; i++) {
      const t = (i * 7) % 14;
      expect(data(await readMessageAtTime(src, 'mcap', '/a', BigInt(t) * S))).toBe(expected(t));
    }
  });
});

describe('stats', () => {
  it('rebases each part onto the merged start and keeps per-part order', async () => {
    const p0 = await part('r_0.mcap', [topic('/a', [10, 11], 'p0')]);
    const p1 = await part('r_1.mcap', [topic('/a', [20, 21], 'p1')]);
    const stats = await readAllMessageStats(multi([p0, p1]), 'mcap');
    const t = Array.from(stats['/a']!.times);
    expect(t).toEqual([0, 1e9, 10e9, 11e9]);
    expect(stats['/a']!.sizes).toHaveLength(4);
  });

  it('keeps an out-of-order stamp detectable instead of sorting it away', async () => {
    const p0 = await part('r_0.mcap', [topic('/a', [10, 12], 'p0')]);
    const p1 = await part('r_1.mcap', [topic('/a', [11, 13], 'p1')]);
    const t = Array.from((await readAllMessageStats(multi([p0, p1]), 'mcap'))['/a']!.times);
    expect(t).toEqual([0, 2e9, 1e9, 3e9]);
  });
});

describe('source helpers', () => {
  it('keys a multi source by its sorted parts, whatever the order', async () => {
    const p0 = await part('r_0.mcap', [topic('/a', [1], 'x')]);
    const p1 = await part('r_1.mcap', [topic('/a', [2], 'y')]);
    expect(sourceKey(multi([p0, p1]))).toBe(sourceKey(multi([p1, p0])));
    expect(sourceKey(multi([p0, p1]))).not.toBe(sourceKey(multi([p0])));
    expect(sourceSize(multi([p0, p1]))).toBe(p0.file.size + p1.file.size);
    expect(sourceDisplayName(multi([p0], 'shown'))).toBe('shown');
  });

  it('assertSingleSource explains how to proceed', async () => {
    const p0 = await part('r_0.mcap', [topic('/a', [1], 'x')]);
    const m: BagSource = multi([p0, p0]);
    expect(() => assertSingleSource(m, 'Editing')).toThrow(/Editing is not supported for split recordings/);
    expect(() => assertSingleSource(p0, 'Editing')).not.toThrow();
  });
});
