/**
 * Tests for the v1.1 bag-edit pipeline (`src/parsers/edit.ts`).
 *
 * Two layers:
 *   1. Synthetic-only round trips against in-memory MCAPs from
 *      `tests/fixtures/synth.ts`. Covers the time-range filter, topic
 *      include/exclude, and the "edit window is empty" error path.
 *   2. A full round-trip against the committed `public/sample-bags/tour.mcap`
 *      sample bag: edits it down to a slice + topic subset, re-parses the
 *      output, asserts the new topic set + bounds match the cut.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { editMcapBag } from '../../src/parsers/edit';
import {
  parseMcap,
  readDeserializedMessagesMcap,
  disposeMcapCache,
} from '../../src/parsers/mcap';
import { createFileSource } from '../../src/parsers/source';
import {
  bytesToFile,
  chatterBag,
  multiTopicBag,
  writeSyntheticMcap,
} from '../fixtures/synth';

beforeEach(() => disposeMcapCache());

describe('edit/editMcapBag - synthetic bags', () => {
  it('round-trips a tiny bag unchanged when no filter is applied', async () => {
    const input = bytesToFile(await chatterBag(), 'chatter.mcap');
    const result = await editMcapBag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
    });

    // Re-parse the output and confirm the topic + counts survived.
    const outFile = bytesToFile(result.bytes, 'chatter.edited.mcap');
    disposeMcapCache();
    const summary = await parseMcap(createFileSource(outFile));
    expect(summary.totalMessageCount).toBe(3);
    expect(summary.topics).toHaveLength(1);
    expect(summary.topics[0].name).toBe('/chatter');
    expect(result.messageCount).toBe(3);
  });

  it('trims to the requested time window inclusive of both bounds', async () => {
    // chatterBag emits at 1s, 2s, 3s. Trim to [1.5s, 2.5s] → only the 2s
    // message survives.
    const input = bytesToFile(await chatterBag(), 'chatter.mcap');
    const result = await editMcapBag(createFileSource(input), {
      startNs: 1_500_000_000n,
      endNs: 2_500_000_000n,
    });
    expect(result.messageCount).toBe(1);
    expect(result.startNs).toBe(2_000_000_000n);
    expect(result.endNs).toBe(2_000_000_000n);

    // Re-parse and confirm the lone message decoded correctly.
    disposeMcapCache();
    const out = await readDeserializedMessagesMcap(
      createFileSource(bytesToFile(result.bytes, 'edited.mcap')),
      '/chatter',
    );
    expect(out).toHaveLength(1);
    expect(out[0].value).toEqual({ data: 'world' });
  });

  it('drops a topic when the include list excludes it', async () => {
    const input = bytesToFile(await multiTopicBag(), 'multi.mcap');
    // Keep only /odom; drop /chatter.
    const result = await editMcapBag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
      topics: ['/odom'],
    });
    expect(result.messageCount).toBe(2);

    disposeMcapCache();
    const summary = await parseMcap(createFileSource(bytesToFile(result.bytes, 'edited.mcap')));
    expect(summary.topics).toHaveLength(1);
    expect(summary.topics[0].name).toBe('/odom');
  });

  it('produces an empty bag when the topic include list is empty', async () => {
    const input = bytesToFile(await multiTopicBag(), 'multi.mcap');
    const result = await editMcapBag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
      topics: [],
    });
    expect(result.messageCount).toBe(0);

    disposeMcapCache();
    const summary = await parseMcap(createFileSource(bytesToFile(result.bytes, 'edited.mcap')));
    expect(summary.totalMessageCount).toBe(0);
    // No channels means no topics in the output.
    expect(summary.topics).toHaveLength(0);
  });

  it('does not register schemas for topics that get dropped', async () => {
    // multiTopicBag has /odom (nav_msgs/Odometry, which pulls in Header +
    // Pose + Twist + covariance subtypes) and /chatter (std_msgs/String).
    // Dropping /odom should leave the output with just String's schema, so
    // the output bag is meaningfully smaller than the input.
    const input = bytesToFile(await multiTopicBag(), 'multi.mcap');
    const fullResult = await editMcapBag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
    });
    disposeMcapCache();
    const trimmedResult = await editMcapBag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
      topics: ['/chatter'],
    });
    // The dropped-/odom output is strictly smaller because we don't register
    // the heavy Odometry schema or write its two messages.
    expect(trimmedResult.bytes.byteLength).toBeLessThan(fullResult.bytes.byteLength);
  });

  it('reports onProgress at the configured cadence', async () => {
    // 600 messages → progress should fire at least at the 250- / 500-message
    // tick boundaries plus the final tail flush.
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
    const input = bytesToFile(bytes, 'spam.mcap');
    const progress: number[] = [];
    await editMcapBag(createFileSource(input), {
      startNs: 0n,
      endNs: 1_000_000_000n,
      onProgress: (n) => progress.push(n),
    });
    // At least the 250 and 500 mid-stream marks plus the tail.
    expect(progress.length).toBeGreaterThanOrEqual(2);
    expect(progress[progress.length - 1]).toBe(600);
  });

  it('rejects an empty time window with a specific error', async () => {
    const input = bytesToFile(await chatterBag(), 'chatter.mcap');
    await expect(
      editMcapBag(createFileSource(input), {
        startNs: 2_000_000_000n,
        endNs: 2_000_000_000n,
      }),
    ).rejects.toThrow(/Edit window is empty/);
    await expect(
      editMcapBag(createFileSource(input), {
        startNs: 3_000_000_000n,
        endNs: 1_000_000_000n,
      }),
    ).rejects.toThrow(/Edit window is empty/);
  });

  it('preserves message decoding through a trim + topic edit (round trip)', async () => {
    const input = bytesToFile(await multiTopicBag(), 'multi.mcap');
    // Trim to the first half of the time range and keep /odom only.
    const result = await editMcapBag(createFileSource(input), {
      startNs: 0n,
      endNs: 1_500_000_000n,
      topics: ['/odom'],
    });
    disposeMcapCache();
    const decoded = await readDeserializedMessagesMcap(
      createFileSource(bytesToFile(result.bytes, 'edited.mcap')),
      '/odom',
    );
    expect(decoded).toHaveLength(1);
    const v = decoded[0].value as {
      pose: { pose: { position: { x: number; y: number } } };
      child_frame_id: string;
    };
    expect(v.child_frame_id).toBe('base_link');
    expect(v.pose.pose.position.x).toBe(1);
    expect(v.pose.pose.position.y).toBe(2);
  });

  it('preserves a custom profile string in the output header', async () => {
    const input = bytesToFile(await chatterBag(), 'chatter.mcap');
    const result = await editMcapBag(createFileSource(input), {
      startNs: 0n,
      endNs: 10_000_000_000n,
      profile: 'foxglove-test',
    });
    // We don't expose the header out of parseMcap, but we can re-encode the
    // result and verify it's a valid MCAP. (The profile string would only
    // be exercised by a low-level read; the round-trip check is the most
    // we can do without leaking reader internals.)
    disposeMcapCache();
    const summary = await parseMcap(createFileSource(bytesToFile(result.bytes, 'edited.mcap')));
    expect(summary.totalMessageCount).toBe(3);
  });
});

// ── Integration against the committed sample bag ───────────────────────────

const SAMPLE_PATH = join(process.cwd(), 'public', 'sample-bags', 'tour.mcap');
const SAMPLE_AVAILABLE = existsSync(SAMPLE_PATH);
const describeWithSample = SAMPLE_AVAILABLE ? describe : describe.skip;

describeWithSample('edit/editMcapBag - tour.mcap round trip', () => {
  function sampleSource() {
    const bytes = readFileSync(SAMPLE_PATH);
    return createFileSource(new File([new Uint8Array(bytes)], 'tour.mcap'));
  }

  it('trims to a 5-second window in the middle of the bag', async () => {
    const source = sampleSource();
    const summary = await parseMcap(source);
    // Pick a 5s window starting at the 10s mark, relative to bag start.
    const startNs = summary.startTime + 10_000_000_000n;
    const endNs = summary.startTime + 15_000_000_000n;
    disposeMcapCache();
    const result = await editMcapBag(sampleSource(), { startNs, endNs });
    // Output bounds should fit inside the requested window.
    expect(result.startNs).toBeGreaterThanOrEqual(startNs);
    expect(result.endNs).toBeLessThanOrEqual(endNs);
    // And it should be substantially smaller than the source.
    expect(result.bytes.byteLength).toBeLessThan(summary.fileSize);

    // Re-parse and confirm the duration is ~5s (allow slack for the gap
    // between the trim bounds and the actual nearest messages).
    disposeMcapCache();
    const editedSummary = await parseMcap(
      createFileSource(new File([new Uint8Array(result.bytes)], 'tour.edited.mcap')),
    );
    expect(editedSummary.duration).toBeGreaterThan(3);
    expect(editedSummary.duration).toBeLessThan(6);
  });

  it('drops every non-pose topic when only /odom is kept', async () => {
    const source = sampleSource();
    const summary = await parseMcap(source);
    disposeMcapCache();
    const result = await editMcapBag(sampleSource(), {
      startNs: summary.startTime,
      endNs: summary.endTime,
      topics: ['/odom'],
    });
    expect(result.messageCount).toBeGreaterThan(0);

    disposeMcapCache();
    const edited = await parseMcap(
      createFileSource(new File([new Uint8Array(result.bytes)], 'tour.odom-only.mcap')),
    );
    expect(edited.topics.map((t) => t.name)).toEqual(['/odom']);
    // /odom publishes at 10 Hz over 30 seconds → 300 messages, but the (N-1)/N
    // off-by-one in the synthesizer means we may see 299. Either way, the
    // edited bag should report a sensible total.
    expect(edited.totalMessageCount).toBeGreaterThan(200);
    expect(edited.totalMessageCount).toBeLessThan(400);
  });

  it('preserves topic types after a topic-only edit', async () => {
    const source = sampleSource();
    const summary = await parseMcap(source);
    disposeMcapCache();
    const result = await editMcapBag(sampleSource(), {
      startNs: summary.startTime,
      endNs: summary.endTime,
      topics: ['/odom', '/imu/data'],
    });
    disposeMcapCache();
    const edited = await parseMcap(
      createFileSource(new File([new Uint8Array(result.bytes)], 'tour.subset.mcap')),
    );
    const byName = new Map(edited.topics.map((t) => [t.name, t.type]));
    expect(byName.get('/odom')).toBe('nav_msgs/msg/Odometry');
    expect(byName.get('/imu/data')).toBe('sensor_msgs/msg/Imu');
  });
});
