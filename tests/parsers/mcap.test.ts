import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseMcap,
  readRawMessagesMcap,
  readDeserializedMessagesMcap,
  readMessageAtTimeMcap,
  getTopicTypeMcap,
  disposeMcapCache,
} from '../../src/parsers/mcap';
import type { BagSource } from '../../src/parsers/source';
import {
  bytesToFile,
  chatterBag,
  multiTopicBag,
  writeSyntheticMcap,
} from '../fixtures/synth';

function fileSource(file: File): BagSource {
  return { kind: 'file', file };
}

beforeEach(() => disposeMcapCache());

describe('mcap/parseMcap — synthetic bags', () => {
  it('reports correct topic list + counts for a tiny chatter bag', async () => {
    const bytes = await chatterBag();
    const source = fileSource(bytesToFile(bytes, 'chatter.mcap'));
    const summary = await parseMcap(source);

    expect(summary.format).toBe('mcap');
    expect(summary.fileName).toBe('chatter.mcap');
    expect(summary.totalMessageCount).toBe(3);
    expect(summary.topics).toHaveLength(1);
    expect(summary.topics[0]).toMatchObject({
      name: '/chatter',
      type: 'std_msgs/msg/String',
      messageCount: 3,
    });
  });

  it('reports the bag duration in seconds from start/end timestamps', async () => {
    const bytes = await chatterBag();
    const source = fileSource(bytesToFile(bytes, 'chatter.mcap'));
    const summary = await parseMcap(source);
    // chatterBag emits messages at 1, 2, 3 seconds → 2 seconds end-to-end.
    expect(summary.duration).toBeCloseTo(2, 3);
    expect(summary.startTime).toBe(1_000_000_000n);
    expect(summary.endTime).toBe(3_000_000_000n);
  });

  it('sorts topics by name regardless of write order', async () => {
    const summary = await parseMcap(fileSource(bytesToFile(await multiTopicBag(), 'multi.mcap')));
    expect(summary.topics.map((t) => t.name)).toEqual(['/chatter', '/odom']);
  });

  it('computes per-topic frequency from messageCount / duration', async () => {
    // 100 messages at 100 ms intervals — duration is (count-1) * interval so
    // the apparent rate is slightly above the publish rate, matching the
    // `ros2 bag info` convention. We assert against the computed value.
    const bytes = await writeSyntheticMcap([
      {
        topic: '/ping',
        type: 'std_msgs/msg/Int32',
        messages: Array.from({ length: 100 }, (_, i) => ({
          logTime: BigInt(i + 1) * 100_000_000n,
          value: { data: i },
        })),
      },
    ]);
    const summary = await parseMcap(fileSource(bytesToFile(bytes, 'ping.mcap')));
    // duration = (100 * 0.1) - 0.1 = 9.9 s → 100 / 9.9 ≈ 10.1 Hz, rounded to 1 dp.
    expect(summary.topics[0].frequency).toBeGreaterThan(9);
    expect(summary.topics[0].frequency).toBeLessThan(12);
  });
});

describe('mcap/readRawMessagesMcap', () => {
  it('returns CDR-encoded bytes in chronological order', async () => {
    const source = fileSource(bytesToFile(await chatterBag(), 'chatter.mcap'));
    const raws = await readRawMessagesMcap(source, '/chatter');
    expect(raws).toHaveLength(3);
    expect(raws.map((r) => r.timestamp)).toEqual([
      1_000_000_000n,
      2_000_000_000n,
      3_000_000_000n,
    ]);
    expect(raws[0].topicName).toBe('/chatter');
    // Each std_msgs/String CDR blob is small but non-empty.
    expect(raws[0].data.byteLength).toBeGreaterThan(0);
  });

  it('honours the limit parameter', async () => {
    const source = fileSource(bytesToFile(await chatterBag(), 'chatter.mcap'));
    const raws = await readRawMessagesMcap(source, '/chatter', 2);
    expect(raws).toHaveLength(2);
  });

  it('returns an empty array when the topic does not exist', async () => {
    const source = fileSource(bytesToFile(await chatterBag(), 'chatter.mcap'));
    expect(await readRawMessagesMcap(source, '/nope')).toEqual([]);
  });
});

