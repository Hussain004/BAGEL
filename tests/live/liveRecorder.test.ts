import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { LiveRecorder, MAX_RECORD_BYTES } from '../../src/live/liveRecorder';
import type { FoxgloveChannel } from '../../src/live/foxgloveClient';
import { parseMcap, readRawMessagesMcap, loadMcapForEdit, disposeMcapCache } from '../../src/parsers/mcap';
import { createFileSource } from '../../src/parsers/source';
import { bytesToFile } from '../fixtures/synth';

// MCAP files always start with this 8-byte magic sequence.
const MCAP_MAGIC = new Uint8Array([0x89, 0x4d, 0x43, 0x41, 0x50, 0x30, 0x0d, 0x0a]);

// Each finish() output gets a unique file name so the parser cache never
// reuses a previous recording's entry (cache keys include name + size).
let fileSeq = 0;
function recordingSource(bytes: Uint8Array) {
  fileSeq += 1;
  return createFileSource(bytesToFile(bytes, `recording-${fileSeq}.mcap`));
}

beforeEach(() => disposeMcapCache());
afterAll(() => disposeMcapCache());

function makeChannel(id: number, topic: string, encoding = 'cdr'): FoxgloveChannel {
  return {
    id,
    topic,
    encoding,
    schemaName: 'std_msgs/msg/String',
    schema: 'string data',
    schemaEncoding: 'ros2msg',
  };
}

function makeData(byte: number, len = 4): Uint8Array {
  return new Uint8Array(len).fill(byte);
}

