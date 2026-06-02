/**
 * ROS2 .db3 editing: time-range trim + topic filter, .db3-in to MCAP-out.
 *
 * v1.2 banner feature. Sibling to `editMcapBag` and `editRos1Bag`: reuses
 * the v1.1 `MemoryWritable` + `McapWriter` plumbing and the same
 * `EditOptions` / `EditResult` shapes.
 *
 * The hard problem `.db3` editing has to solve that the other two formats
 * don't: schemas aren't embedded in the source file. They live in the
 * bundled `ros2galactic` type registry plus any user-pasted custom schemas
 * (the v0.8.1 paste flow). For each surviving topic we look the type up,
 * synthesise its `.msg` text via `@foxglove/rosmsg`'s built-in `stringify`,
 * and register it into the output as a `ros2msg`-encoded MCAP schema.
 *
 * Topics whose type can't be resolved against the registry default to being
 * skipped with a console warning. Callers can opt them in by passing the
 * topic name in `EditOptions.includeUnresolvedTopics`; the messages then
 * get written into the output with `messageEncoding: 'cdr'` but no schema
 * attached. Tools that don't care about schema text (BAGEL after the user
 * pastes one, or any tool that consumes raw CDR bytes) can still read the
 * result; tools that walk the schema list will silently miss the channel.
 */

import { McapWriter, type IWritable } from '@mcap/core';
import { stringify } from '@foxglove/rosmsg';
import type { BagSource } from './source';
import { loadDb3ForEdit } from './db3';
import { getMessageDefinition } from './typeRegistry';
import type { EditOptions, EditResult } from './edit';

/**
 * In-memory `IWritable` for MCAP output. Local copy so this module doesn't
 * reach into `edit.ts` for an implementation detail.
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

/**
 * For each topic in the bag, whether its type resolves against the bundled
 * registry + user custom schemas. The modal pre-flight uses this to render
 * a "schema missing" chip and gate the opt-in toggle.
 */
export interface Db3TopicResolution {
  topic: string;
  type: string;
  /** True if `getMessageDefinition(type)` returns a non-empty closure. */
  resolvable: boolean;
}

export async function getResolvableTopicsDb3(
  source: BagSource,
): Promise<Db3TopicResolution[]> {
  const meta = await loadDb3ForEdit(source);
  const out: Db3TopicResolution[] = [];
  for (const [topic, type] of meta.topicTypeByName) {
    const defs = await getMessageDefinition(type);
    out.push({
      topic,
      type,
      resolvable: defs !== undefined && defs.length > 0,
    });
  }
  return out;
}

/**
 * Compute the precise message count that would survive the edit. Uses a
 * single SQL aggregate so even multi-GB bags answer in milliseconds.
 */
export async function estimateMessageCountDb3(
  source: BagSource,
  startNs: bigint,
  endNs: bigint,
  topics: Set<string> | null,
): Promise<number> {
  const meta = await loadDb3ForEdit(source);
  if (endNs <= startNs) return 0;

  // sql.js takes positional binds; assemble the topic IN list with placeholders.
  const topicList = topics ? Array.from(topics) : null;
  const topicClause =
    topicList && topicList.length > 0
      ? `AND t.name IN (${topicList.map(() => '?').join(',')})`
      : '';
  const sql = `
    SELECT COUNT(*) FROM messages m
    JOIN topics t ON m.topic_id = t.id
    WHERE m.timestamp >= ? AND m.timestamp <= ? ${topicClause}
  `;
  const params: unknown[] = [startNs, endNs];
  if (topicList && topicList.length > 0) params.push(...topicList);
  // If the include set is empty, no messages survive.
  if (topicList && topicList.length === 0) return 0;

  const stmt = meta.db.prepare(sql);
  stmt.bind(params);
  try {
    if (stmt.step()) {
      const row = stmt.get();
      const v = row[0];
      return typeof v === 'bigint' ? Number(v) : (v as number) ?? 0;
    }
    return 0;
  } finally {
    stmt.free();
  }
}

/**
 * Edit a ROS2 `.db3` to MCAP. Walks the messages table once with a topic
 * + time WHERE clause, registers one MCAP channel per surviving topic
 * (synthesising the schema text from the registry), and writes raw CDR
 * bytes straight through.
 *
 * Throws when:
 *  - the time window is empty (`endNs <= startNs`);
 *  - the bag has no topics at all.
 */
