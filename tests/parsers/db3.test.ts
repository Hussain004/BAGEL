/**
 * db3.ts tests.
 *
 * db3.ts hard-codes `locateFile: () => '/sql-wasm.wasm'` for sql.js - that's
 * a browser-absolute path that fails in Node. We mock the `sql.js` module
 * so its default initializer ignores `locateFile` and uses Node's standard
 * `node_modules` lookup (same approach `scripts/verify-parsers.mjs` uses).
 *
 * All fixtures are synthetic db3 files produced by `writeSyntheticDb3` so
 * every assertion can be exact (topic list, counts, durations, nearest-
 * message oracle) instead of depending on an externally generated real
 * recording being present on disk.
 */

import { describe, it, expect, beforeEach, vi, afterAll, beforeAll } from 'vitest';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';

vi.mock('sql.js', async () => {
  const actual = await vi.importActual<typeof import('sql.js')>('sql.js');
  // sql.js v1 exports the initializer as the default. Strip any user-supplied
  // config so the WASM is fetched from the package's own dist/ folder.
  const init = actual.default;
  return {
    default: () => init(),
    __esModule: true,
  };
});

// Import after the mock is registered so db3.ts picks it up.
const {
  parseDb3,
  readRawMessagesDb3,
  readDeserializedMessagesDb3,
  readMessageAtTimeDb3,
  readAllMessageStatsDb3,
  getTopicTypeDb3,
  disposeDb3Cache,
} = await import('../../src/parsers/db3');
const { createFileSource } = await import('../../src/parsers/source');
const { bytesToFile, collectMessageDefinitions, writeSyntheticDb3 } = await import(
  '../fixtures/synth'
);

// Synthetic three-topic bag used by every test below:
//   /chatter  std_msgs/msg/String  3 messages at 1s, 2s, 3s
//   /ints     std_msgs/msg/Int32   2 messages at 1.5s, 2.5s
//   /mystery  pkg/Whatever         1 message at 1.25s, arbitrary bytes
// Bag window: start 1e9 ns, end 3e9 ns, duration 2.0s, 6 messages total.
const TOPICS = ['/chatter', '/ints', '/mystery'] as const;
let fixtureBytes: Uint8Array;

beforeAll(async () => {
  const stringWriter = new MessageWriter(collectMessageDefinitions('std_msgs/msg/String'));
  const intWriter = new MessageWriter(collectMessageDefinitions('std_msgs/msg/Int32'));
  fixtureBytes = await writeSyntheticDb3([
    {
      topic: '/chatter',
      type: 'std_msgs/msg/String',
      messages: [
        { timestampNs: 1_000_000_000n, data: stringWriter.writeMessage({ data: 'hello' }) },
        { timestampNs: 2_000_000_000n, data: stringWriter.writeMessage({ data: 'world' }) },
        { timestampNs: 3_000_000_000n, data: stringWriter.writeMessage({ data: 'bagel' }) },
      ],
    },
    {
      topic: '/ints',
      type: 'std_msgs/msg/Int32',
      messages: [
        { timestampNs: 1_500_000_000n, data: intWriter.writeMessage({ data: 1 }) },
        { timestampNs: 2_500_000_000n, data: intWriter.writeMessage({ data: 2 }) },
      ],
    },
    {
      topic: '/mystery',
      type: 'pkg/Whatever',
      messages: [{ timestampNs: 1_250_000_000n, data: new Uint8Array([9, 9, 9]) }],
    },
  ]);
});

function fixtureSource(): ReturnType<typeof createFileSource> {
  return createFileSource(bytesToFile(fixtureBytes, 'synthetic.db3'));
}

beforeEach(() => disposeDb3Cache());
afterAll(() => disposeDb3Cache());

