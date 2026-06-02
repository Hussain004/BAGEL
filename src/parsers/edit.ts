/**
 * MCAP bag editing: time-range trim + topic filter, MCAP-in to MCAP-out.
 *
 * v1.1 banner feature. Replaces the `mcap filter` CLI workflow for the
 * common case of "drop this bag's first/last N seconds and these noisy
 * topics" without leaving the browser.
 *
 * Implementation: reuse the cached `McapIndexedReader` from `mcap.ts` for
 * reads (so editing piggybacks on whatever the user already paid to parse),
 * and stream each surviving message through `McapWriter` into an in-memory
 * `Uint8Array`. The writer chunks + indexes the output so the result opens
 * back in BAGEL with full range-read parity, and runs through external
 * tools (`mcap info`, Foxglove, the official `mcap` CLI) the same way.
 *
 * Scope notes:
 *   - **MCAP input only in v1.1.** ROS1 `.bag` and ROS2 `.db3` inputs aren't
 *     wired through this path yet; the modal disables itself for those
 *     formats with a "v1.2" placeholder. Bringing them in needs a schema
 *     reconstruction step (`.db3` schemas come from the bundled type
 *     registry, not the bag itself) plus message-encoding round-tripping
 *     for ROS1 (`ros1msg` schemas + `ros1` message encoding), which is
 *     enough surface area to deserve its own pass.
 *   - **Uncompressed output.** `fzstd` is decompress-only; we don't bundle
 *     a zstd encoder yet. Output bags are written with the default chunk
 *     size and no chunk compression. They reload identically; only the
 *     on-disk size differs from a zstd-compressed equivalent.
 */

import { McapWriter, type IWritable } from '@mcap/core';
import type { BagSource } from './source';
import type { BagFormat } from '../types/bag';
import {
  loadMcapForEdit,
  type CachedMcapForEdit,
} from './mcap';

/** Options controlling what survives the edit. */
export interface EditOptions {
  /** Inclusive start time (ns since epoch). Messages with logTime < startNs are dropped. */
  startNs: bigint;
  /** Inclusive end time (ns since epoch). Messages with logTime > endNs are dropped. */
  endNs: bigint;
  /**
   * Topics to keep. `undefined` means "keep every topic" (still applies the
   * time-range filter). An empty array means "drop every topic" which is
   * legal but produces an empty bag (surfaced as a UX warning upstream).
   */
  topics?: string[];
  /** Profile string for the output MCAP header. Defaults to the input bag's profile. */
  profile?: string;
  /**
   * v1.2 `.db3` edit-only opt-in. Topic names whose type isn't in the
   * bundled registry but the user has explicitly chosen to include anyway.
   * Their messages get written with a schema-less channel (MCAP schemaId 0)
   * - readable by tools that don't need schema text, including BAGEL after
   * the user pastes a schema for the type. Has no effect on MCAP or ROS1
   * edits since both formats embed their schemas in the source bag.
   */
  includeUnresolvedTopics?: string[];
  /**
   * Soft progress hint. Total messages-to-write is estimated upstream from
   * statistics; callers can show "wrote N of ~M". The estimate is allowed
   * to overshoot, so a progress bar finishes a hair early. Acceptable.
   */
  onProgress?: (written: number) => void;
}

/** Result of an edit. */
export interface EditResult {
  /** Final MCAP bytes, ready for download. */
  bytes: Uint8Array;
  /** How many messages survived the filter and made it into the output. */
  messageCount: number;
  /** First message logTime in the output (matches the trimmed window's start). */
  startNs: bigint;
  /** Last message logTime in the output (matches the trimmed window's end). */
  endNs: bigint;
}

/**
 * In-memory `IWritable` for MCAP output. Grows a `Uint8Array` as the writer
 * appends; final bytes are read via `getBytes()` once `writer.end()` resolves.
 *
 * Same shape as the writable used by `scripts/build-sample-bag.mjs` and
 * `tests/fixtures/synth.ts`, kept distinct so this module doesn't reach into
 * test infra at runtime.
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
      // Double until we fit. The +1 guards against `cap === 0` edge cases
      // even though we initialise at 64 KB.
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
    // Return a tight view so the consumer doesn't see the over-allocated tail.
    return this.buffer.subarray(0, this.offset);
  }
}

/**
 * Compute the time-window total message count by walking the reader's
 * statistics + chunk indexes. Returns an overshoot estimate when only chunk
 * metadata is available, because message-precise counting would require scanning
 * each chunk's message index, which defeats the point of a fast estimate.
 *
 * Used purely for progress reporting; the actual write loop counts the real
 * messages it produces and ships those through `onProgress`.
 */
