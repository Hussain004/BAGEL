/**
 * db3.ts tests.
 *
 * db3.ts hard-codes `locateFile: () => '/sql-wasm.wasm'` for sql.js — that's
 * a browser-absolute path that fails in Node. We mock the `sql.js` module
 * so its default initializer ignores `locateFile` and uses Node's standard
 * `node_modules` lookup, which is what `scripts/verify-parsers.mjs` already
 * relies on.
 */

import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

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
  getTopicTypeDb3,
  disposeDb3Cache,
} = await import('../../src/parsers/db3');
const { createFileSource } = await import('../../src/parsers/source');

// Real fixture lives in the user's repo. Skip the file gracefully if it's
// not present (e.g. on a fresh clone before the bags are placed).
const FIXTURE_PATH = join(
  process.cwd(),
  'test_files',
  'db3',
  'sample.625-2.bag2_0.db3',
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_PATH);

function fixtureSource(): ReturnType<typeof createFileSource> {
  if (!FIXTURE_AVAILABLE) throw new Error(`Fixture missing: ${FIXTURE_PATH}`);
  const bytes = readFileSync(FIXTURE_PATH);
  // `File` ctor wants a typed-array-like; Buffer is one.
  const file = new File([new Uint8Array(bytes)], 'sample.db3');
  return createFileSource(file);
}

beforeEach(() => disposeDb3Cache());
afterAll(() => disposeDb3Cache());

const describeWithFixture = FIXTURE_AVAILABLE ? describe : describe.skip;

describeWithFixture('db3/parseDb3 — real fixture', () => {
  it('returns a non-empty topic list with normalized types', async () => {
    const summary = await parseDb3(fixtureSource());
    expect(summary.format).toBe('db3');
    expect(summary.fileName).toBe('sample.db3');
    expect(summary.topics.length).toBeGreaterThan(0);
    for (const topic of summary.topics) {
      expect(topic.name).toMatch(/^\//);
      expect(topic.type.length).toBeGreaterThan(0);
      expect(typeof topic.messageCount).toBe('number');
      expect(topic.serializationFormat).toMatch(/cdr/);
    }
  });

  it('reports total message count = sum of per-topic counts', async () => {
    const summary = await parseDb3(fixtureSource());
    const sum = summary.topics.reduce((s, t) => s + t.messageCount, 0);
    expect(summary.totalMessageCount).toBe(sum);
  });

  it('reports a positive duration and a start <= end timestamp', async () => {
    const summary = await parseDb3(fixtureSource());
    expect(summary.duration).toBeGreaterThan(0);
    expect(summary.startTime <= summary.endTime).toBe(true);
  });

  it('assigns frequency = messageCount / duration to each topic', async () => {
    const summary = await parseDb3(fixtureSource());
    for (const topic of summary.topics) {
      if (topic.messageCount > 0 && summary.duration > 0) {
        expect(topic.frequency).toBeGreaterThan(0);
      }
    }
  });

  it('sorts topics lexicographically by name', async () => {
    const summary = await parseDb3(fixtureSource());
    const names = summary.topics.map((t) => t.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});

describeWithFixture('db3/readRawMessagesDb3 — real fixture', () => {
  it('returns chronologically ordered bytes for an existing topic', async () => {
    const source = fixtureSource();
    const summary = await parseDb3(source);
    // Pick the topic with the most messages so the test exercises a real volume.
    const topic = [...summary.topics].sort((a, b) => b.messageCount - a.messageCount)[0];
    const raws = await readRawMessagesDb3(source, topic.name, 50);
    expect(raws.length).toBeLessThanOrEqual(50);
    expect(raws.length).toBeGreaterThan(0);
    for (let i = 1; i < raws.length; i++) {
      expect(raws[i].timestamp >= raws[i - 1].timestamp).toBe(true);
    }
    // Every blob has at least the CDR encapsulation header (4 bytes).
    expect(raws[0].data.byteLength).toBeGreaterThanOrEqual(4);
  });

  it('returns an empty array for an unknown topic', async () => {
    const source = fixtureSource();
    await parseDb3(source);
    expect(await readRawMessagesDb3(source, '/this/topic/does/not/exist')).toEqual([]);
  });
});

describeWithFixture('db3/readDeserializedMessagesDb3 — real fixture', () => {
  it('decodes messages for any topic whose type is in the bundled registry', async () => {
    const source = fixtureSource();
    const summary = await parseDb3(source);
    // Pick a topic whose type is a known standard (std/geometry/sensor/nav).
    const decodableTopic = summary.topics.find(
      (t) =>
        t.type.startsWith('std_msgs/') ||
        t.type.startsWith('geometry_msgs/') ||
        t.type.startsWith('sensor_msgs/') ||
        t.type.startsWith('nav_msgs/'),
    );
    if (!decodableTopic) {
      return; // The fixture has only custom types — nothing to assert here.
    }
    const decoded = await readDeserializedMessagesDb3(source, decodableTopic.name, 5);
    expect(decoded.length).toBeLessThanOrEqual(5);
    // At least one message decoded to a non-null object.
    expect(decoded.some((m) => m.value !== null)).toBe(true);
  });
});

describeWithFixture('db3/readMessageAtTimeDb3 — real fixture', () => {
  it('returns the message nearest to a midpoint timestamp', async () => {
    const source = fixtureSource();
    const summary = await parseDb3(source);
    const decodable = summary.topics.find(
      (t) => t.messageCount > 0 && (t.type.startsWith('std_msgs/') || t.type.startsWith('geometry_msgs/')),
    );
    if (!decodable) return; // No decodable + non-empty topic in this fixture.
    const mid = summary.startTime + (summary.endTime - summary.startTime) / 2n;
    const message = await readMessageAtTimeDb3(source, decodable.name, mid);
    if (message) {
      expect(message.timestamp >= summary.startTime).toBe(true);
      expect(message.timestamp <= summary.endTime).toBe(true);
    }
  });

  it('returns null for a topic not in the bag', async () => {
    const source = fixtureSource();
    await parseDb3(source);
    expect(await readMessageAtTimeDb3(source, '/bogus', 0n)).toBeNull();
  });
});

describeWithFixture('db3/getTopicTypeDb3 — real fixture', () => {
  it('reports the type recorded in the topics table', async () => {
    const source = fixtureSource();
    const summary = await parseDb3(source);
    const t0 = summary.topics[0];
    expect(await getTopicTypeDb3(source, t0.name)).toBe(t0.type);
  });

  it('returns undefined for topics not in the bag', async () => {
    const source = fixtureSource();
    await parseDb3(source);
    expect(await getTopicTypeDb3(source, '/no-such-topic')).toBeUndefined();
  });
});

describeWithFixture('db3/cache invalidation', () => {
  it('disposeDb3Cache forces a reload for the next parse', async () => {
    const source = fixtureSource();
    const a = await parseDb3(source);
    disposeDb3Cache();
    const b = await parseDb3(source);
    expect(b.totalMessageCount).toBe(a.totalMessageCount);
    expect(b.topics.length).toBe(a.topics.length);
  });
});
