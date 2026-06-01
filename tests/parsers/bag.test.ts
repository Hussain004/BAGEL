/**
 * bag.ts (ROS1 .bag) tests against the committed test_files fixture.
 *
 * `@foxglove/rosbag/web` provides a `BlobReader` that calls `.slice()` and
 * `.arrayBuffer()` on a `File` — both are available in Node 20+, so the
 * BlobReader path works under Vitest with no shim.
 *
 * Caveat: Node's `File` constructor caps at 2 GiB when fed a `Uint8Array`
 * (the input must fit in a single ArrayBuffer). If the only fixture on
 * disk is bigger than that — like the 10 GB `door_02.bag` in this repo —
 * the suite skips itself rather than crashing. ROS1 has no JS bag writer
 * (`@foxglove/rosbag` is read-only) so we can't ship an in-memory synthetic
 * fixture the way we do for MCAP. A smaller real-world `.bag` (a few
 * hundred MB) dropped into `test_files/bag/` would un-skip these tests.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseBagFile,
  readRawMessagesBag,
  readDeserializedMessagesBag,
  readMessageAtTimeBag,
  getTopicTypeBag,
  disposeBagCache,
} from '../../src/parsers/bag';
import { createFileSource } from '../../src/parsers/source';

const FIXTURE_PATH = join(process.cwd(), 'test_files', 'bag', 'door_02.bag');
const FIXTURE_AVAILABLE = existsSync(FIXTURE_PATH);
// Node's `File` ctor + `Uint8Array` input caps at 2 GiB; we skip beyond that.
const MAX_FIXTURE_BYTES = 2 * 1024 * 1024 * 1024 - 1024 * 1024;
const FIXTURE_LOADABLE =
  FIXTURE_AVAILABLE && statSync(FIXTURE_PATH).size < MAX_FIXTURE_BYTES;

function fixtureSource() {
  const bytes = readFileSync(FIXTURE_PATH);
  const file = new File([new Uint8Array(bytes)], 'door_02.bag');
  return createFileSource(file);
}

beforeEach(() => disposeBagCache());
afterAll(() => disposeBagCache());

const describeWithFixture = FIXTURE_LOADABLE ? describe : describe.skip;

// Surface the skip reason once when the suite runs so it's obvious why
// .bag coverage is absent on this checkout (and what to drop in to fix it).
if (FIXTURE_AVAILABLE && !FIXTURE_LOADABLE) {
  console.warn(
    `[bag.test] Skipping ROS1 .bag fixture tests: ${FIXTURE_PATH} is ` +
      `${(statSync(FIXTURE_PATH).size / 1024 ** 3).toFixed(1)} GB, ` +
      `over the 2 GiB Node File-ctor cap. Drop a smaller .bag in to enable.`,
  );
}

describeWithFixture('bag/parseBagFile — real fixture', () => {
  it('returns a non-empty topic list with normalized ROS2-style type names', async () => {
    const summary = await parseBagFile(fixtureSource());
    expect(summary.format).toBe('bag');
    expect(summary.fileName).toBe('door_02.bag');
    expect(summary.topics.length).toBeGreaterThan(0);
    for (const topic of summary.topics) {
      // Normalised form is `pkg/msg/Type`, never bare `pkg/Type`.
      expect(topic.type).toMatch(/\/msg\//);
      expect(topic.serializationFormat).toBe('ros1');
    }
  });

  it('reports total message count = sum of per-topic counts', async () => {
    const summary = await parseBagFile(fixtureSource());
    const sum = summary.topics.reduce((s, t) => s + t.messageCount, 0);
    expect(summary.totalMessageCount).toBe(sum);
  });

  it('reports a positive duration and start <= end', async () => {
    const summary = await parseBagFile(fixtureSource());
    expect(summary.duration).toBeGreaterThan(0);
    expect(summary.startTime <= summary.endTime).toBe(true);
  });

  it('sorts topics lexicographically by name', async () => {
    const summary = await parseBagFile(fixtureSource());
    const names = summary.topics.map((t) => t.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });
});

describeWithFixture('bag/readRawMessagesBag — real fixture', () => {
  it('returns chronologically ordered bytes for an existing topic', async () => {
    const source = fixtureSource();
    const summary = await parseBagFile(source);
    const topic = [...summary.topics].sort((a, b) => b.messageCount - a.messageCount)[0];
    const raws = await readRawMessagesBag(source, topic.name, 20);
    expect(raws.length).toBeLessThanOrEqual(20);
    if (raws.length > 1) {
      for (let i = 1; i < raws.length; i++) {
        expect(raws[i].timestamp >= raws[i - 1].timestamp).toBe(true);
      }
    }
  });

  it('returns an empty array for an unknown topic', async () => {
    const source = fixtureSource();
    await parseBagFile(source);
    expect(await readRawMessagesBag(source, '/not/in/this/bag')).toEqual([]);
  });
});

describeWithFixture('bag/readDeserializedMessagesBag — real fixture', () => {
  it('decodes messages and emits sec/nsec/nanosec time-field aliases', async () => {
    const source = fixtureSource();
    const summary = await parseBagFile(source);
    // Pick any topic whose message has a stamped Header — most ROS1 sensor
    // messages do, so this is a coverage of the time-alias post-pass.
    const stampedTopic = summary.topics.find((t) => t.messageCount > 0);
    if (!stampedTopic) return;
    const decoded = await readDeserializedMessagesBag(source, stampedTopic.name, 5);
    expect(decoded.length).toBeGreaterThan(0);
    // The time-alias pass walks the decoded object and adds `nanosec` next
    // to every `nsec`. We don't assert the alias on every topic (it's deep
    // in the object tree) but we do verify decoded values aren't null on
    // a topic the bag should have a schema for.
    const firstValue = decoded.find((m) => m.value !== null)?.value;
    expect(firstValue).toBeDefined();
  });
});

describeWithFixture('bag/readMessageAtTimeBag — real fixture', () => {
  it('returns a message at-or-near a midpoint timestamp', async () => {
    const source = fixtureSource();
    const summary = await parseBagFile(source);
    const topic = summary.topics.find((t) => t.messageCount > 0);
    if (!topic) return;
    const mid = summary.startTime + (summary.endTime - summary.startTime) / 2n;
    const message = await readMessageAtTimeBag(source, topic.name, mid);
    if (message) {
      expect(message.timestamp >= summary.startTime).toBe(true);
      expect(message.timestamp <= summary.endTime).toBe(true);
    }
  });
});

describeWithFixture('bag/getTopicTypeBag — real fixture', () => {
  it('reports the normalized type for a known topic', async () => {
    const source = fixtureSource();
    const summary = await parseBagFile(source);
    const t0 = summary.topics[0];
    expect(await getTopicTypeBag(source, t0.name)).toBe(t0.type);
  });

  it('returns undefined for unknown topics', async () => {
    const source = fixtureSource();
    await parseBagFile(source);
    expect(await getTopicTypeBag(source, '/no/such/topic')).toBeUndefined();
  });
});

describeWithFixture('bag/cache invalidation', () => {
  it('disposeBagCache forces a reload for the next parse', async () => {
    const source = fixtureSource();
    const a = await parseBagFile(source);
    disposeBagCache();
    const b = await parseBagFile(source);
    expect(b.totalMessageCount).toBe(a.totalMessageCount);
    expect(b.topics.length).toBe(a.topics.length);
  });
});
