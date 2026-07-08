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

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync } from 'node:zlib';

import { McapWriter } from '@mcap/core';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';
import rosmsgCommon from '@foxglove/rosmsg-msgs-common';
import { md5, parse as parseMessageDefinition } from '@foxglove/rosmsg';

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
  /**
   * zstd-compress chunk data on write (via Node's built-in `zstdCompressSync`),
   * so reading the bag back exercises the real decompress path
   * (src/parsers/zstdWasm.ts) instead of only ever parsing uncompressed
   * synthetic bags.
   */
  compress?: boolean;
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
    ...(options.compress
      ? {
          compressChunk: (chunkData: Uint8Array) => ({
            compression: 'zstd',
            compressedData: zstdCompressSync(chunkData),
          }),
        }
      : {}),
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

/** Same messages as `chatterBag`, but with zstd-compressed chunks. */
export async function compressedChatterBag(): Promise<Uint8Array> {
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
    { compress: true },
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

// ── ROS1 .bag synthesis (v1.2) ────────────────────────────────────────────
//
// `@foxglove/rosbag` ships a reader but no writer, so for editRos1 tests we
// hand-roll a minimal v2.0-compliant bag writer here. The bag layout we emit:
//
//   [13] Magic `#ROSBAG V2.0\n`
//   [_]  Bag header record (opcode 3) - index_pos / conn_count / chunk_count
//   [_]  Chunk record (opcode 5, compression='none') containing:
//          - Connection records (opcode 7), one per topic
//          - Message_data records (opcode 2), one per published message
//   [_]  Per-connection index_data records (opcode 4)
//   [_]  Index section: connection records (opcode 7) + chunk_info (opcode 6)
//
// The writer follows the reader's expectations in
// node_modules/@foxglove/rosbag/dist/esm/record.js to the byte. Each record
// is `<4-byte header_len><header_fields><4-byte data_len><data_bytes>`, with
// fields encoded as `<4-byte field_len>name=value`.

const ROS1_BAG_MAGIC = '#ROSBAG V2.0\n';

export interface SynthRos1Topic {
  topic: string;
  /** ROS1 short form, e.g. `std_msgs/String`. */
  type: string;
  /** Concatenated `.msg` text. Same shape as `connection.messageDefinition`. */
  messageDefinition: string;
  /** Pre-encoded ROS1 wire-format bytes per message. */
  messages: Array<{ time: { sec: number; nsec: number }; data: Uint8Array }>;
}

function u8(v: number): Uint8Array {
  return new Uint8Array([v & 0xff]);
}

function u32le(v: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, v, true);
  return out;
}

function bigU64le(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, Number(v & 0xffffffffn), true);
  view.setUint32(4, Number(v >> 32n), true);
  return out;
}

