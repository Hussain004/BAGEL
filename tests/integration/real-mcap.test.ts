/**
 * Integration test against the real MCAP fixture in test_files/mcap/.
 *
 * Verifies that the parser handles a real ROS2 recorder output — chunked,
 * possibly compressed, multi-megabyte — through the unified entry, not
 * just the synthetic in-memory bags. Skips automatically when the fixture
 * is missing or larger than what `readFileSync` + `File` can hold.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { parseBag, disposeParserCaches } from '../../src/parsers/core';
import { createFileSource } from '../../src/parsers/source';

const FIXTURE_PATH = join(
  process.cwd(),
  'test_files',
  'mcap',
  'pose_topics',
  'rosbag2_2024_02_10-14_24_59_0.mcap',
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_PATH);
// Node's File ctor input must fit in a single ArrayBuffer (≤2 GiB).
const MAX_FIXTURE_BYTES = 2 * 1024 * 1024 * 1024 - 1024 * 1024;
const FIXTURE_LOADABLE =
  FIXTURE_AVAILABLE && statSync(FIXTURE_PATH).size < MAX_FIXTURE_BYTES;

beforeEach(() => disposeParserCaches());
afterAll(() => disposeParserCaches());

const describeWithFixture = FIXTURE_LOADABLE ? describe : describe.skip;

if (FIXTURE_AVAILABLE && !FIXTURE_LOADABLE) {
  console.warn(
    `[real-mcap.test] Skipping: ${FIXTURE_PATH} is ` +
      `${(statSync(FIXTURE_PATH).size / 1024 ** 3).toFixed(1)} GB, over the ` +
      `2 GiB Node File-ctor cap.`,
  );
}

describeWithFixture('integration/real-mcap — parseBag against a real ROS2 recording', () => {
  function fixtureSource() {
    const bytes = readFileSync(FIXTURE_PATH);
    return createFileSource(new File([new Uint8Array(bytes)], 'pose_topics.mcap'));
  }

  it('opens cleanly and returns a non-empty topic list', async () => {
    const summary = await parseBag(fixtureSource());
    expect(summary.format).toBe('mcap');
    expect(summary.topics.length).toBeGreaterThan(0);
    expect(summary.totalMessageCount).toBeGreaterThan(0);
  });

  it('every topic has a valid (non-unknown) schema name', async () => {
    const summary = await parseBag(fixtureSource());
    for (const topic of summary.topics) {
      expect(topic.type).not.toBe('unknown');
      expect(topic.type.length).toBeGreaterThan(0);
    }
  });

  it('produces a positive duration with start <= end', async () => {
    const summary = await parseBag(fixtureSource());
    expect(summary.duration).toBeGreaterThan(0);
    expect(summary.startTime <= summary.endTime).toBe(true);
  });

  it('the summed per-topic counts match totalMessageCount', async () => {
    const summary = await parseBag(fixtureSource());
    const sum = summary.topics.reduce((s, t) => s + t.messageCount, 0);
    expect(summary.totalMessageCount).toBe(sum);
  });
});