export function estimateMessageCount(
  meta: CachedMcapForEdit,
  startNs: bigint,
  endNs: bigint,
  topics: Set<string> | null,
): number {
  if (!meta.reader) {
    // Stream fallback has no statistics; just return 0 so the UI renders
    // an indeterminate spinner instead of a fake progress bar.
    return 0;
  }
  const reader = meta.reader;
  const stats = reader.statistics;
  if (!stats) return 0;

  // If the trim window covers the whole bag and topics is null, the count is
  // simply the statistics total. Common-case shortcut.
  if (startNs <= stats.messageStartTime && endNs >= stats.messageEndTime && !topics) {
    return Number(stats.messageCount);
  }

  // Otherwise sum per-channel counts that match the topic filter, scaled
  // by the fraction of the bag's time range that overlaps the trim window.
  // Topic filter is precise; time-range fraction is the overshoot source.
  // a topic that only publishes in the first half of the bag will still be
  // weighted by full-bag duration. Good enough for a progress bar.
  const bagSpan = Number(stats.messageEndTime - stats.messageStartTime);
  if (bagSpan <= 0) return 0;
  const clampedStart = startNs > stats.messageStartTime ? startNs : stats.messageStartTime;
  const clampedEnd = endNs < stats.messageEndTime ? endNs : stats.messageEndTime;
  const windowSpan = Number(clampedEnd - clampedStart);
  if (windowSpan <= 0) return 0;
  const fraction = windowSpan / bagSpan;

  let count = 0;
  for (const [channelId, msgCount] of stats.channelMessageCounts) {
    const ch = reader.channelsById.get(channelId);
    if (!ch) continue;
    if (topics && !topics.has(ch.topic)) continue;
    count += Number(msgCount);
  }
  return Math.ceil(count * fraction);
}

/**
 * Edit an MCAP bag. Reads through the cached indexed reader (set up by the
 * normal `parseMcap` path on bag load), filters messages by `topics` and
 * `[startNs, endNs]`, and writes them to a new in-memory MCAP buffer.
 *
 * Throws when:
 *   - the source isn't an MCAP file (other formats are explicitly out of
 *     scope for v1.1 (the modal disables itself in those cases);
 *   - the time window is empty (`endNs <= startNs`);
 *   - the source has no `McapIndexedReader` (stream-only bags can't be
 *     edited yet; they'd need a whole-bag re-scan and are bounded by the
 *     512 MB stream fallback limit anyway, so users with huge un-indexed
 *     bags see a clearer error than "writer threw").
 */