function timeLe(t: { sec: number; nsec: number }): Uint8Array {
  const out = new Uint8Array(8);
  const view = new DataView(out.buffer);
  view.setUint32(0, t.sec, true);
  view.setUint32(4, t.nsec, true);
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function encodeRos1Field(name: string, value: Uint8Array | string): Uint8Array {
  const v = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const nameEq = new TextEncoder().encode(`${name}=`);
  return concat([u32le(nameEq.length + v.length), nameEq, v]);
}

function encodeRos1Record(
  fields: Array<[name: string, value: Uint8Array | string]>,
  data: Uint8Array,
): Uint8Array {
  const headerBytes = concat(fields.map(([n, v]) => encodeRos1Field(n, v)));
  return concat([u32le(headerBytes.length), headerBytes, u32le(data.length), data]);
}

function buildConnectionRecord(
  conn: number,
  topic: string,
  type: string,
  md5sum: string,
  messageDefinition: string,
): Uint8Array {
  // Header: op, conn, topic. Data: type, md5sum, message_definition.
  const dataFields = concat([
    encodeRos1Field('type', type),
    encodeRos1Field('md5sum', md5sum),
    encodeRos1Field('message_definition', messageDefinition),
  ]);
  return encodeRos1Record(
    [
      ['op', u8(7)],
      ['conn', u32le(conn)],
      ['topic', topic],
    ],
    dataFields,
  );
}

/**
 * Write a minimal valid ROS1 v2.0 bag with the given topics + pre-encoded
 * messages. Single uncompressed chunk; round-trips through `Bag.open()`.
 */
export async function writeSyntheticRos1Bag(
  topics: SynthRos1Topic[],
): Promise<Uint8Array> {
  // Assign connection ids in input order and compute md5sums up front.
  const connections = topics.map((t, i) => {
    const defs = parseMessageDefinition(t.messageDefinition, { ros2: false });
    return {
      conn: i,
      topic: t.topic,
      type: t.type,
      md5sum: md5(defs),
      messageDefinition: t.messageDefinition,
      messages: t.messages,
    };
  });

  // Build the chunk body: inline connection records followed by all message
  // records sorted by time. Track the byte offset of each message record
  // within the chunk data so we can emit per-connection index_data records.
  type Event = { conn: number; time: { sec: number; nsec: number }; data: Uint8Array };
  const events: Event[] = [];
  for (const c of connections) {
    for (const m of c.messages) {
      events.push({ conn: c.conn, time: m.time, data: m.data });
    }
  }
  events.sort((a, b) =>
    a.time.sec !== b.time.sec ? a.time.sec - b.time.sec : a.time.nsec - b.time.nsec,
  );

  const chunkParts: Uint8Array[] = [];
  let chunkLen = 0;
  for (const c of connections) {
    const rec = buildConnectionRecord(
      c.conn,
      c.topic,
      c.type,
      c.md5sum,
      c.messageDefinition,
    );
    chunkParts.push(rec);
    chunkLen += rec.length;
  }

  const perConnIndex = new Map<
    number,
    Array<{ time: { sec: number; nsec: number }; offset: number }>
  >();
  for (const c of connections) perConnIndex.set(c.conn, []);

  for (const ev of events) {
    const offset = chunkLen;
    const rec = encodeRos1Record(
      [
        ['op', u8(2)],
        ['conn', u32le(ev.conn)],
        ['time', timeLe(ev.time)],
      ],
      ev.data,
    );
    chunkParts.push(rec);
    chunkLen += rec.length;
    perConnIndex.get(ev.conn)!.push({ time: ev.time, offset });
  }

  const chunkData = concat(chunkParts);

  // Chunk record (opcode 5).
  const chunkRecord = encodeRos1Record(
    [
      ['op', u8(5)],
      ['compression', 'none'],
      ['size', u32le(chunkData.length)],
    ],
    chunkData,
  );

  // Per-connection index_data records that follow the chunk.
  const indexRecords: Uint8Array[] = [];
  for (const c of connections) {
    const entries = perConnIndex.get(c.conn) ?? [];
    if (entries.length === 0) continue;
    const dataBuf = new Uint8Array(entries.length * 12);
    const view = new DataView(dataBuf.buffer);
    for (let i = 0; i < entries.length; i++) {
      view.setUint32(i * 12, entries[i].time.sec, true);
      view.setUint32(i * 12 + 4, entries[i].time.nsec, true);
      view.setUint32(i * 12 + 8, entries[i].offset, true);
    }
    indexRecords.push(
      encodeRos1Record(
        [
          ['op', u8(4)],
          ['ver', u32le(1)],
          ['conn', u32le(c.conn)],
          ['count', u32le(entries.length)],
        ],
        dataBuf,
      ),
    );
  }

  // Bag header has fixed-size fields, so we can encode a placeholder to learn
  // its byte length, then re-encode with the real index_pos once we know it.
  const bagHeaderPlaceholder = encodeRos1Record(
    [
      ['op', u8(3)],
      ['index_pos', bigU64le(0n)],
      ['conn_count', u32le(connections.length)],
      ['chunk_count', u32le(1)],
    ],
    new Uint8Array(0),
  );

  const magic = new TextEncoder().encode(ROS1_BAG_MAGIC);
  const chunkPos = magic.length + bagHeaderPlaceholder.length;
  const chunkEnd = chunkPos + chunkRecord.length;
  let indexPos = chunkEnd;
  for (const r of indexRecords) indexPos += r.length;

  // Connection records get re-emitted in the index section.
  const indexConnectionRecords = connections.map((c) =>
    buildConnectionRecord(c.conn, c.topic, c.type, c.md5sum, c.messageDefinition),
  );

  // chunk_info data is a packed list of (conn_id, message_count) per connection
  // present in the chunk.
  const chunkInfoData = new Uint8Array(connections.length * 8);
  const chunkInfoView = new DataView(chunkInfoData.buffer);
  for (let i = 0; i < connections.length; i++) {
    chunkInfoView.setUint32(i * 8, connections[i].conn, true);
    chunkInfoView.setUint32(i * 8 + 4, connections[i].messages.length, true);
  }
  const startTime = events[0]?.time ?? { sec: 0, nsec: 0 };
  const endTime = events.at(-1)?.time ?? { sec: 0, nsec: 0 };
  const chunkInfoRecord = encodeRos1Record(
    [
      ['op', u8(6)],
      ['ver', u32le(1)],
      ['chunk_pos', bigU64le(BigInt(chunkPos))],
      ['start_time', timeLe(startTime)],
      ['end_time', timeLe(endTime)],
      ['count', u32le(connections.length)],
    ],
    chunkInfoData,
  );

  const finalHeader = encodeRos1Record(
    [
      ['op', u8(3)],
      ['index_pos', bigU64le(BigInt(indexPos))],
      ['conn_count', u32le(connections.length)],
      ['chunk_count', u32le(1)],
    ],
    new Uint8Array(0),
  );
  if (finalHeader.length !== bagHeaderPlaceholder.length) {
    throw new Error(
      'Internal: ROS1 bag header length differs between placeholder and final',
    );
  }

  return concat([
    magic,
    finalHeader,
    chunkRecord,
    ...indexRecords,
    ...indexConnectionRecords,
    chunkInfoRecord,
  ]);
}

/** Encode a single string into ROS1 wire format (length-prefixed UTF-8). */
export function encodeRos1String(s: string): Uint8Array {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length, true);
  out.set(bytes, 4);
  return out;
}

