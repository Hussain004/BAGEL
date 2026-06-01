/**
 * In-memory bag synthesizer — generates tiny `Uint8Array`s that parse as
 * real MCAP files via the same `@mcap/core` writer the bundled sample bag
 * uses (see `scripts/build-sample-bag.mjs`).
 *
 * Why in-memory: this user's laptop is tight on disk, so committing per-test
 * fixtures isn't viable. Generating bytes at setup time costs ~5 ms per
 * synth call and never touches the filesystem.
 *
 * Coverage strategy: each helper builds the minimum bag that exercises one
 * specific code path (compressed chunks, schema-less topics, multi-topic
 * interleaving, etc). Tests own which scenario they need; the helpers
 * don't try to be a generic builder.
 */

import { McapWriter } from '@mcap/core';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';
import rosmsgCommon from '@foxglove/rosmsg-msgs-common';

// ── Memory-backed writable (lifted from scripts/build-sample-bag.mjs) ─────
function makeMemoryWritable() {
  let buffer = new Uint8Array(16 * 1024);
  let size = 0;
  return {
    async write(data: Uint8Array): Promise<void> {
      const next = size + data.byteLength;
      if (next > buffer.byteLength) {
        let cap = buffer.byteLength;
        while (cap < next) cap *= 2;
        const grown = new Uint8Array(cap);
        grown.set(buffer.subarray(0, size));
        buffer = grown;
      }
      buffer.set(data, size);
      size = next;
    },
    position(): bigint {
      return BigInt(size);
    },
    getBytes(): Uint8Array {
      return buffer.subarray(0, size);
    },
  };
}

// ── ROS2 message definitions (bundled package) ────────────────────────────
const defs = (rosmsgCommon as unknown as { ros2galactic: Record<string, RosmsgDef> }).ros2galactic;

export interface RosmsgDef {
  name: string;
  definitions: Array<{
    type: string;
    name: string;
    isArray?: boolean;
    arrayLength?: number;
    isComplex?: boolean;
    isConstant?: boolean;
    value?: unknown;
    defaultValue?: unknown;
  }>;
}

export function collectMessageDefinitions(rootTypeName: string): RosmsgDef[] {
  return collectDefinitions(rootTypeName);
}

function pickDef(typeName: string): RosmsgDef {
  const bare = typeName.replace('/msg/', '/');
  const def = defs[typeName] ?? defs[bare];
  if (!def) throw new Error(`Missing message definition for ${typeName}`);
  return def;
}

function collectDefinitions(rootTypeName: string): RosmsgDef[] {
  const root = pickDef(rootTypeName);
  const out: RosmsgDef[] = [root];
  const seen = new Set([root.name]);
  const queue: RosmsgDef[] = [root];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const field of current.definitions) {
      if (!field.isComplex) continue;
      if (seen.has(field.type)) continue;
      const childDef = pickDef(field.type);
      seen.add(childDef.name);
      out.push(childDef);
      queue.push(childDef);
    }
  }
  return out;
}

/**
 * Build the concatenated `.msg` schema text in the canonical MCAP-for-ROS2
 * form (primary type first, then each dependency separated by a long ====
 * line + `MSG: pkg/Type` header). Exported so other test helpers can reuse
 * the same encoding.
 */