describe('LiveRecorder', () => {
  it('starts with zero counts and null times', () => {
    const r = new LiveRecorder();
    expect(r.messageCount).toBe(0);
    expect(r.byteCount).toBe(0);
    expect(r.startTimeNs).toBeNull();
    expect(r.endTimeNs).toBeNull();
  });

  it('addMessage increments messageCount', () => {
    const r = new LiveRecorder();
    const ch = makeChannel(1, '/foo');
    r.addMessage(ch, 100n, makeData(1));
    r.addMessage(ch, 200n, makeData(2));
    expect(r.messageCount).toBe(2);
  });

  it('addMessage accumulates byteCount', () => {
    const r = new LiveRecorder();
    const ch = makeChannel(1, '/foo');
    r.addMessage(ch, 100n, new Uint8Array(3));
    r.addMessage(ch, 200n, new Uint8Array(5));
    expect(r.byteCount).toBe(8);
  });

  it('tracks startTimeNs and endTimeNs across pushes', () => {
    const r = new LiveRecorder();
    const ch = makeChannel(1, '/foo');
    r.addMessage(ch, 100n, makeData(0));
    r.addMessage(ch, 500n, makeData(0));
    r.addMessage(ch, 999n, makeData(0));
    expect(r.startTimeNs).toBe(100n);
    expect(r.endTimeNs).toBe(999n);
  });

  it('copies message data so the original buffer can be mutated', () => {
    const r = new LiveRecorder();
    const ch = makeChannel(1, '/foo');
    const original = new Uint8Array([1, 2, 3]);
    r.addMessage(ch, 100n, original);
    // Mutate the original - the recorder's copy must be unaffected.
    original[0] = 99;
    expect(r.messageCount).toBe(1);
    expect(r.byteCount).toBe(3);
  });

  it('finish() round-trips an empty recording through parseMcap', async () => {
    const r = new LiveRecorder();
    const bytes = await r.finish();
    expect(bytes.slice(0, 8)).toEqual(MCAP_MAGIC);
    expect(bytes.byteLength).toBeGreaterThan(8);

    const summary = await parseMcap(recordingSource(bytes));
    expect(summary.format).toBe('mcap');
    expect(summary.totalMessageCount).toBe(0);
    expect(summary.topics).toEqual([]);
    expect(summary.duration).toBe(0);
    expect(summary.startTime).toBe(0n);
    expect(summary.endTime).toBe(0n);
  });

  it('finish() round-trips recorded messages through parseMcap + raw reads', async () => {
    const r = new LiveRecorder();
    const ch = makeChannel(1, '/scan');
    r.addMessage(ch, 1000n, makeData(0xab, 8));
    r.addMessage(ch, 2000n, makeData(0xcd, 8));
    const bytes = await r.finish();
    expect(bytes.slice(0, 8)).toEqual(MCAP_MAGIC);

    const source = recordingSource(bytes);
    const summary = await parseMcap(source);
    expect(summary.totalMessageCount).toBe(2);
    expect(summary.topics).toHaveLength(1);
    expect(summary.topics[0]).toMatchObject({
      name: '/scan',
      type: 'std_msgs/msg/String',
      messageCount: 2,
      serializationFormat: 'cdr',
    });
    expect(summary.startTime).toBe(1000n);
    expect(summary.endTime).toBe(2000n);

    const raws = await readRawMessagesMcap(source, '/scan');
    expect(raws).toHaveLength(2);
    // Payloads survive byte-for-byte and timestamps are monotonic.
    expect(Array.from(raws[0].data)).toEqual(Array.from(makeData(0xab, 8)));
    expect(Array.from(raws[1].data)).toEqual(Array.from(makeData(0xcd, 8)));
    expect(raws[0].timestamp).toBe(1000n);
    expect(raws[1].timestamp).toBe(2000n);
    expect(raws[1].timestamp >= raws[0].timestamp).toBe(true);
  });

  it('finish() deduplicates schemas for same channel', async () => {
    const r = new LiveRecorder();
    const ch = makeChannel(1, '/imu');
    for (let i = 0; i < 5; i++) {
      r.addMessage(ch, BigInt(i * 1000), makeData(i, 12));
    }
    const bytes = await r.finish();
    expect(bytes.slice(0, 8)).toEqual(MCAP_MAGIC);

    // 5 messages on 1 channel sharing 1 schema: the indexed reader must
    // report exactly that (no schema/channel duplication per message).
    const source = recordingSource(bytes);
    const summary = await parseMcap(source);
    expect(summary.totalMessageCount).toBe(5);
    expect(summary.topics).toHaveLength(1);
    expect(summary.topics[0].messageCount).toBe(5);

    const { reader } = await loadMcapForEdit(source);
    expect(reader).not.toBeNull();
    expect(reader!.channelsById.size).toBe(1);
    expect(reader!.schemasById.size).toBe(1);
    expect(reader!.statistics?.messageCount).toBe(5n);

    const raws = await readRawMessagesMcap(source, '/imu');
    expect(raws).toHaveLength(5);
    for (let i = 1; i < raws.length; i++) {
      expect(raws[i].timestamp >= raws[i - 1].timestamp).toBe(true);
    }
    expect(raws.map((m) => m.data.byteLength)).toEqual([12, 12, 12, 12, 12]);
  });

  it('finish() handles multiple channels with different schemas', async () => {
    const ch1 = makeChannel(1, '/image');
    const ch2: FoxgloveChannel = {
      id: 2,
      topic: '/odom',
      encoding: 'cdr',
      schemaName: 'nav_msgs/msg/Odometry',
      schema: 'geometry_msgs/PoseWithCovariance pose',
      schemaEncoding: 'ros2msg',
    };
    const r = new LiveRecorder();
    r.addMessage(ch1, 100n, makeData(1, 4));
    r.addMessage(ch2, 200n, makeData(2, 8));
    r.addMessage(ch1, 300n, makeData(3, 4));
    const bytes = await r.finish();
    expect(bytes.slice(0, 8)).toEqual(MCAP_MAGIC);

    const source = recordingSource(bytes);
    const summary = await parseMcap(source);
    expect(summary.totalMessageCount).toBe(3);
    expect(summary.topics.map((t) => t.name)).toEqual(['/image', '/odom']);
    const byName = new Map(summary.topics.map((t) => [t.name, t]));
    expect(byName.get('/image')?.messageCount).toBe(2);
    expect(byName.get('/image')?.type).toBe('std_msgs/msg/String');
    expect(byName.get('/odom')?.messageCount).toBe(1);
    expect(byName.get('/odom')?.type).toBe('nav_msgs/msg/Odometry');

    // Distinct schemaNames -> distinct schemas even though encoding matches.
    const { reader } = await loadMcapForEdit(source);
    expect(reader!.channelsById.size).toBe(2);
    expect(reader!.schemasById.size).toBe(2);

    const image = await readRawMessagesMcap(source, '/image');
    expect(image.map((m) => Array.from(m.data))).toEqual([
      Array.from(makeData(1, 4)),
      Array.from(makeData(3, 4)),
    ]);
    const odom = await readRawMessagesMcap(source, '/odom');
    expect(odom).toHaveLength(1);
    expect(Array.from(odom[0].data)).toEqual(Array.from(makeData(2, 8)));
  });

  it('finish() handles JSON-encoded messages', async () => {
    const ch: FoxgloveChannel = {
      id: 1,
      topic: '/status',
      encoding: 'json',
      schemaName: 'foxglove.Log',
      schema: '{}',
      schemaEncoding: 'jsonschema',
    };
    const r = new LiveRecorder();
    const payload = new TextEncoder().encode('{"message":"hello"}');
    r.addMessage(ch, 500n, payload);
    const bytes = await r.finish();
    expect(bytes.slice(0, 8)).toEqual(MCAP_MAGIC);

    const source = recordingSource(bytes);
    const summary = await parseMcap(source);
    expect(summary.totalMessageCount).toBe(1);
    expect(summary.topics[0]).toMatchObject({
      name: '/status',
      type: 'foxglove.Log',
      messageCount: 1,
    });

    // The JSON payload is preserved verbatim (not re-encoded as CDR).
    const raws = await readRawMessagesMcap(source, '/status');
    expect(raws).toHaveLength(1);
    expect(raws[0].timestamp).toBe(500n);
    expect(Array.from(raws[0].data)).toEqual(Array.from(payload));

    // The channel keeps its declared encodings through the edit-path reader.
    const { reader } = await loadMcapForEdit(source);
    const channel = [...reader!.channelsById.values()].find((c) => c.topic === '/status');
    expect(channel?.messageEncoding).toBe('json');
    const schema = reader!.schemasById.get(channel!.schemaId);
    expect(schema?.encoding).toBe('jsonschema');
  });

  it('finish() stops at MAX_RECORD_BYTES and round-trips the boundary recording', async () => {
    // Simulates a recorder that has organically buffered ~500 MB without
    // allocating 500 MB here (the existing isFull tests already cover the
    // real allocation). Seeding the private byte counter near the cap lets
    // us pin the boundary semantics: the message that exactly reaches the
    // cap is recorded, later messages are dropped, and finish() still
    // produces a valid MCAP of everything kept.
    const r = new LiveRecorder();
    const ch = makeChannel(1, '/boundary');
    r.addMessage(ch, 10n, makeData(0x11, 4));
    (r as unknown as { _byteCount: number })._byteCount = MAX_RECORD_BYTES - 4;
    expect(r.isFull).toBe(false);

    // This 4-byte message lands exactly on the cap.
    r.addMessage(ch, 20n, makeData(0x22, 4));
    expect(r.byteCount).toBe(MAX_RECORD_BYTES);
    expect(r.isFull).toBe(true);

    // Anything past the cap is silently dropped.
    r.addMessage(ch, 30n, makeData(0x33, 4));
    expect(r.messageCount).toBe(2);
    expect(r.byteCount).toBe(MAX_RECORD_BYTES);

    const bytes = await r.finish();
    expect(bytes.slice(0, 8)).toEqual(MCAP_MAGIC);

    const source = recordingSource(bytes);
    const summary = await parseMcap(source);
    expect(summary.totalMessageCount).toBe(2);
    expect(summary.topics[0].messageCount).toBe(2);
    const raws = await readRawMessagesMcap(source, '/boundary');
    expect(raws.map((m) => m.timestamp)).toEqual([10n, 20n]);
    expect(Array.from(raws[1].data)).toEqual(Array.from(makeData(0x22, 4)));
  });

  it('accumulates messageCount correctly across many channels', () => {
    const r = new LiveRecorder();
    for (let i = 0; i < 10; i++) {
      r.addMessage(makeChannel(i, `/topic_${i}`), BigInt(i), makeData(i));
    }
    expect(r.messageCount).toBe(10);
  });

  // ── isFull ────────────────────────────────────────────────────────────────

  it('isFull is false initially', () => {
    expect(new LiveRecorder().isFull).toBe(false);
  });

  it('isFull becomes true when byteCount reaches MAX_RECORD_BYTES', async () => {
    const { LiveRecorder: LR, MAX_RECORD_BYTES } = await import('../../src/live/liveRecorder');
    const r = new LR();
    const ch = makeChannel(1, '/big');
    // Add one message that fills the buffer exactly.
    r.addMessage(ch, 0n, new Uint8Array(MAX_RECORD_BYTES));
    expect(r.isFull).toBe(true);
  });

  it('addMessage silently ignores data once isFull', async () => {
    const { LiveRecorder: LR, MAX_RECORD_BYTES } = await import('../../src/live/liveRecorder');
    const r = new LR();
    const ch = makeChannel(1, '/big');
    r.addMessage(ch, 0n, new Uint8Array(MAX_RECORD_BYTES));
    const countBefore = r.messageCount;
    // This message should be silently dropped.
    r.addMessage(ch, 1n, makeData(0xff, 4));
    expect(r.messageCount).toBe(countBefore);
  });

  // ── topicFilter ──────────────────────────────────────────────────────────

  it('topicFilter is null by default (record all)', () => {
    expect(new LiveRecorder().topicFilter).toBeNull();
  });

  it('records all topics when no filter is provided', () => {
    const r = new LiveRecorder();
    r.addMessage(makeChannel(1, '/odom'), 0n, makeData(1));
    r.addMessage(makeChannel(2, '/scan'), 1n, makeData(2));
    expect(r.messageCount).toBe(2);
  });

  it('only records selected topics when filter is provided', () => {
    const r = new LiveRecorder(new Set(['/odom']));
    r.addMessage(makeChannel(1, '/odom'), 0n, makeData(1));
    r.addMessage(makeChannel(2, '/scan'), 1n, makeData(2));
    expect(r.messageCount).toBe(1);
    expect(r.byteCount).toBe(4); // only /odom's 4 bytes
  });

  it('topicFilter stores the provided set', () => {
    const filter = new Set(['/tf', '/cmd_vel']);
    const r = new LiveRecorder(filter);
    expect(r.topicFilter).toBe(filter);
  });

  it('records nothing when filter is an empty set', () => {
    const r = new LiveRecorder(new Set());
    r.addMessage(makeChannel(1, '/odom'), 0n, makeData(1));
    expect(r.messageCount).toBe(0);
  });

  it('finish() only contains messages from filtered topics', async () => {
    const r = new LiveRecorder(new Set(['/tf']));
    r.addMessage(makeChannel(1, '/odom'), 100n, makeData(0xaa));
    r.addMessage(makeChannel(2, '/tf'), 200n, makeData(0xbb));
    const bytes = await r.finish();
    // MCAP magic means serialization ran - just check it's non-empty
    expect(bytes.length).toBeGreaterThan(8);
    expect(bytes[0]).toBe(0x89); // MCAP magic

    // Round-trip: the excluded topic's channel/schema/messages never make
    // it into the file at all.
    const source = recordingSource(bytes);
    const summary = await parseMcap(source);
    expect(summary.totalMessageCount).toBe(1);
    expect(summary.topics.map((t) => t.name)).toEqual(['/tf']);
    expect(summary.topics[0].messageCount).toBe(1);
    const raws = await readRawMessagesMcap(source, '/tf');
    expect(raws).toHaveLength(1);
    expect(Array.from(raws[0].data)).toEqual(Array.from(makeData(0xbb)));
    const { reader } = await loadMcapForEdit(source);
    const topicsInFile = [...reader!.channelsById.values()].map((c) => c.topic);
    expect(topicsInFile).toEqual(['/tf']);
  });
});
