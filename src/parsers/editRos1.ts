/**
 * ROS1 .bag editing: time-range trim + topic filter, ROS1-in to MCAP-out.
 *
 * v1.2 banner feature. Sibling to `editMcapBag` in `edit.ts`: reuses the
 * v1.1 `MemoryWritable` + `McapWriter` plumbing and the same `EditOptions` /
 * `EditResult` shapes, but reads through the cached `Bag` from `bag.ts`
 * instead of an `McapIndexedReader`.
 *
 * The output is always MCAP regardless of input format (per the v1.2 plan
 * in `ros2-bagel-implementation-plan.md`). ROS1 messages get written through
 * with `messageEncoding: 'ros1'` and schemas registered with
 * `schemaEncoding: 'ros1msg'`, so the result re-opens in BAGEL, Foxglove
 * Studio, and the official `mcap` CLI without re-encoding.
 */

import { McapWriter, type IWritable } from '@mcap/core';
import type { BagSource } from './source';
import { loadBagForEdit } from './bag';
import type { EditOptions, EditResult } from './edit';

/** ROS1 `{ sec, nsec }` time shape, inlined to avoid a `@foxglove/rostime`
 *  dependency just for one type alias. */
type Time = { sec: number; nsec: number };

/**
 * In-memory `IWritable` for MCAP output - copy of the one in `edit.ts` so
 * `editRos1.ts` stays independent of MCAP-specific cache machinery while
 * still using the same growth strategy.
 */
