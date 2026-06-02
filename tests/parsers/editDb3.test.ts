/**
 * Tests for the v1.2 ROS2 .db3 edit pipeline (`src/parsers/editDb3.ts`).
 *
 * Inputs come from the in-memory sql.js writer in `tests/fixtures/synth.ts`.
 * Outputs are verified by re-opening with `McapIndexedReader` so the
 * cross-format invariants (`schemaEncoding: 'ros2msg'`, `messageEncoding:
 * 'cdr'`) and the round-trip decode are checked together.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { McapIndexedReader } from '@mcap/core';
import {
  editDb3Bag,
  estimateMessageCountDb3,
  getResolvableTopicsDb3,
} from '../../src/parsers/editDb3';
import {
  parseMcap,
  readDeserializedMessagesMcap,
  disposeMcapCache,
} from '../../src/parsers/mcap';
import { disposeDb3Cache } from '../../src/parsers/db3';
import { setCustomSchemas } from '../../src/parsers/typeRegistry';
import { createFileSource } from '../../src/parsers/source';
import {
  bytesToFile,
  chatterDb3Bag,
  multiTopicDb3Bag,
} from '../fixtures/synth';

beforeEach(() => {
  disposeDb3Cache();
  disposeMcapCache();
  // Reset custom schemas so the override test doesn't leak into others.
  setCustomSchemas({});
});

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

describe('editDb3/editDb3Bag', () => {
  it('round-trips a tiny chatter .db3 unchanged when no filter applied', async () => {
    const input = bytesToFile(await chatterDb3Bag(), 'chatter.db3');
    const result = await editDb3Bag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
    });
    expect(result.messageCount).toBe(3);

    const summary = await parseMcap(
      createFileSource(bytesToFile(result.bytes, 'chatter.edited.mcap')),
    );
    expect(summary.topics).toHaveLength(1);
    expect(summary.topics[0].name).toBe('/chatter');
    expect(summary.topics[0].type).toBe('std_msgs/msg/String');
  });

  it('trims to the requested time window inclusive of both bounds', async () => {
    // chatterDb3Bag emits at 1s, 2s, 3s. Trim to [1.5s, 2.5s] -> 2s survives.
    const input = bytesToFile(await chatterDb3Bag(), 'chatter.db3');
    const result = await editDb3Bag(createFileSource(input), {
      startNs: 1_500_000_000n,
      endNs: 2_500_000_000n,
    });
    expect(result.messageCount).toBe(1);
    expect(result.startNs).toBe(2_000_000_000n);
    expect(result.endNs).toBe(2_000_000_000n);
  });

  it('drops a topic when the include list excludes it', async () => {
    const input = bytesToFile(await multiTopicDb3Bag(), 'multi.db3');
    // Keep only /ints; drop /mystery.
    const result = await editDb3Bag(createFileSource(input), {
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

  it('synthesises ros2msg schemas that round-trip through MCAP decode', async () => {
    // Edit /chatter through the full pipeline; the output MCAP should
    // re-parse via parseMcap and the messages should decode back to the
    // original `data` field values via readDeserializedMessagesMcap.
    const input = bytesToFile(await chatterDb3Bag(), 'chatter.db3');
    const result = await editDb3Bag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
    });
    disposeMcapCache();
    const decoded = await readDeserializedMessagesMcap(
      createFileSource(bytesToFile(result.bytes, 'chatter.edited.mcap')),
      '/chatter',
    );
    expect(decoded).toHaveLength(3);
    expect((decoded[0].value as { data: string }).data).toBe('hello');
    expect((decoded[1].value as { data: string }).data).toBe('world');
    expect((decoded[2].value as { data: string }).data).toBe('bagel');
  });

  it('writes cdr messageEncoding and ros2msg schemaEncoding on every channel', async () => {
    const input = bytesToFile(await chatterDb3Bag(), 'chatter.db3');
    const result = await editDb3Bag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
    });
    const reader = await McapIndexedReader.Initialize({
      readable: makeReadable(result.bytes),
    });
    expect(reader.channelsById.size).toBeGreaterThan(0);
    for (const channel of reader.channelsById.values()) {
      expect(channel.messageEncoding).toBe('cdr');
    }
    for (const schema of reader.schemasById.values()) {
      expect(schema.encoding).toBe('ros2msg');
    }
  });

  it('skips topics whose type is not in the registry by default, with a warning', async () => {
    // multiTopicDb3Bag has /mystery with type 'custom_msgs/msg/Mystery' which
    // isn't in the bundled registry. Default behaviour: skip it.
    const warns: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: unknown[]) => warns.push(args.join(' '));
    try {
      const input = bytesToFile(await multiTopicDb3Bag(), 'multi.db3');
      const result = await editDb3Bag(createFileSource(input), {
        startNs: 0n,
        endNs: 10_000_000_000n,
      });
      // Only /ints survives: 2 messages.
      expect(result.messageCount).toBe(2);
      // The warning mentions /mystery.
      expect(warns.some((w) => w.includes('/mystery'))).toBe(true);
    } finally {
      console.warn = origWarn;
    }
  });

  it('includes unresolvable topics when opted in, with a schema-less channel', async () => {
    const input = bytesToFile(await multiTopicDb3Bag(), 'multi.db3');
    const result = await editDb3Bag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
      includeUnresolvedTopics: ['/mystery'],
    });
    // /ints (2 messages) + /mystery (1 message) = 3.
    expect(result.messageCount).toBe(3);

    const reader = await McapIndexedReader.Initialize({
      readable: makeReadable(result.bytes),
    });
    // Find the /mystery channel and confirm it has schemaId 0.
    let mysteryChannel: { schemaId: number } | undefined;
    for (const channel of reader.channelsById.values()) {
      if (channel.topic === '/mystery') mysteryChannel = channel;
    }
    expect(mysteryChannel).toBeDefined();
    expect(mysteryChannel!.schemaId).toBe(0);
  });

  it('lets a custom user schema win over the bundled registry', async () => {
    // Override std_msgs/Int32 with a schema that has the same wire layout
    // but a renamed field (`value` instead of `data`). The decode round-trip
    // confirms the custom schema flowed through.
    setCustomSchemas({
      'std_msgs/msg/Int32': 'int32 value\n',
    });
    const input = bytesToFile(await multiTopicDb3Bag(), 'multi.db3');
    const result = await editDb3Bag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
      topics: ['/ints'],
    });

    const reader = await McapIndexedReader.Initialize({
      readable: makeReadable(result.bytes),
    });
    let intsSchemaText: string | undefined;
    for (const channel of reader.channelsById.values()) {
      if (channel.topic === '/ints') {
        const schema = reader.schemasById.get(channel.schemaId);
        if (schema) intsSchemaText = new TextDecoder().decode(schema.data);
      }
    }
    expect(intsSchemaText).toBeDefined();
    expect(intsSchemaText).toContain('int32 value');
  });

  it('uses the bagel-edit/db3 library tag in the output header', async () => {
    const input = bytesToFile(await chatterDb3Bag(), 'chatter.db3');
    const result = await editDb3Bag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
    });
    const reader = await McapIndexedReader.Initialize({
      readable: makeReadable(result.bytes),
    });
    expect(reader.header.library).toBe('bagel-edit/db3');
    expect(reader.header.profile).toBe('ros2');
  });

  it('rejects an empty time window with a specific error', async () => {
    const input = bytesToFile(await chatterDb3Bag(), 'chatter.db3');
    await expect(
      editDb3Bag(createFileSource(input), {
        startNs: 2_000_000_000n,
        endNs: 2_000_000_000n,
      }),
    ).rejects.toThrow(/Edit window is empty/);
  });
});

describe('editDb3/estimateMessageCountDb3', () => {
  it('returns precise SQL counts for the trim window', async () => {
    const input = bytesToFile(await chatterDb3Bag(), 'chatter.db3');
    expect(
      await estimateMessageCountDb3(
        createFileSource(input),
        1_500_000_000n,
        2_500_000_000n,
        null,
      ),
    ).toBe(1);
    expect(
      await estimateMessageCountDb3(
        createFileSource(input),
        0n,
        10_000_000_000n,
        null,
      ),
    ).toBe(3);
  });

  it('respects topic include sets', async () => {
    const input = bytesToFile(await multiTopicDb3Bag(), 'multi.db3');
    expect(
      await estimateMessageCountDb3(
        createFileSource(input),
        0n,
        10_000_000_000n,
        new Set(['/ints']),
      ),
    ).toBe(2);
    expect(
      await estimateMessageCountDb3(
        createFileSource(input),
        0n,
        10_000_000_000n,
        new Set(['/mystery']),
      ),
    ).toBe(1);
  });

  it('returns 0 when the include set is empty', async () => {
    const input = bytesToFile(await chatterDb3Bag(), 'chatter.db3');
    expect(
      await estimateMessageCountDb3(
        createFileSource(input),
        0n,
        10_000_000_000n,
        new Set(),
      ),
    ).toBe(0);
  });
});

describe('editDb3/getResolvableTopicsDb3', () => {
  it('marks bundled types as resolvable and unknown types as not', async () => {
    const input = bytesToFile(await multiTopicDb3Bag(), 'multi.db3');
    const resolutions = await getResolvableTopicsDb3(createFileSource(input));
    const byTopic = new Map(resolutions.map((r) => [r.topic, r]));
    expect(byTopic.get('/ints')?.resolvable).toBe(true);
    expect(byTopic.get('/mystery')?.resolvable).toBe(false);
  });
});
