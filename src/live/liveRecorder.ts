/**
 * LiveRecorder - captures live Foxglove WebSocket messages to an MCAP file.
 *
 * Design: synchronous buffering during recording (one Uint8Array copy +
 * one array push per message) and async MCAP serialization only when
 * finish() is called. This keeps per-message overhead minimal and defers
 * the heavier MCAP write step to the post-recording download flow.
 *
 * McapWriter is loaded via dynamic import inside finish() so the main
 * bundle does not include @mcap/core at startup. The module is already
 * present in the parser-worker chunk, so the first stop-recording is
 * a cache hit in any browser that has already parsed a bag in this session.
 */

import type { FoxgloveChannel } from './foxgloveClient';

interface RecordedMsg {
  channelId: number;
  timeNs: bigint;
  data: Uint8Array;
}

export class LiveRecorder {
  private readonly messages: RecordedMsg[] = [];
  private readonly channelMap = new Map<number, FoxgloveChannel>();
  private _byteCount = 0;

  /**
   * Buffer a single incoming message. The raw CDR/JSON bytes are copied so
   * the caller's WebSocket ArrayBuffer can be released immediately.
   */
  addMessage(channel: FoxgloveChannel, timeNs: bigint, data: Uint8Array): void {
    if (!this.channelMap.has(channel.id)) {
      this.channelMap.set(channel.id, channel);
    }
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    this.messages.push({ channelId: channel.id, timeNs, data: copy });
    this._byteCount += data.byteLength;
  }

  get messageCount(): number {
    return this.messages.length;
  }

  get byteCount(): number {
    return this._byteCount;
  }

  get startTimeNs(): bigint | null {
    return this.messages[0]?.timeNs ?? null;
  }

  get endTimeNs(): bigint | null {
    return this.messages[this.messages.length - 1]?.timeNs ?? null;
  }

  /**
   * Serialize all buffered messages to an indexed MCAP file.
   * Returns the raw bytes ready for download.
   *
   * Schemas and channels are registered lazily on first use so a recording
   * that only touches 3 of 20 advertised topics doesn't carry unused schemas.
   */
  async finish(): Promise<Uint8Array> {
    const { McapWriter } = await import('@mcap/core');
    const writable = new MemoryWritable();
    const writer = new McapWriter({
      writable,
      useChunks: true,
      useStatistics: true,
      useChunkIndex: true,
      useMessageIndex: true,
      useSummaryOffsets: true,
    });
    await writer.start({ library: 'BAGEL', profile: 'ros2' });

    const enc = new TextEncoder();
    const schemaIdByKey = new Map<string, number>();
    const mcapChannelIds = new Map<number, number>();

    for (const { channelId } of this.messages) {
      if (mcapChannelIds.has(channelId)) continue;
      const ch = this.channelMap.get(channelId);
      if (!ch) continue;

      const schemaKey = `${ch.schemaName}\0${ch.schemaEncoding ?? ''}\0${ch.schema}`;
      let schemaId = schemaIdByKey.get(schemaKey);
      if (schemaId === undefined) {
        schemaId = await writer.registerSchema({
          name: ch.schemaName,
          encoding: ch.schemaEncoding ?? 'ros2msg',
          data: enc.encode(ch.schema),
        });
        schemaIdByKey.set(schemaKey, schemaId);
      }

      const cid = await writer.registerChannel({
        schemaId,
        topic: ch.topic,
        messageEncoding: ch.encoding,
        metadata: new Map(),
      });
      mcapChannelIds.set(channelId, cid);
    }

    for (const msg of this.messages) {
      const cid = mcapChannelIds.get(msg.channelId);
      if (cid === undefined) continue;
      await writer.addMessage({
        channelId: cid,
        sequence: 0,
        logTime: msg.timeNs,
        publishTime: msg.timeNs,
        data: msg.data,
      });
    }

    await writer.end();
    return writable.getBytes();
  }
}

/** Growable in-memory buffer satisfying McapWriter's IWritable interface. */
class MemoryWritable {
  private buffer: Uint8Array;
  private offset = 0;

  constructor(initialCapacity = 64 * 1024) {
    this.buffer = new Uint8Array(initialCapacity);
  }

  async write(data: Uint8Array): Promise<void> {
    const next = this.offset + data.byteLength;
    if (next > this.buffer.byteLength) {
      let cap = this.buffer.byteLength;
      while (cap < next) cap = Math.max(cap * 2, cap + 1);
      const grown = new Uint8Array(cap);
      grown.set(this.buffer.subarray(0, this.offset));
      this.buffer = grown;
    }
    this.buffer.set(data, this.offset);
    this.offset = next;
  }

  position(): bigint {
    return BigInt(this.offset);
  }

  getBytes(): Uint8Array {
    return this.buffer.subarray(0, this.offset);
  }
}
