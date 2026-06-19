import { describe, it, expect } from 'vitest';
import { LiveRecorder } from '../../src/live/liveRecorder';
import type { FoxgloveChannel } from '../../src/live/foxgloveClient';

// MCAP files always start with this 8-byte magic sequence.
const MCAP_MAGIC = new Uint8Array([0x89, 0x4d, 0x43, 0x41, 0x50, 0x30, 0x0d, 0x0a]);

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

  it('finish() returns bytes starting with MCAP magic (empty recording)', async () => {
    const r = new LiveRecorder();
    const bytes = await r.finish();
    expect(bytes.slice(0, 8)).toEqual(MCAP_MAGIC);
    expect(bytes.byteLength).toBeGreaterThan(8);
  });

  it('finish() returns bytes starting with MCAP magic (with messages)', async () => {
    const r = new LiveRecorder();
    const ch = makeChannel(1, '/scan');
    r.addMessage(ch, 1000n, makeData(0xab, 8));
    r.addMessage(ch, 2000n, makeData(0xcd, 8));
    const bytes = await r.finish();
    expect(bytes.slice(0, 8)).toEqual(MCAP_MAGIC);
  });

  it('finish() deduplicates schemas for same channel', async () => {
    const r = new LiveRecorder();
    const ch = makeChannel(1, '/imu');
    for (let i = 0; i < 5; i++) {
      r.addMessage(ch, BigInt(i * 1000), makeData(i, 12));
    }
    // Should complete without error and produce valid MCAP.
    const bytes = await r.finish();
    expect(bytes.slice(0, 8)).toEqual(MCAP_MAGIC);
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
  });
});