export async function editMcapBag(
  source: BagSource,
  options: EditOptions,
): Promise<EditResult> {
  if (options.endNs <= options.startNs) {
    throw new Error(
      `Edit window is empty: end (${options.endNs}) must be greater than start (${options.startNs}).`,
    );
  }

  const meta = await loadMcapForEdit(source);
  if (!meta.reader) {
    throw new Error(
      'This MCAP bag does not have an index, so it cannot be edited in v1.1. ' +
        'Re-record with an indexed writer (the ROS2 default) or run `mcap recover` ' +
        'over the file first.',
    );
  }
  const reader = meta.reader;

  const writable = new MemoryWritable();
  const writer = new McapWriter({
    writable,
    useChunks: true,
    useStatistics: true,
    useChunkIndex: true,
    useMessageIndex: true,
    useSummaryOffsets: true,
  });

  await writer.start({
    profile: options.profile ?? reader.header.profile ?? 'ros2',
    // Tag the output so external tools can tell it was BAGEL-edited.
    library: `bagel-edit/${reader.header.library || 'unknown-source'}`,
  });

  // Topic filter: pass undefined to the reader for "all topics" so it
  // doesn't build an empty include list (which would yield no messages).
  const topicFilter = options.topics ? new Set(options.topics) : null;
  const readerTopics = topicFilter ? Array.from(topicFilter) : undefined;

  // Schemas + channels are registered lazily on first use. A bag with 30
  // topics where the edit drops 28 of them won't carry the unused schemas
  // in the output, which keeps small edits genuinely small.
  const schemaIdMap = new Map<number, number>(); // input schemaId → output schemaId
  const channelIdMap = new Map<number, number>(); // input channelId → output channelId

  const registerSchemaOnce = async (inputSchemaId: number): Promise<number> => {
    const cached = schemaIdMap.get(inputSchemaId);
    if (cached !== undefined) return cached;
    const schema = reader.schemasById.get(inputSchemaId);
    if (!schema) {
      // Schema id 0 means "no schema" in the MCAP spec, so pass it through
      // unchanged so the writer registers a null-schema channel.
      schemaIdMap.set(inputSchemaId, 0);
      return 0;
    }
    const newId = await writer.registerSchema({
      name: schema.name,
      encoding: schema.encoding,
      data: schema.data,
    });
    schemaIdMap.set(inputSchemaId, newId);
    return newId;
  };

  const registerChannelOnce = async (inputChannelId: number): Promise<number | null> => {
    const cached = channelIdMap.get(inputChannelId);
    if (cached !== undefined) return cached;
    const channel = reader.channelsById.get(inputChannelId);
    if (!channel) return null;
    const outputSchemaId = await registerSchemaOnce(channel.schemaId);
    const newId = await writer.registerChannel({
      schemaId: outputSchemaId,
      topic: channel.topic,
      messageEncoding: channel.messageEncoding,
      metadata: new Map(channel.metadata),
    });
    channelIdMap.set(inputChannelId, newId);
    return newId;
  };

  let written = 0;
  let firstNs: bigint | null = null;
  let lastNs: bigint | null = null;

  // The reader does the time clamp for us via startTime/endTime; the topic
  // filter likewise prunes server-side so we don't pay for messages we'd
  // throw away anyway.
  for await (const msg of reader.readMessages({
    topics: readerTopics,
    startTime: options.startNs,
    endTime: options.endNs,
  })) {
    const outChannelId = await registerChannelOnce(msg.channelId);
    if (outChannelId === null) continue;
    await writer.addMessage({
      channelId: outChannelId,
      sequence: msg.sequence,
      logTime: msg.logTime,
      publishTime: msg.publishTime,
      data: msg.data instanceof Uint8Array ? msg.data : new Uint8Array(msg.data),
    });
    written++;
    if (firstNs === null || msg.logTime < firstNs) firstNs = msg.logTime;
    if (lastNs === null || msg.logTime > lastNs) lastNs = msg.logTime;
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

/**
 * Format-aware edit dispatcher. Forwards to `editMcapBag`, `editRos1Bag`,
 * or `editDb3Bag` based on the source bag's format. All three return the
 * same `EditResult` shape - an in-memory MCAP `Uint8Array` plus a small
 * bookkeeping struct - so callers don't need format-specific branches.
 *
 * v1.2 banner: the editor surface now covers every format BAGEL reads.
 */
export async function editBag(
  source: BagSource,
  format: BagFormat,
  options: EditOptions,
): Promise<EditResult> {
  if (format === 'mcap') return editMcapBag(source, options);
  if (format === 'bag') {
    const { editRos1Bag } = await import('./editRos1');
    return editRos1Bag(source, options);
  }
  if (format === 'db3') {
    const { editDb3Bag } = await import('./editDb3');
    return editDb3Bag(source, options);
  }
  throw new Error(`No editor for format: ${format}`);
}

/**
 * Format-aware estimator. Falls through to the MCAP-specific
 * `estimateMessageCount` already in this module for `.mcap`, and delegates
 * to the format-specific estimators for `.bag` and `.db3`.
 */
export async function estimateMessageCountForFormat(
  source: BagSource,
  format: BagFormat,
  startNs: bigint,
  endNs: bigint,
  topics: Set<string> | null,
): Promise<number> {
  if (format === 'mcap') {
    const meta = await loadMcapForEdit(source);
    return estimateMessageCount(meta, startNs, endNs, topics);
  }
  if (format === 'bag') {
    const { estimateMessageCountRos1 } = await import('./editRos1');
    return estimateMessageCountRos1(source, startNs, endNs, topics);
  }
  if (format === 'db3') {
    const { estimateMessageCountDb3 } = await import('./editDb3');
    return estimateMessageCountDb3(source, startNs, endNs, topics);
  }
  throw new Error(`No estimator for format: ${format}`);
}
