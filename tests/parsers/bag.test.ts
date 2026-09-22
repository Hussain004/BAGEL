/**
 * bag.ts (ROS1 .bag) tests against synthetic fixtures.
 *
 * `@foxglove/rosbag` ships a reader but no writer, so `tests/fixtures/synth.ts`
 * hand-rolls a minimal v2.0-compliant bag writer. That gives these tests
 * exact oracles (topic lists, per-chunk counts, message bytes) instead of
 * the previously-skipped real-recording fixture that was never present on
 * this checkout.
 *
 * `@foxglove/rosbag/web` provides a `BlobReader` that calls `.slice()` and
 * `.arrayBuffer()` on a `File` - both are available in Node 20+, so the
 * BlobReader path works under Vitest with no shim.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { parse as parseMessageDefinition } from '@foxglove/rosmsg';
import { MessageWriter } from '@foxglove/rosmsg-serialization';

import {
  parseBagFile,
  readRawMessagesBag,
  readDeserializedMessagesBag,
  readMessageAtTimeBag,
  getTopicTypeBag,
  loadBagForEdit,
  disposeBagCache,
} from '../../src/parsers/bag';
import { createFileSource } from '../../src/parsers/source';
import {
  bytesToFile,
  chatterRos1Bag,
  multiTopicRos1Bag,
  encodeRos1String,
  encodeRos1Int32,
  writeSyntheticRos1Bag,
} from '../fixtures/synth';

/** Stamped definition exercising the `=====` dependency separator + `time` primitive. */
const STAMPED_DEFINITION =
  'Header header\n' +
  'int32 value\n' +
  '================================================================================\n' +
  'MSG: std_msgs/Header\n' +
  'uint32 seq\n' +
  'time stamp\n' +
  'string frame_id\n';

function stampedRos1Bag(): Promise<Uint8Array> {
  const writer = new MessageWriter(parseMessageDefinition(STAMPED_DEFINITION, { ros2: false }));
  const data = writer.writeMessage({
    header: { seq: 7, stamp: { sec: 11, nsec: 22 }, frame_id: 'map' },
    value: 42,
  });
  return writeSyntheticRos1Bag([
    {
      topic: '/stamped',
      type: 'my_msgs/Stamped',
      messageDefinition: STAMPED_DEFINITION,
      messages: [{ time: { sec: 1, nsec: 2 }, data }],
    },
  ]);
}

/** 6 messages over 3 time-ordered chunks: /chatter x4 (1s..4s), /ints x2 (5.5s, 6.5s). */
function threeChunkRos1Bag(): Promise<Uint8Array> {
  return writeSyntheticRos1Bag(
    [
      {
        topic: '/chatter',
        type: 'std_msgs/String',
        messageDefinition: 'string data\n',
        messages: [1, 2, 3, 4].map((i) => ({
          time: { sec: i, nsec: 0 },
          data: encodeRos1String(`m${i}`),
        })),
      },
      {
        topic: '/ints',
        type: 'std_msgs/Int32',
        messageDefinition: 'int32 data\n',
        messages: [5, 6].map((i) => ({
          time: { sec: i, nsec: 500_000_000 },
          data: encodeRos1Int32(i),
        })),
      },
    ],
    { chunkCount: 3 },
  );
}

function sourceFor(bytes: Uint8Array, name: string) {
  return createFileSource(bytesToFile(bytes, name));
}

beforeEach(() => disposeBagCache());
afterAll(() => disposeBagCache());