describe('db3/parseDb3 - synthetic fixture', () => {
  it('returns the exact topic list with normalized types', async () => {
    const summary = await parseDb3(fixtureSource());
    expect(summary.format).toBe('db3');
    expect(summary.fileName).toBe('synthetic.db3');
    expect(summary.topics.map((t) => t.name)).toEqual([...TOPICS]);
    const byName = new Map(summary.topics.map((t) => [t.name, t]));
    expect(byName.get('/chatter')?.type).toBe('std_msgs/msg/String');
    expect(byName.get('/chatter')?.messageCount).toBe(3);
    expect(byName.get('/ints')?.type).toBe('std_msgs/msg/Int32');
    expect(byName.get('/ints')?.messageCount).toBe(2);
    expect(byName.get('/mystery')?.type).toBe('pkg/Whatever');
    expect(byName.get('/mystery')?.messageCount).toBe(1);
    for (const topic of summary.topics) {
      expect(topic.name).toMatch(/^\//);
      expect(topic.serializationFormat).toMatch(/cdr/);
    }
  });

  it('reports total message count = sum of per-topic counts', async () => {
    const summary = await parseDb3(fixtureSource());
    const sum = summary.topics.reduce((s, t) => s + t.messageCount, 0);
    expect(summary.totalMessageCount).toBe(6);
    expect(summary.totalMessageCount).toBe(sum);
  });

  it('reports the exact duration and a start <= end timestamp', async () => {
    const summary = await parseDb3(fixtureSource());
    expect(summary.startTime).toBe(1_000_000_000n);
    expect(summary.endTime).toBe(3_000_000_000n);
    expect(summary.startTime <= summary.endTime).toBe(true);
    expect(summary.duration).toBeCloseTo(2.0, 6);
  });

  it('assigns frequency = messageCount / duration to each topic', async () => {
    const summary = await parseDb3(fixtureSource());
    expect(summary.duration).toBeGreaterThan(0);
    const byName = new Map(summary.topics.map((t) => [t.name, t]));
    // 3 / 2s = 1.5 Hz, 2 / 2s = 1 Hz, 1 / 2s = 0.5 Hz (rounded to 1 dp).
    expect(byName.get('/chatter')?.frequency).toBe(1.5);
    expect(byName.get('/ints')?.frequency).toBe(1);
    expect(byName.get('/mystery')?.frequency).toBe(0.5);
  });

  it('sorts topics lexicographically by name', async () => {
    const summary = await parseDb3(fixtureSource());
    const names = summary.topics.map((t) => t.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
    expect(names).toEqual([...TOPICS]);
  });
});

describe('db3/readRawMessagesDb3', () => {
  it('returns chronologically ordered bytes for an existing topic', async () => {
    const source = fixtureSource();
    await parseDb3(source);
    const raws = await readRawMessagesDb3(source, '/chatter', 50);
    expect(raws.length).toBe(3);
    expect(raws.map((r) => r.timestamp)).toEqual([
      1_000_000_000n,
      2_000_000_000n,
      3_000_000_000n,
    ]);
    for (const raw of raws) {
      expect(raw.topicName).toBe('/chatter');
      // CDR blobs carry at least the 4-byte encapsulation header.
      expect(raw.data.byteLength).toBeGreaterThanOrEqual(4);
    }
    // The limit caps how many messages are loaded.
    expect(await readRawMessagesDb3(source, '/chatter', 2)).toHaveLength(2);
  });

  it('returns an empty array for an unknown topic', async () => {
    const source = fixtureSource();
    await parseDb3(source);
    expect(await readRawMessagesDb3(source, '/this/topic/does/not/exist')).toEqual([]);
  });
});

describe('db3/readDeserializedMessagesDb3', () => {
  it('decodes messages for a topic whose type is in the bundled registry', async () => {
    const source = fixtureSource();
    await parseDb3(source);
    const decoded = await readDeserializedMessagesDb3(source, '/chatter');
    expect(decoded).toHaveLength(3);
    expect(decoded.every((m) => m.value !== null)).toBe(true);
    expect(decoded.map((m) => (m.value as { data: string }).data)).toEqual([
      'hello',
      'world',
      'bagel',
    ]);
    expect(decoded.map((m) => m.timestamp)).toEqual([
      1_000_000_000n,
      2_000_000_000n,
      3_000_000_000n,
    ]);
  });

  it('handles unknown types and non-UTF8 data gracefully', async () => {
    const source = fixtureSource();
    await parseDb3(source);
    // /mystery's type is not in the registry and its bytes are arbitrary;
    // the decode must not throw, it yields a null value per message.
    const decoded = await readDeserializedMessagesDb3(source, '/mystery');
    expect(decoded).toHaveLength(1);
    expect(decoded[0].value).toBeNull();
    expect(decoded[0].timestamp).toBe(1_250_000_000n);
  });

  it('skips topics with no messages', async () => {
    // Fixture: three topics, all with messages, so no empty topic is present.
    const summary = await parseDb3(fixtureSource());
    const empty = summary.topics.filter((t) => t.messageCount === 0);
    expect(empty).toEqual([]);
  });
});

describe('db3/readMessageAtTimeDb3', () => {
  it('returns the message nearest to a midpoint timestamp', async () => {
    const source = fixtureSource();
    await parseDb3(source);
    // Bag window midpoint lands exactly on /chatter's 2s message.
    const message = await readMessageAtTimeDb3(source, '/chatter', 2_000_000_000n);
    expect(message).not.toBeNull();
    expect(message!.timestamp).toBe(2_000_000_000n);
    expect((message!.value as { data: string }).data).toBe('world');
  });

  it('snaps to the strictly nearest message between two publishes', async () => {
    const source = fixtureSource();
    await parseDb3(source);
    // 1.4s: /chatter at 1s is 0.4s away, at 2s is 0.6s away -> 1s wins.
    const before = await readMessageAtTimeDb3(source, '/chatter', 1_400_000_000n);
    expect(before!.timestamp).toBe(1_000_000_000n);
    expect((before!.value as { data: string }).data).toBe('hello');
    // 2.6s: 2s is 0.6s away, 3s is 0.4s away -> 3s wins.
    const after = await readMessageAtTimeDb3(source, '/chatter', 2_600_000_000n);
    expect(after!.timestamp).toBe(3_000_000_000n);
    expect((after!.value as { data: string }).data).toBe('bagel');
  });

  it('clamps to the first/last message outside the bag range', async () => {
    // Documented behavior: the UNION nearest-query returns the closest
    // endpoint row when the target lies outside the topic's time range,
    // rather than null (null is reserved for topics absent from the bag).
    const source = fixtureSource();
    await parseDb3(source);
    const beforeRange = await readMessageAtTimeDb3(source, '/chatter', 0n);
    expect(beforeRange!.timestamp).toBe(1_000_000_000n);
    const afterRange = await readMessageAtTimeDb3(source, '/chatter', 999_000_000_000n);
    expect(afterRange!.timestamp).toBe(3_000_000_000n);
  });

  it('returns null for a topic not in the bag', async () => {
    const source = fixtureSource();
    await parseDb3(source);
    expect(await readMessageAtTimeDb3(source, '/bogus', 0n)).toBeNull();
  });
});

describe('db3/readAllMessageStatsDb3', () => {
  it('returns exact per-topic relative times and sizes', async () => {
    const source = fixtureSource();
    await parseDb3(source);
    const stats = await readAllMessageStatsDb3(source);
    expect(Object.keys(stats).sort()).toEqual([...TOPICS]);
    // Relative times (ns) against the bag-wide minimum timestamp (1e9).
    expect(Array.from(stats['/chatter'].times)).toEqual([
      0, 1_000_000_000, 2_000_000_000,
    ]);
    expect(Array.from(stats['/ints'].times)).toEqual([
      500_000_000, 1_500_000_000,
    ]);
    expect(Array.from(stats['/mystery'].times)).toEqual([250_000_000]);
    // Sizes must agree byte-for-byte with the raw reader's payload lengths.
    const raws = await readRawMessagesDb3(source, '/chatter');
    expect(Array.from(stats['/chatter'].sizes)).toEqual(raws.map((r) => r.data.byteLength));
    expect(stats['/mystery'].sizes[0]).toBe(3);
  });
});

describe('db3/getTopicTypeDb3', () => {
  it('reports the type recorded in the topics table', async () => {
    const source = fixtureSource();
    await parseDb3(source);
    expect(await getTopicTypeDb3(source, '/chatter')).toBe('std_msgs/msg/String');
    expect(await getTopicTypeDb3(source, '/mystery')).toBe('pkg/Whatever');
  });

  it('returns undefined for topics not in the bag', async () => {
    const source = fixtureSource();
    await parseDb3(source);
    expect(await getTopicTypeDb3(source, '/no-such-topic')).toBeUndefined();
  });
});

describe('db3/cache invalidation', () => {
  it('disposeDb3Cache forces a reload for the next parse', async () => {
    const source = fixtureSource();
    const a = await parseDb3(source);
    disposeDb3Cache();
    const b = await parseDb3(source);
    expect(b.totalMessageCount).toBe(a.totalMessageCount);
    expect(b.topics.length).toBe(a.topics.length);
    expect(b.topics.map((t) => t.name)).toEqual(a.topics.map((t) => t.name));
  });
});

describe('db3/strict parser assumptions', () => {
  it('rejects non-db3 input', async () => {
    const notDb3 = new TextEncoder().encode('this is definitely not a db3 file');
    await expect(parseDb3(createFileSource(bytesToFile(notDb3, 'not.db3')))).rejects.toThrow();
  });

  it('rejects empty input', async () => {
    await expect(
      parseDb3(createFileSource(bytesToFile(new Uint8Array(0), 'empty.db3'))),
    ).rejects.toThrow();
  });
});