/** Encode a single int32 into ROS1 wire format (4-byte little-endian). */
export function encodeRos1Int32(v: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setInt32(0, v, true);
  return out;
}

/** Build a 3-message `/chatter` (std_msgs/String) ROS1 bag, the smallest valid case. */
export async function chatterRos1Bag(): Promise<Uint8Array> {
  return writeSyntheticRos1Bag([
    {
      topic: '/chatter',
      type: 'std_msgs/String',
      messageDefinition: 'string data\n',
      messages: [
        { time: { sec: 1, nsec: 0 }, data: encodeRos1String('hello') },
        { time: { sec: 2, nsec: 0 }, data: encodeRos1String('world') },
        { time: { sec: 3, nsec: 0 }, data: encodeRos1String('bagel') },
      ],
    },
  ]);
}

/** Build a 2-topic ROS1 bag covering string + int32 to exercise topic filtering. */
export async function multiTopicRos1Bag(): Promise<Uint8Array> {
  return writeSyntheticRos1Bag([
    {
      topic: '/chatter',
      type: 'std_msgs/String',
      messageDefinition: 'string data\n',
      messages: [
        { time: { sec: 1, nsec: 500_000_000 }, data: encodeRos1String('hi') },
      ],
    },
    {
      topic: '/ints',
      type: 'std_msgs/Int32',
      messageDefinition: 'int32 data\n',
      messages: [
        { time: { sec: 1, nsec: 0 }, data: encodeRos1Int32(1) },
        { time: { sec: 2, nsec: 0 }, data: encodeRos1Int32(2) },
      ],
    },
  ]);
}

// ── ROS2 .db3 synthesis (v1.2) ────────────────────────────────────────────
//
// `.db3` bags are SQLite databases with `topics` and `messages` tables
// (see `src/parsers/db3.ts` for the schema). For editDb3 tests we build a
// fresh in-memory database via sql.js and dump it to a `Uint8Array`. Schemas
// are not embedded in the file (that's the entire reason editDb3 needs to
// synthesise them from the type registry), so a synth .db3 only needs to
// faithfully reproduce the topics + messages tables.

export interface SynthDb3Topic {
  topic: string;
  /** ROS2 long form, e.g. `std_msgs/msg/String`. */
  type: string;
  /** Pre-encoded CDR bytes per message. The MessageWriter from the MCAP
   *  helpers above produces these for the bundled type registry. */
  messages: Array<{ timestampNs: bigint; data: Uint8Array }>;
}

/**
 * Encode a set of topics + messages into a `.db3` SQLite buffer. Uses sql.js
 * (the same WASM build BAGEL's parser worker uses). Round-trips through
 * `parseDb3` / `readRawMessagesDb3`.
 */
