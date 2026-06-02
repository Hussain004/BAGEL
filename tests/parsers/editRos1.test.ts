/**
 * Tests for the v1.2 ROS1 .bag edit pipeline (`src/parsers/editRos1.ts`).
 *
 * All bag inputs come from the in-memory ROS1 writer in `tests/fixtures/synth.ts`
 * (hand-rolled v2.0 bag format - `@foxglove/rosbag` ships a reader but no
 * writer). Outputs are verified by re-opening with `McapIndexedReader` so we
 * also assert the cross-format invariants (`schemaEncoding: 'ros1msg'`,
 * `messageEncoding: 'ros1'`).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { McapIndexedReader } from '@mcap/core';
import { editRos1Bag, estimateMessageCountRos1 } from '../../src/parsers/editRos1';
import { parseMcap, disposeMcapCache } from '../../src/parsers/mcap';
import { disposeBagCache } from '../../src/parsers/bag';
import { createFileSource } from '../../src/parsers/source';
import {
  bytesToFile,
  chatterRos1Bag,
  encodeRos1Int32,
  multiTopicRos1Bag,
  writeSyntheticRos1Bag,
} from '../fixtures/synth';

beforeEach(() => {
  disposeBagCache();
  disposeMcapCache();
});

// Minimal in-memory IReadable wrapping a Uint8Array, used to feed the
// output bytes back through @mcap/core for assertions.
function makeReadable(bytes: Uint8Array) {
  return {
    size: () => BigInt(bytes.byteLength),
    async read(offset: bigint, length: bigint): Promise<Uint8Array> {
      const start = Number(offset);
      const end = start + Number(length);
      return bytes.subarray(start, end);
    },
  };
}

describe('editRos1/editRos1Bag', () => {
  it('round-trips a tiny chatter bag unchanged when no filter applied', async () => {
    const bytes = await chatterRos1Bag();
    const input = bytesToFile(bytes, 'chatter.bag');
    const result = await editRos1Bag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
    });
    expect(result.messageCount).toBe(3);

    const summary = await parseMcap(
      createFileSource(bytesToFile(result.bytes, 'chatter.edited.mcap')),
    );
    expect(summary.topics).toHaveLength(1);
    expect(summary.topics[0].name).toBe('/chatter');
    expect(summary.topics[0].messageCount).toBe(3);
  });

  it('trims to the requested time window inclusive of both bounds', async () => {
    // chatterRos1Bag emits at 1s, 2s, 3s. Trim to [1.5s, 2.5s] -> only 2s survives.
    const input = bytesToFile(await chatterRos1Bag(), 'chatter.bag');
    const result = await editRos1Bag(createFileSource(input), {
      startNs: 1_500_000_000n,
      endNs: 2_500_000_000n,
    });
    expect(result.messageCount).toBe(1);
    expect(result.startNs).toBe(2_000_000_000n);
    expect(result.endNs).toBe(2_000_000_000n);
  });

  it('drops a topic when the include list excludes it', async () => {
    const input = bytesToFile(await multiTopicRos1Bag(), 'multi.bag');
    const result = await editRos1Bag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
      topics: ['/ints'],
    });
    expect(result.messageCount).toBe(2);

    const summary = await parseMcap(
      createFileSource(bytesToFile(result.bytes, 'multi.edited.mcap')),
    );
    expect(summary.topics).toHaveLength(1);
    expect(summary.topics[0].name).toBe('/ints');
  });

  it('writes ros1 messageEncoding and ros1msg schemaEncoding on every channel', async () => {
    const input = bytesToFile(await multiTopicRos1Bag(), 'multi.bag');
    const result = await editRos1Bag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
    });

    const reader = await McapIndexedReader.Initialize({
      readable: makeReadable(result.bytes),
    });
    expect(reader.channelsById.size).toBeGreaterThan(0);
    for (const channel of reader.channelsById.values()) {
      expect(channel.messageEncoding).toBe('ros1');
    }
    for (const schema of reader.schemasById.values()) {
      expect(schema.encoding).toBe('ros1msg');
      // The schema data is the original `.msg` text from the connection,
      // so a known type like Int32 has a recognisable first line.
      expect(new TextDecoder().decode(schema.data)).toMatch(/string data|int32 data/);
    }
  });

  it('uses the bagel-edit/ros1 library tag in the output header', async () => {
    const input = bytesToFile(await chatterRos1Bag(), 'chatter.bag');
    const result = await editRos1Bag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
    });
    const reader = await McapIndexedReader.Initialize({
      readable: makeReadable(result.bytes),
    });
    expect(reader.header.library).toBe('bagel-edit/ros1');
    expect(reader.header.profile).toBe('ros1');
  });

  it('fires onProgress at the configured cadence on >250 messages', async () => {
    // 300 int32 messages on one topic -> at least the 250-mark and the tail.
    const ros1Bytes = await writeSyntheticRos1Bag([
      {
        topic: '/spam',
        type: 'std_msgs/Int32',
        messageDefinition: 'int32 data\n',
        messages: Array.from({ length: 300 }, (_, i) => ({
          time: { sec: 0, nsec: (i + 1) * 1_000_000 },
          data: encodeRos1Int32(i),
        })),
      },
    ]);
    const progress: number[] = [];
    await editRos1Bag(createFileSource(bytesToFile(ros1Bytes, 'spam.bag')), {
      startNs: 0n,
      endNs: 1_000_000_000n,
      onProgress: (n) => progress.push(n),
    });
    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(progress[progress.length - 1]).toBe(300);
  });

  it('rejects an empty time window with a specific error', async () => {
    const input = bytesToFile(await chatterRos1Bag(), 'chatter.bag');
    await expect(
      editRos1Bag(createFileSource(input), {
        startNs: 2_000_000_000n,
        endNs: 2_000_000_000n,
      }),
    ).rejects.toThrow(/Edit window is empty/);
  });
});

describe('editRos1/estimateMessageCountRos1', () => {
  it('returns the topic-filtered count scaled by the time-window fraction', async () => {
    // chatter: 3 messages spanning t=1s..t=3s. Trim to [1.5s, 2.5s] -> fraction
    // is 1/2, scaled count is ceil(3 * 0.5) = 2.
    const input = bytesToFile(await chatterRos1Bag(), 'chatter.bag');
    const estimate = await estimateMessageCountRos1(
      createFileSource(input),
      1_500_000_000n,
      2_500_000_000n,
      null,
    );
    expect(estimate).toBe(2);
  });

  it('respects topic include sets', async () => {
    const input = bytesToFile(await multiTopicRos1Bag(), 'multi.bag');
    // Just /ints (2 messages over [1s, 2s]) over the full bag window -> 2.
    const estimate = await estimateMessageCountRos1(
      createFileSource(input),
      0n,
      10_000_000_000n,
      new Set(['/ints']),
    );
    expect(estimate).toBe(2);
  });
});