describe('bag/parseBagFile - synthetic fixture', () => {
  it('returns a non-empty topic list with normalized ROS2-style type names', async () => {
    const source = sourceFor(await chatterRos1Bag(), 'chatter.bag');
    const summary = await parseBagFile(source);
    expect(summary.format).toBe('bag');
    expect(summary.fileName).toBe('chatter.bag');
    expect(summary.topics).toHaveLength(1);
    const topic = summary.topics[0];
    expect(topic.name).toBe('/chatter');
    // Normalised form is `pkg/msg/Type`, never bare `pkg/Type`.
    expect(topic.type).toBe('std_msgs/msg/String');
    expect(topic.type).toMatch(/\/msg\//);
    expect(topic.messageCount).toBe(3);
    expect(topic.serializationFormat).toBe('ros1');
  });

  it('reports total message count = sum of per-topic counts', async () => {
    const source = sourceFor(await multiTopicRos1Bag(), 'multi.bag');
    const summary = await parseBagFile(source);
    const sum = summary.topics.reduce((s, t) => s + t.messageCount, 0);
    expect(summary.totalMessageCount).toBe(3);
    expect(summary.totalMessageCount).toBe(sum);
    const byName = new Map(summary.topics.map((t) => [t.name, t]));
    expect(byName.get('/chatter')?.messageCount).toBe(1);
    expect(byName.get('/ints')?.messageCount).toBe(2);
  });

  it('reports a positive duration and start <= end', async () => {
    const source = sourceFor(await chatterRos1Bag(), 'chatter.bag');
    const summary = await parseBagFile(source);
    expect(summary.startTime).toBe(1_000_000_000n);
    expect(summary.endTime).toBe(3_000_000_000n);
    expect(summary.duration).toBeCloseTo(2, 6);
    expect(summary.duration).toBeGreaterThan(0);
    expect(summary.startTime <= summary.endTime).toBe(true);
  });

  it('sorts topics lexicographically by name', async () => {
    const source = sourceFor(await multiTopicRos1Bag(), 'multi.bag');
    const summary = await parseBagFile(source);
    const names = summary.topics.map((t) => t.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
    expect(names).toEqual(['/chatter', '/ints']);
    // Per-topic frequency = messageCount / duration (1s window here).
    const byName = new Map(summary.topics.map((t) => [t.name, t]));
    expect(byName.get('/chatter')?.frequency).toBe(1);
    expect(byName.get('/ints')?.frequency).toBe(2);
  });
});

describe('bag/readRawMessagesBag', () => {
  it('returns chronologically ordered bytes for an existing topic', async () => {
    const source = sourceFor(await multiTopicRos1Bag(), 'multi.bag');
    await parseBagFile(source);
    const raws = await readRawMessagesBag(source, '/ints', 20);
    expect(raws.length).toBe(2);
    expect(raws.map((r) => r.timestamp)).toEqual([1_000_000_000n, 2_000_000_000n]);
    for (let i = 1; i < raws.length; i++) {
      expect(raws[i].timestamp >= raws[i - 1].timestamp).toBe(true);
    }
    // int32 payload = 4 bytes little-endian.
    expect(raws[0].data.byteLength).toBe(4);
    expect(new DataView(raws[0].data.buffer, raws[0].data.byteOffset).getInt32(0, true)).toBe(1);
    // The limit caps how many messages are loaded.
    expect(await readRawMessagesBag(source, '/ints', 1)).toHaveLength(1);
  });

  it('returns an empty array for an unknown topic', async () => {
    const source = sourceFor(await multiTopicRos1Bag(), 'multi.bag');
    await parseBagFile(source);
    expect(await readRawMessagesBag(source, '/not/in/this/bag')).toEqual([]);
  });
});

describe('bag/readDeserializedMessagesBag', () => {
  it('decodes messages on registry-resolvable topics', async () => {
    const source = sourceFor(await multiTopicRos1Bag(), 'multi.bag');
    await parseBagFile(source);
    const chatter = await readDeserializedMessagesBag(source, '/chatter');
    expect(chatter).toHaveLength(1);
    expect(chatter[0].value).toEqual({ data: 'hi' });
    expect(chatter[0].timestamp).toBe(1_500_000_000n);
    const ints = await readDeserializedMessagesBag(source, '/ints');
    expect(ints.map((m) => m.value)).toEqual([{ data: 1 }, { data: 2 }]);
  });

  it('emits sec/nsec/nanosec time-field aliases on stamped messages', async () => {
    const source = sourceFor(await stampedRos1Bag(), 'stamped.bag');
    await parseBagFile(source);
    const decoded = await readDeserializedMessagesBag(source, '/stamped');
    expect(decoded).toHaveLength(1);
    const value = decoded[0].value as {
      header: { seq: number; stamp: { sec: number; nsec: number; nanosec: number }; frame_id: string };
      value: number;
    };
    expect(value.value).toBe(42);
    expect(value.header.seq).toBe(7);
    expect(value.header.frame_id).toBe('map');
    // ROS1 `time` decodes as {sec, nsec}; the alias pass adds `nanosec`.
    expect(value.header.stamp.sec).toBe(11);
    expect(value.header.stamp.nsec).toBe(22);
    expect(value.header.stamp.nanosec).toBe(22);
  });
});

describe('bag/readMessageAtTimeBag', () => {
  it('returns the message at-or-near a midpoint timestamp', async () => {
    const source = sourceFor(await chatterRos1Bag(), 'chatter.bag');
    const summary = await parseBagFile(source);
    const mid = summary.startTime + (summary.endTime - summary.startTime) / 2n;
    const message = await readMessageAtTimeBag(source, '/chatter', mid);
    expect(message).not.toBeNull();
    expect(message!.timestamp).toBe(2_000_000_000n);
    expect(message!.timestamp >= summary.startTime).toBe(true);
    expect(message!.timestamp <= summary.endTime).toBe(true);
    expect((message!.value as { data: string }).data).toBe('world');
  });

  it('snaps forward between messages and clamps at the range edges', async () => {
    const source = sourceFor(await multiTopicRos1Bag(), 'multi.bag');
    await parseBagFile(source);
    // /ints publishes at 1s and 2s only.
    const beforeRange = await readMessageAtTimeBag(source, '/ints', 0n);
    expect(beforeRange!.timestamp).toBe(1_000_000_000n); // first at-or-after
    const between = await readMessageAtTimeBag(source, '/ints', 1_200_000_000n);
    expect(between!.timestamp).toBe(2_000_000_000n); // forward scan
    const afterRange = await readMessageAtTimeBag(source, '/ints', 999_000_000_000n);
    expect(afterRange!.timestamp).toBe(2_000_000_000n); // reverse fallback
    expect(await readMessageAtTimeBag(source, '/nope', 0n)).toBeNull();
  });
});

describe('bag/getTopicTypeBag', () => {
  it('reports the normalized type for a known topic', async () => {
    const source = sourceFor(await multiTopicRos1Bag(), 'multi.bag');
    await parseBagFile(source);
    expect(await getTopicTypeBag(source, '/chatter')).toBe('std_msgs/msg/String');
    expect(await getTopicTypeBag(source, '/ints')).toBe('std_msgs/msg/Int32');
  });

  it('returns undefined for unknown topics', async () => {
    const source = sourceFor(await multiTopicRos1Bag(), 'multi.bag');
    await parseBagFile(source);
    expect(await getTopicTypeBag(source, '/no/such/topic')).toBeUndefined();
  });
});

describe('bag/multi-chunk index', () => {
  it('sums per-chunk connection counts across every chunk_info', async () => {
    const source = sourceFor(await threeChunkRos1Bag(), 'three-chunk.bag');
    const edit = await loadBagForEdit(source);
    expect(edit.bag.chunkInfos).toHaveLength(3);
    const toNs = (t: { sec: number; nsec: number }) =>
      BigInt(t.sec) * 1_000_000_000n + BigInt(t.nsec);
    // Each chunk covers its own contiguous time slice...
    expect(edit.bag.chunkInfos.map((ci) => toNs(ci.startTime))).toEqual([
      1_000_000_000n,
      3_000_000_000n,
      5_500_000_000n,
    ]);
    expect(edit.bag.chunkInfos.map((ci) => toNs(ci.endTime))).toEqual([
      2_000_000_000n,
      4_000_000_000n,
      6_500_000_000n,
    ]);
    // ...and each chunk_info lists the connections present in it.
    expect(edit.bag.chunkInfos.map((ci) => ci.connections)).toEqual([
      [{ conn: 0, count: 2 }],
      [{ conn: 0, count: 2 }],
      [{ conn: 1, count: 2 }],
    ]);
    // Summation across chunks: conn 0 (/chatter) has 4, conn 1 (/ints) has 2.
    expect([...edit.messageCountByConn]).toEqual([
      [0, 4],
      [1, 2],
    ]);

    const summary = await parseBagFile(source);
    expect(summary.totalMessageCount).toBe(6);
    expect(summary.startTime).toBe(1_000_000_000n);
    expect(summary.endTime).toBe(6_500_000_000n);
    expect(summary.duration).toBeCloseTo(5.5, 6);
    const byName = new Map(summary.topics.map((t) => [t.name, t]));
    expect(byName.get('/chatter')?.messageCount).toBe(4);
    expect(byName.get('/ints')?.messageCount).toBe(2);
  });

  it('reads and decodes messages that span chunk boundaries', async () => {
    const source = sourceFor(await threeChunkRos1Bag(), 'three-chunk.bag');
    await parseBagFile(source);
    const raws = await readRawMessagesBag(source, '/chatter');
    expect(raws.map((r) => r.timestamp)).toEqual([
      1_000_000_000n,
      2_000_000_000n,
      3_000_000_000n,
      4_000_000_000n,
    ]);
    const decoded = await readDeserializedMessagesBag(source, '/chatter');
    expect(decoded.map((m) => (m.value as { data: string }).data)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
    ]);
    // Nearest-at-time still works when the target lands in the middle chunk.
    const at = await readMessageAtTimeBag(source, '/chatter', 3_200_000_000n);
    expect(at!.timestamp).toBe(4_000_000_000n);
  });
});

describe('bag/cache invalidation', () => {
  it('disposeBagCache forces a reload for the next parse', async () => {
    const source = sourceFor(await chatterRos1Bag(), 'chatter.bag');
    const a = await parseBagFile(source);
    disposeBagCache();
    const b = await parseBagFile(source);
    expect(b.totalMessageCount).toBe(a.totalMessageCount);
    expect(b.topics.length).toBe(a.topics.length);
    expect(b.topics.map((t) => t.name)).toEqual(a.topics.map((t) => t.name));
  });
});