export async function writeSyntheticDb3(
  topics: SynthDb3Topic[],
): Promise<Uint8Array> {
  const sqlJsModule = await import('sql.js');
  const initSqlJs =
    (sqlJsModule as unknown as { default?: unknown }).default ?? sqlJsModule;
  const SQL = await (
    initSqlJs as (config: { locateFile: () => string }) => Promise<{
      Database: new () => {
        run: (sql: string, params?: unknown[]) => void;
        prepare: (sql: string) => {
          bind: (params: unknown[]) => boolean;
          step: () => boolean;
          get: () => unknown[];
          free: () => boolean;
          run: (params?: unknown[]) => void;
        };
        export: () => Uint8Array;
        close: () => void;
      };
    }>
  )({
    // Node test environment: resolve the WASM bundled with sql.js itself
    // rather than the public/sql-wasm.wasm path the browser worker uses.
    // `fileURLToPath` is the only cross-platform way to translate
    // `import.meta.url` into a real filesystem path (URL.pathname returns
    // `/C:/...` on Windows which Node's fs APIs reject).
    locateFile: () => {
      const here = dirname(fileURLToPath(import.meta.url));
      return resolve(here, '../../node_modules/sql.js/dist/sql-wasm.wasm');
    },
  });

  const db = new SQL.Database();
  // Schema matches what `rosbag2_storage_default_plugins` emits.
  db.run(`CREATE TABLE topics (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    serialization_format TEXT NOT NULL,
    offered_qos_profiles TEXT
  )`);
  db.run(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY,
    topic_id INTEGER NOT NULL,
    timestamp INTEGER NOT NULL,
    data BLOB NOT NULL
  )`);

  const insertTopic = db.prepare(
    `INSERT INTO topics (id, name, type, serialization_format) VALUES (?, ?, ?, 'cdr')`,
  );
  const insertMessage = db.prepare(
    `INSERT INTO messages (topic_id, timestamp, data) VALUES (?, ?, ?)`,
  );

  try {
    for (let i = 0; i < topics.length; i++) {
      const t = topics[i];
      const topicId = i + 1;
      insertTopic.run([topicId, t.topic, t.type]);
      for (const m of t.messages) {
        insertMessage.run([topicId, m.timestampNs, m.data]);
      }
    }
  } finally {
    insertTopic.free();
    insertMessage.free();
  }

  const bytes = db.export();
  db.close();
  return bytes;
}

/** Build a 3-message `/chatter` (std_msgs/msg/String) .db3 with CDR-encoded payloads. */
export async function chatterDb3Bag(): Promise<Uint8Array> {
  const stringDefs = collectDefinitions('std_msgs/msg/String');
  const stringWriter = new MessageWriter(stringDefs);
  return writeSyntheticDb3([
    {
      topic: '/chatter',
      type: 'std_msgs/msg/String',
      messages: [
        { timestampNs: 1_000_000_000n, data: stringWriter.writeMessage({ data: 'hello' }) },
        { timestampNs: 2_000_000_000n, data: stringWriter.writeMessage({ data: 'world' }) },
        { timestampNs: 3_000_000_000n, data: stringWriter.writeMessage({ data: 'bagel' }) },
      ],
    },
  ]);
}

/**
 * Build a multi-topic .db3 covering a registry-resolvable type (`std_msgs/msg/Int32`)
 * and an unknown-to-the-registry type (`custom_msgs/msg/Mystery`). The unknown
 * type's bytes are arbitrary; the test only cares that editDb3 surfaces it as
 * a missing-schema topic.
 */
export async function multiTopicDb3Bag(): Promise<Uint8Array> {
  const intDefs = collectDefinitions('std_msgs/msg/Int32');
  const intWriter = new MessageWriter(intDefs);
  return writeSyntheticDb3([
    {
      topic: '/ints',
      type: 'std_msgs/msg/Int32',
      messages: [
        { timestampNs: 1_000_000_000n, data: intWriter.writeMessage({ data: 1 }) },
        { timestampNs: 2_000_000_000n, data: intWriter.writeMessage({ data: 2 }) },
      ],
    },
    {
      topic: '/mystery',
      type: 'custom_msgs/msg/Mystery',
      messages: [
        { timestampNs: 1_500_000_000n, data: new Uint8Array([0xde, 0xad, 0xbe, 0xef]) },
      ],
    },
  ]);
}