export async function editDb3Bag(
  source: BagSource,
  options: EditOptions,
): Promise<EditResult> {
  if (options.endNs <= options.startNs) {
    throw new Error(
      `Edit window is empty: end (${options.endNs}) must be greater than start (${options.startNs}).`,
    );
  }

  const meta = await loadDb3ForEdit(source);
  if (meta.topicTypeByName.size === 0) {
    throw new Error(
      'This .db3 bag does not advertise any topics. The file may be empty ' +
        'or corrupt.',
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

  await writer.start({
    profile: options.profile ?? 'ros2',
    library: 'bagel-edit/db3',
  });

  // The set of topics the caller asked to keep. `undefined` means "every topic".
  const topicFilter = options.topics ? new Set(options.topics) : null;
  // Topics the caller has explicitly opted in to despite their schema being
  // missing from the registry (modal "Include anyway" affordance).
  const optedInUnresolved = options.includeUnresolvedTopics
    ? new Set(options.includeUnresolvedTopics)
    : new Set<string>();

  // Resolve channel registration lazily on first message so we don't pay the
  // schema-synth cost for topics that produce zero messages in the window.
  const channelIdByTopicId = new Map<number, number | null>(); // null = skip
  const warnedTopics = new Set<string>();

  // Preload (topic_id -> topic name, type) so the loop doesn't need to hit
  // the DB for the lookup.
  const topicInfoById = new Map<number, { name: string; type: string }>();
  {
    const stmt = meta.db.prepare('SELECT id, name, type FROM topics');
    try {
      while (stmt.step()) {
        const row = stmt.get();
        topicInfoById.set(row[0] as number, {
          name: row[1] as string,
          type: row[2] as string,
        });
      }
    } finally {
      stmt.free();
    }
  }

  const registerChannelOnce = async (topicId: number): Promise<number | null> => {
    if (channelIdByTopicId.has(topicId)) return channelIdByTopicId.get(topicId)!;
    const info = topicInfoById.get(topicId);
    if (!info) {
      channelIdByTopicId.set(topicId, null);
      return null;
    }
    if (topicFilter && !topicFilter.has(info.name)) {
      channelIdByTopicId.set(topicId, null);
      return null;
    }
    const defs = await getMessageDefinition(info.type);
    let schemaId = 0;
    if (defs && defs.length > 0) {
      schemaId = await writer.registerSchema({
        name: info.type,
        encoding: 'ros2msg',
        data: new TextEncoder().encode(stringify(defs)),
      });
    } else if (!optedInUnresolved.has(info.name)) {
      // No schema and not opted in: skip and warn (once per topic).
      if (!warnedTopics.has(info.name)) {
        console.warn(
          `[editDb3] skipping topic ${info.name} (${info.type}): ` +
            'type not in registry and not opted in via includeUnresolvedTopics',
        );
        warnedTopics.add(info.name);
      }
      channelIdByTopicId.set(topicId, null);
      return null;
    }
    // schemaId === 0 here means "opted in with no schema" - MCAP supports
    // a sentinel zero schema id meaning "schema-less channel".
    const channelId = await writer.registerChannel({
      schemaId,
      topic: info.name,
      messageEncoding: 'cdr',
      metadata: new Map(),
    });
    channelIdByTopicId.set(topicId, channelId);
    return channelId;
  };

  // Build the iteration SQL. We bind the time window + (if present) the
  // topic include list. The include list is precomputed against the topic
  // table so the SQL stays readable even with many topics.
  const includedTopicIds: number[] = [];
  for (const [id, info] of topicInfoById) {
    if (!topicFilter || topicFilter.has(info.name)) includedTopicIds.push(id);
  }
  if (includedTopicIds.length === 0) {
    // No topics survive the filter; finish the empty bag.
    await writer.end();
    return {
      bytes: writable.getBytes(),
      messageCount: 0,
      startNs: options.startNs,
      endNs: options.endNs,
    };
  }

  const sql = `
    SELECT topic_id, timestamp, data FROM messages
    WHERE timestamp >= ? AND timestamp <= ?
      AND topic_id IN (${includedTopicIds.map(() => '?').join(',')})
    ORDER BY timestamp ASC
  `;
  const stmt = meta.db.prepare(sql);
  stmt.bind([options.startNs, options.endNs, ...includedTopicIds]);

  let written = 0;
  let firstNs: bigint | null = null;
  let lastNs: bigint | null = null;
  let sequence = 0;
  try {
    while (stmt.step()) {
      const row = stmt.get();
      const topicId = row[0] as number;
      const tsRaw = row[1] as number | bigint;
      const ts = typeof tsRaw === 'bigint' ? tsRaw : BigInt(tsRaw);
      const data = row[2] as Uint8Array;

      const outChannelId = await registerChannelOnce(topicId);
      if (outChannelId === null) continue;

      const messageBytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      await writer.addMessage({
        channelId: outChannelId,
        sequence: sequence++,
        logTime: ts,
        publishTime: ts,
        data: messageBytes,
      });
      written++;
      if (firstNs === null || ts < firstNs) firstNs = ts;
      if (lastNs === null || ts > lastNs) lastNs = ts;
      if (written % 250 === 0) {
        options.onProgress?.(written);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } finally {
    stmt.free();
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