class MemoryWritable implements IWritable {
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

function nsToTime(ns: bigint): Time {
  const sec = Number(ns / 1_000_000_000n);
  const nsec = Number(ns % 1_000_000_000n);
  return { sec, nsec };
}

function timeToNs(t: { sec: number; nsec: number } | undefined): bigint {
  if (!t) return 0n;
  return BigInt(t.sec) * 1_000_000_000n + BigInt(t.nsec);
}

/**
 * Estimate how many messages survive `[startNs, endNs]` + the topic filter.
 *
 * Same overshoot tradeoff as the MCAP estimator in `edit.ts`: per-connection
 * counts are precise, but we scale them by the time-window fraction rather
 * than walking each chunk's message index. Good enough for a progress bar.
 */
export async function estimateMessageCountRos1(
  source: BagSource,
  startNs: bigint,
  endNs: bigint,
  topics: Set<string> | null,
): Promise<number> {
  const meta = await loadBagForEdit(source);
  const bag = meta.bag;
  const bagStart = timeToNs(bag.startTime);
  const bagEnd = timeToNs(bag.endTime);
  if (bagEnd <= bagStart) return 0;
  const clampedStart = startNs > bagStart ? startNs : bagStart;
  const clampedEnd = endNs < bagEnd ? endNs : bagEnd;
  if (clampedEnd <= clampedStart) return 0;
  const fraction = Number(clampedEnd - clampedStart) / Number(bagEnd - bagStart);

  let count = 0;
  for (const [connId, conn] of meta.connectionsById) {
    if (topics && !topics.has(conn.topic)) continue;
    count += meta.messageCountByConn.get(connId) ?? 0;
  }
  return Math.ceil(count * fraction);
}

/**
 * Edit a ROS1 `.bag` to MCAP. Reads through the cached `Bag`, filters by
 * `topics` + `[startNs, endNs]`, registers one MCAP channel per surviving
 * topic (collapsing multi-publisher connections into a single output
 * channel, since their schemas are identical), and writes raw `ros1`
 * bytes straight through.
 *
 * Throws when:
 *  - the time window is empty (`endNs <= startNs`);
 *  - the bag has no readable connections (corrupt index).
 */
export async function editRos1Bag(
  source: BagSource,
  options: EditOptions,
): Promise<EditResult> {
  if (options.endNs <= options.startNs) {
    throw new Error(
      `Edit window is empty: end (${options.endNs}) must be greater than start (${options.startNs}).`,
    );
  }

  const meta = await loadBagForEdit(source);
  if (meta.connectionsById.size === 0) {
    throw new Error(
      'This ROS1 .bag does not advertise any connections. The file may be ' +
        'truncated or corrupt; try `rosbag reindex` over it first.',
    );
  }

  const writable = new MemoryWritable();
  const writer = new McapWriter({
    writable,
    useChunks: true,
    useStatistics: true,
    useChunkIndex: true,
    useMessageIndex: true,
    useSummaryOffsets: true,
  });

  // The MCAP profile string says what kind of bag the file came from. ROS1
  // bags don't have a profile concept, so we settle on `ros1` to match how
  // `mcap convert` tags its ROS1 output.
  await writer.start({
    profile: options.profile ?? 'ros1',
    library: 'bagel-edit/ros1',
  });

  // Topic filter doubles as the iterator filter (the library honours it).
  const topicFilter = options.topics ? new Set(options.topics) : null;
  const iteratorTopics = topicFilter ? Array.from(topicFilter) : undefined;

  // Lazy schema + channel registration keyed by topic (not connection): a
  // 30-topic bag where the edit drops 28 topics won't carry the unused
  // schemas in the output, and multi-publisher topics collapse into a
  // single output channel since their .msg text is identical.
  const channelIdByTopic = new Map<number, number>(); // input connectionId -> output channelId
  const channelIdByTopicName = new Map<string, number>();

  const registerChannelOnce = async (connectionId: number): Promise<number | null> => {
    const cached = channelIdByTopic.get(connectionId);
    if (cached !== undefined) return cached;
    const conn = meta.connectionsById.get(connectionId);
    if (!conn) return null;
    // If we've already registered a channel for this topic from a previous
    // connection, reuse it.
    const sameTopic = channelIdByTopicName.get(conn.topic);
    if (sameTopic !== undefined) {
      channelIdByTopic.set(connectionId, sameTopic);
      return sameTopic;
    }
    const schemaId = await writer.registerSchema({
      name: conn.type,
      encoding: 'ros1msg',
      data: new TextEncoder().encode(conn.messageDefinition),
    });
    const channelId = await writer.registerChannel({
      schemaId,
      topic: conn.topic,
      messageEncoding: 'ros1',
      metadata: new Map(),
    });
    channelIdByTopic.set(connectionId, channelId);
    channelIdByTopicName.set(conn.topic, channelId);
    return channelId;
  };

  // The library's messageIterator accepts a start time but not an end time,
  // so we filter the upper bound manually inside the loop. Since the iterator
  // walks chunks chronologically, we can `break` once we cross the end.
  let written = 0;
  let firstNs: bigint | null = null;
  let lastNs: bigint | null = null;
  let sequence = 0;

  type Ros1MessageEvent = {
    topic: string;
    timestamp: { sec: number; nsec: number };
    data: Uint8Array;
    connectionId: number;
  };

  const iter = meta.bag.messageIterator({
    topics: iteratorTopics,
    start: nsToTime(options.startNs),
  }) as AsyncIterable<Ros1MessageEvent>;

  for await (const event of iter) {
    const ts = timeToNs(event.timestamp);
    if (ts < options.startNs) continue; // shouldn't happen given the start arg, but defend
    if (ts > options.endNs) break;
    const outChannelId = await registerChannelOnce(event.connectionId);
    if (outChannelId === null) continue;
    const data =
      event.data instanceof Uint8Array ? event.data : new Uint8Array(event.data);
    await writer.addMessage({
      channelId: outChannelId,
      sequence: sequence++,
      logTime: ts,
      publishTime: ts,
      data,
    });
    written++;
    if (firstNs === null || ts < firstNs) firstNs = ts;
    if (lastNs === null || ts > lastNs) lastNs = ts;
    if (written % 250 === 0) {
      options.onProgress?.(written);
      // Yield so the worker can flush progress messages back to the main
      // thread between batches without saturating its event loop.
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  options.onProgress?.(written);

  await writer.end();

  return {
    bytes: writable.getBytes(),
    messageCount: written,
    startNs: firstNs ?? options.startNs,
    endNs: lastNs ?? options.endNs,
  };
}