describe('mcap/readDeserializedMessagesMcap', () => {
  it('decodes every message on a topic', async () => {
    const source = fileSource(bytesToFile(await chatterBag(), 'chatter.mcap'));
    const decoded = await readDeserializedMessagesMcap(source, '/chatter');
    expect(decoded).toHaveLength(3);
    expect(decoded.map((m) => m.value)).toEqual([
      { data: 'hello' },
      { data: 'world' },
      { data: 'bagel' },
    ]);
  });

  it('fires onProgress at the configured cadence (>500 messages)', async () => {
    // Build a bag big enough to cross the YIELD_EVERY boundary.
    const bytes = await writeSyntheticMcap([
      {
        topic: '/spam',
        type: 'std_msgs/msg/Int32',
        messages: Array.from({ length: 600 }, (_, i) => ({
          logTime: BigInt(i + 1) * 1_000_000n,
          value: { data: i },
        })),
      },
    ]);
    const source = fileSource(bytesToFile(bytes, 'spam.mcap'));
    const progressMarks: number[] = [];
    const decoded = await readDeserializedMessagesMcap(
      source,
      '/spam',
      undefined,
      (n) => progressMarks.push(n),
    );
    expect(decoded).toHaveLength(600);
    // Progress fires once mid-stream (at 500) and again at the tail flush.
    expect(progressMarks.length).toBeGreaterThanOrEqual(2);
    expect(progressMarks[0]).toBe(500);
    expect(progressMarks[progressMarks.length - 1]).toBe(600);
  });

  it('streams batches to onBatch as messages decode', async () => {
    const bytes = await writeSyntheticMcap([
      {
        topic: '/spam',
        type: 'std_msgs/msg/Int32',
        messages: Array.from({ length: 1100 }, (_, i) => ({
          logTime: BigInt(i + 1) * 1_000_000n,
          value: { data: i },
        })),
      },
    ]);
    const source = fileSource(bytesToFile(bytes, 'spam.mcap'));
    let totalBatched = 0;
    await readDeserializedMessagesMcap(
      source,
      '/spam',
      undefined,
      undefined,
      (batch) => {
        totalBatched += batch.length;
      },
    );
    expect(totalBatched).toBe(1100);
  });
});

describe('mcap/readMessageAtTimeMcap', () => {
  it('returns the message at-or-after the requested timestamp', async () => {
    const source = fileSource(bytesToFile(await chatterBag(), 'chatter.mcap'));
    const result = await readMessageAtTimeMcap(source, '/chatter', 1_500_000_000n);
    expect(result).not.toBeNull();
    // 1.5 s → the next message at 2.0 s is the one returned.
    expect(result!.timestamp).toBe(2_000_000_000n);
    expect(result!.value).toEqual({ data: 'world' });
  });

  it('falls back to the latest message at-or-before when nothing is after', async () => {
    const source = fileSource(bytesToFile(await chatterBag(), 'chatter.mcap'));
    const result = await readMessageAtTimeMcap(source, '/chatter', 5_000_000_000n);
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(3_000_000_000n);
    expect(result!.value).toEqual({ data: 'bagel' });
  });

  it('returns null when the topic does not exist in the bag', async () => {
    const source = fileSource(bytesToFile(await chatterBag(), 'chatter.mcap'));
    expect(await readMessageAtTimeMcap(source, '/nope', 0n)).toBeNull();
  });
});

describe('mcap/getTopicTypeMcap', () => {
  it('returns the schema name for a known topic', async () => {
    const source = fileSource(bytesToFile(await chatterBag(), 'chatter.mcap'));
    expect(await getTopicTypeMcap(source, '/chatter')).toBe('std_msgs/msg/String');
  });

  it('returns undefined for an unknown topic', async () => {
    const source = fileSource(bytesToFile(await chatterBag(), 'chatter.mcap'));
    expect(await getTopicTypeMcap(source, '/nope')).toBeUndefined();
  });
});

describe('mcap/cache invalidation', () => {
  it('disposeMcapCache forces a reload for the next parse', async () => {
    const source = fileSource(bytesToFile(await chatterBag(), 'chatter.mcap'));
    const a = await parseMcap(source);
    disposeMcapCache();
    const b = await parseMcap(source);
    // Same input ⇒ same output, but the cache was cleared between calls;
    // a regression where the second parse returned stale state would
    // surface here.
    expect(b.totalMessageCount).toBe(a.totalMessageCount);
  });

  it('different source keys do not collide in the cache', async () => {
    const a = fileSource(bytesToFile(await chatterBag(), 'a.mcap'));
    const b = fileSource(bytesToFile(await multiTopicBag(), 'b.mcap'));
    const sa = await parseMcap(a);
    const sb = await parseMcap(b);
    expect(sa.fileName).toBe('a.mcap');
    expect(sb.fileName).toBe('b.mcap');
    expect(sa.topics).toHaveLength(1);
    expect(sb.topics).toHaveLength(2);
  });
});