export function flattenSchemaText(definitions: RosmsgDef[]): string {
  const SEP = '================================================================================';
  function emitOne(entry: RosmsgDef, isRoot: boolean): string {
    const lines: string[] = [];
    if (!isRoot) lines.push(`MSG: ${entry.name}`);
    for (const field of entry.definitions) {
      let line: string;
      if (field.isConstant) {
        line = `${field.type} ${field.name}=${field.value}`;
      } else {
        line = field.type;
        if (field.isArray) {
          line += field.arrayLength != null ? `[${field.arrayLength}]` : '[]';
        }
        line += ` ${field.name}`;
        if (field.defaultValue !== undefined) {
          line += ` ${field.defaultValue}`;
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }
  return definitions.map((entry, i) => emitOne(entry, i === 0)).join(`\n${SEP}\n`) + '\n';
}

// ── Public API ────────────────────────────────────────────────────────────

export interface SynthTopic {
  topic: string;
  type: string;
  /** Messages in time order; each one will be serialized via the type's CDR writer. */
  messages: Array<{ logTime: bigint; value: Record<string, unknown> }>;
}

export interface SynthOptions {
  /** Whether the writer should chunk + index (the indexed reader needs this). */
  useChunks?: boolean;
  useStatistics?: boolean;
  useChunkIndex?: boolean;
  useMessageIndex?: boolean;
  useSummaryOffsets?: boolean;
  /** Library name written into the MCAP header. Lets a test distinguish bags. */
  library?: string;
}

/**
 * Write a small in-memory MCAP file with the given topics + messages.
 *
 * The default options match the writer that produces `tour.mcap` — chunked,
 * indexed, statistics — so the indexed-reader code path is exercised.
 *
 * Returns the raw bytes; tests can wrap them in a `File` for `BagSource`.
 */
export async function writeSyntheticMcap(
  topics: SynthTopic[],
  options: SynthOptions = {},
): Promise<Uint8Array> {
  const writable = makeMemoryWritable();
  const writer = new McapWriter({
    writable,
    useChunks: options.useChunks ?? true,
    useStatistics: options.useStatistics ?? true,
    useChunkIndex: options.useChunkIndex ?? true,
    useMessageIndex: options.useMessageIndex ?? true,
    useSummaryOffsets: options.useSummaryOffsets ?? true,
  });

  await writer.start({
    profile: 'ros2',
    library: options.library ?? 'bagel-synth',
  });

  // Register one schema + channel per topic, capture the encoder for later.
  const encoders: Array<{
    channelId: number;
    encode: (value: Record<string, unknown>) => Uint8Array;
    messages: SynthTopic['messages'];
  }> = [];

  for (const t of topics) {
    const definitions = collectDefinitions(t.type);
    const mw = new MessageWriter(definitions);
    const schemaId = await writer.registerSchema({
      name: t.type,
      encoding: 'ros2msg',
      data: new TextEncoder().encode(flattenSchemaText(definitions)),
    });
    const channelId = await writer.registerChannel({
      schemaId,
      topic: t.topic,
      messageEncoding: 'cdr',
      metadata: new Map([['rosbag2', 'true']]),
    });
    encoders.push({
      channelId,
      encode: (value) => mw.writeMessage(value),
      messages: t.messages,
    });
  }

  // Interleave by logTime so the bag plays back in chronological order.
  type Event = {
    channelId: number;
    logTime: bigint;
    data: Uint8Array;
  };
  const events: Event[] = [];
  for (const e of encoders) {
    for (const m of e.messages) {
      events.push({ channelId: e.channelId, logTime: m.logTime, data: e.encode(m.value) });
    }
  }
  events.sort((a, b) => (a.logTime < b.logTime ? -1 : a.logTime > b.logTime ? 1 : 0));

  let sequence = 0;
  for (const e of events) {
    await writer.addMessage({
      channelId: e.channelId,
      sequence: sequence++,
      logTime: e.logTime,
      publishTime: e.logTime,
      data: e.data,
    });
  }
  await writer.end();
  return writable.getBytes();
}

/**
 * Convenience: wrap a synthetic byte array in a `File` so it can flow through
 * the same `BagSource` machinery the browser uses. Node 20+ provides `File`
 * globally; we error early if it's missing so the failure mode is obvious.
 */
export function bytesToFile(bytes: Uint8Array, name: string): File {
  if (typeof File !== 'function') {
    throw new Error(
      'Node 20+ is required for the `File` global. Update Node or run tests under jsdom.',
    );
  }
  // `File` ctor wants a BlobPart[]; a Uint8Array is one.
  return new File([bytes], name);
}

// ── Quick-build helpers for common shapes ─────────────────────────────────

/** Build a 3-message `/chatter` (std_msgs/String) bag — smallest possible. */
export async function chatterBag(library?: string): Promise<Uint8Array> {
  return writeSyntheticMcap(
    [
      {
        topic: '/chatter',
        type: 'std_msgs/msg/String',
        messages: [
          { logTime: 1_000_000_000n, value: { data: 'hello' } },
          { logTime: 2_000_000_000n, value: { data: 'world' } },
          { logTime: 3_000_000_000n, value: { data: 'bagel' } },
        ],
      },
    ],
    library !== undefined ? { library } : {},
  );
}

/** Build a multi-topic bag covering common ROS2 standard types. */
export async function multiTopicBag(): Promise<Uint8Array> {
  return writeSyntheticMcap([
    {
      topic: '/odom',
      type: 'nav_msgs/msg/Odometry',
      messages: [
        {
          logTime: 1_000_000_000n,
          value: {
            header: { stamp: { sec: 1, nanosec: 0 }, frame_id: 'odom' },
            child_frame_id: 'base_link',
            pose: {
              pose: {
                position: { x: 1, y: 2, z: 0 },
                orientation: { x: 0, y: 0, z: 0, w: 1 },
              },
              covariance: new Array(36).fill(0),
            },
            twist: {
              twist: {
                linear: { x: 0.5, y: 0, z: 0 },
                angular: { x: 0, y: 0, z: 0 },
              },
              covariance: new Array(36).fill(0),
            },
          },
        },
        {
          logTime: 2_000_000_000n,
          value: {
            header: { stamp: { sec: 2, nanosec: 0 }, frame_id: 'odom' },
            child_frame_id: 'base_link',
            pose: {
              pose: {
                position: { x: 3, y: 4, z: 0 },
                orientation: { x: 0, y: 0, z: 0, w: 1 },
              },
              covariance: new Array(36).fill(0),
            },
            twist: {
              twist: {
                linear: { x: 0.5, y: 0, z: 0 },
                angular: { x: 0, y: 0, z: 0 },
              },
              covariance: new Array(36).fill(0),
            },
          },
        },
      ],
    },
    {
      topic: '/chatter',
      type: 'std_msgs/msg/String',
      messages: [
        { logTime: 1_500_000_000n, value: { data: 'hi' } },
      ],
    },
  ]);
}
