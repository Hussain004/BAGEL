/**
 * SQLite DB3 File Parser
 *
 * Parses ROS2 .db3 bag files using sql.js (SQLite compiled to WASM).
 * DB3 files are SQLite databases with 'topics' and 'messages' tables.
 *
 * Beyond producing a BagSummary, this module also exposes message-level
 * APIs (readRawMessages, readDeserializedMessages) used by visualization
 * panels in v0.2+. A long-lived Database instance is cached after the
 * first parseDb3() call so subsequent reads avoid re-parsing the WASM file.
 */

import type { BagSummary, RawMessage, TopicInfo } from '../types/bag';
import { deserializeByType } from './cdr';
import {
  sourceDisplayName,
  sourceKey,
  sourceReadAll,
  sourceSize,
  type BagSource,
} from './source';

interface SqlDatabase {
  exec(sql: string): { columns: string[]; values: unknown[][] }[];
  prepare(sql: string): SqlStatement;
  close(): void;
}

interface SqlStatement {
  bind(params: unknown[]): boolean;
  step(): boolean;
  get(): unknown[];
  free(): boolean;
}

let sqlPromise: Promise<{ Database: new (data?: ArrayLike<number>) => SqlDatabase }> | null = null;

function getSqlJs() {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const sqlJsModule = await import('sql.js');
      const initSqlJs = (sqlJsModule as { default?: unknown }).default ?? sqlJsModule;
      return (initSqlJs as (config: { locateFile: () => string }) => Promise<{
        Database: new (data?: ArrayLike<number>) => SqlDatabase;
      }>)({
        locateFile: () => '/sql-wasm.wasm',
      });
    })();
  }
  return sqlPromise;
}

interface CachedDb {
  sourceKey: string;
  displayName: string;
  size: number;
  db: SqlDatabase;
  topicTypeByName: Map<string, string>;
  /** Per-topic LRU of decoded messages keyed by row timestamp. Skips the
   *  CDR decode when the playhead ticks above the topic's publish rate
   *  (image playback at 30 Hz against a 10 Hz topic returns the same
   *  message three times in a row otherwise). */
  messageCache: Map<string, Map<bigint, Record<string, unknown> | null>>;
}

let cachedDb: CachedDb | null = null;

function disposeCachedDb() {
  if (cachedDb) {
    try {
      cachedDb.db.close();
    } catch {
      // best-effort
    }
    cachedDb = null;
  }
}

export function disposeDb3Cache(): void {
  disposeCachedDb();
}

/**
 * Drop the per-topic decoded-message LRU but keep the loaded SQLite database.
 *
 * Used after the user adds a custom schema: any topic whose type just became
 * decodable would otherwise keep returning the stale `value: null` cached
 * from the pre-schema decode attempt. Wiping the decoded cache forces a
 * fresh CDR pass against the new MessageReader on next read. The underlying
 * raw bytes don't need to be re-fetched — sql.js stays cached, so this is
 * cheap.
 */
export function clearDb3DecodedCache(): void {
  if (cachedDb) cachedDb.messageCache.clear();
}

async function loadDb(source: BagSource): Promise<CachedDb> {
  const key = sourceKey(source);
  if (cachedDb && cachedDb.sourceKey === key) {
    return cachedDb;
  }

  disposeCachedDb();

  const SQL = await getSqlJs();
  // sql.js needs the whole file in memory either way — for URL sources we
  // pay a single eager GET. Practical cap is ~250 MB before the browser UX
  // degrades; sql.js-httpvfs would do real partial reads via a custom
  // SQLite VFS but adds ~70 KB plus a non-trivial amount of glue.
  const buffer = await sourceReadAll(source);
  const db = new SQL.Database(buffer);

  const topicTypeByName = new Map<string, string>();
  const topicsResult = db.exec(`SELECT name, type FROM topics`);
  if (topicsResult.length > 0) {
    for (const row of topicsResult[0].values) {
      topicTypeByName.set(row[0] as string, row[1] as string);
    }
  }

  cachedDb = {
    sourceKey: key,
    displayName: sourceDisplayName(source),
    size: sourceSize(source),
    db,
    topicTypeByName,
    messageCache: new Map(),
  };
  return cachedDb;
}

/** Per-topic decoded-message LRU bound. */
const DB3_MESSAGE_CACHE_MAX_PER_TOPIC = 6;

async function rememberDecodedDb3(
  cache: CachedDb,
  topicName: string,
  timestamp: bigint,
  data: Uint8Array,
  msgType: string,
): Promise<Record<string, unknown> | null> {
  let perTopic = cache.messageCache.get(topicName);
  if (!perTopic) {
    perTopic = new Map();
    cache.messageCache.set(topicName, perTopic);
  } else if (perTopic.has(timestamp)) {
    const hit = perTopic.get(timestamp)!;
    // Bump to MRU end.
    perTopic.delete(timestamp);
    perTopic.set(timestamp, hit);
    return hit;
  }
  let value: Record<string, unknown> | null;
  try {
    value = await deserializeByType(msgType, data);
  } catch {
    value = null;
  }
  perTopic.set(timestamp, value);
  while (perTopic.size > DB3_MESSAGE_CACHE_MAX_PER_TOPIC) {
    const oldest = perTopic.keys().next().value;
    if (oldest === undefined) break;
    perTopic.delete(oldest);
  }
  return value;
}

/**
 * Parse a .db3 ROS2 bag file and return a BagSummary.
 */
export async function parseDb3(source: BagSource): Promise<BagSummary> {
  const meta = await loadDb(source);
  const { db } = meta;

  const topics = queryTopics(db);
  const { startTime, endTime, messageCounts } = queryMessageStats(db);

  for (const topic of topics) {
    topic.messageCount = messageCounts.get(topic.name) ?? 0;
  }

  const durationNs = endTime - startTime;
  const duration = Number(durationNs) / 1e9;
  const totalMessageCount = topics.reduce((sum, t) => sum + t.messageCount, 0);

  if (duration > 0) {
    for (const topic of topics) {
      topic.frequency = Math.round((topic.messageCount / duration) * 10) / 10;
    }
  }

  return {
    format: 'db3',
    fileName: meta.displayName,
    fileSize: meta.size,
    startTime,
    endTime,
    duration,
    totalMessageCount,
    topics: topics.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

function queryTopics(db: SqlDatabase): TopicInfo[] {
  const results = db.exec(`
    SELECT id, name, type, serialization_format
    FROM topics
  `);

  if (results.length === 0) return [];

  const { values } = results[0];
  return values.map((row) => ({
    name: row[1] as string,
    type: row[2] as string,
    messageCount: 0,
    serializationFormat: (row[3] as string) || 'cdr',
  }));
}

function queryMessageStats(db: SqlDatabase): {
  startTime: bigint;
  endTime: bigint;
  messageCounts: Map<string, number>;
} {
  const timeResult = db.exec(`SELECT MIN(timestamp), MAX(timestamp) FROM messages`);

  let startTime = 0n;
  let endTime = 0n;

  if (timeResult.length > 0 && timeResult[0].values.length > 0) {
    const [minTs, maxTs] = timeResult[0].values[0];
    if (minTs != null) startTime = BigInt(minTs as number);
    if (maxTs != null) endTime = BigInt(maxTs as number);
  }

  const countResult = db.exec(`
    SELECT t.name, COUNT(m.id) as msg_count
    FROM messages m
    JOIN topics t ON m.topic_id = t.id
    GROUP BY t.name
  `);

  const messageCounts = new Map<string, number>();
  if (countResult.length > 0) {
    for (const row of countResult[0].values) {
      messageCounts.set(row[0] as string, row[1] as number);
    }
  }

  return { startTime, endTime, messageCounts };
}

/**
 * Read raw (still CDR-encoded) messages for a single topic.
 *
 * Messages are returned in chronological order. The optional `limit` caps
 * how many messages are loaded — useful for very large bags where loading
 * every message would exhaust memory.
 */
export async function readRawMessagesDb3(
  source: BagSource,
  topicName: string,
  limit?: number,
): Promise<RawMessage[]> {
  const { db } = await loadDb(source);

  const sql = `
    SELECT m.timestamp, m.data
    FROM messages m
    JOIN topics t ON m.topic_id = t.id
    WHERE t.name = $name
    ORDER BY m.timestamp ASC
    ${limit ? `LIMIT ${Math.floor(limit)}` : ''}
  `;
  const stmt = db.prepare(sql);
  stmt.bind([topicName]);

  const out: RawMessage[] = [];
  try {
    while (stmt.step()) {
      const row = stmt.get();
      const ts = row[0] as number | bigint;
      const data = row[1] as Uint8Array;
      out.push({
        topicName,
        timestamp: typeof ts === 'bigint' ? ts : BigInt(ts),
        data,
      });
    }
  } finally {
    stmt.free();
  }
  return out;
}

/**
 * Read and CDR-deserialize messages for a topic. Returns nulls for messages
 * whose type isn't in the bundled type registry.
 *
 * Yields to the event loop every 500 messages so the UI stays responsive
 * while large topics decode; onProgress fires at the same cadence.
 */
const DB3_YIELD_EVERY = 500;

export async function readDeserializedMessagesDb3(
  source: BagSource,
  topicName: string,
  limit?: number,
  onProgress?: (decoded: number) => void,
  onBatch?: (batch: { timestamp: bigint; value: Record<string, unknown> | null }[]) => void,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null }[]> {
  const { topicTypeByName } = await loadDb(source);
  const msgType = topicTypeByName.get(topicName);
  if (!msgType) return [];

  const raws = await readRawMessagesDb3(source, topicName, limit);
  const out: { timestamp: bigint; value: Record<string, unknown> | null }[] = [];
  let lastFlushedIndex = 0;
  for (const raw of raws) {
    try {
      const value = await deserializeByType(msgType, raw.data);
      out.push({ timestamp: raw.timestamp, value });
    } catch {
      out.push({ timestamp: raw.timestamp, value: null });
    }
    if (out.length % DB3_YIELD_EVERY === 0) {
      onProgress?.(out.length);
      if (onBatch && out.length > lastFlushedIndex) {
        onBatch(out.slice(lastFlushedIndex));
        lastFlushedIndex = out.length;
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(out.length);
  if (onBatch && out.length > lastFlushedIndex) {
    onBatch(out.slice(lastFlushedIndex));
  }
  return out;
}

/**
 * Read and deserialize a single message near `timeNs` for a topic.
 *
 * Used by Image/Raw inspector panels for lazy single-frame loads. SQLite
 * finds the nearest row by timestamp directly so we never pull the whole
 * topic's blobs into memory.
 */
export async function readMessageAtTimeDb3(
  source: BagSource,
  topicName: string,
  timeNs: bigint,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null } | null> {
  const cache = await loadDb(source);
  const { db, topicTypeByName } = cache;
  const msgType = topicTypeByName.get(topicName);
  if (!msgType) return null;

  // The closest row by abs(ts - target) — use a UNION ordered pattern so
  // SQLite can use the timestamp index in both directions. Two positional
  // binds per side: (topic name, target ts).
  const sql = `
    SELECT timestamp, data FROM (
      SELECT m.timestamp AS timestamp, m.data AS data
      FROM messages m
      JOIN topics t ON m.topic_id = t.id
      WHERE t.name = ? AND m.timestamp >= ?
      ORDER BY m.timestamp ASC LIMIT 1
    )
    UNION ALL
    SELECT timestamp, data FROM (
      SELECT m.timestamp AS timestamp, m.data AS data
      FROM messages m
      JOIN topics t ON m.topic_id = t.id
      WHERE t.name = ? AND m.timestamp < ?
      ORDER BY m.timestamp DESC LIMIT 1
    )
  `;

  const stmt = db.prepare(sql);
  // sql.js' bind() takes a positional array. ROS2 nanosecond timestamps
  // exceed 2^53; sql.js v1.14 accepts BigInt via the unknown[] form, but
  // we type as unknown[] since the declaration only knows about unknown.
  stmt.bind([topicName, timeNs, topicName, timeNs] as unknown[]);

  let best: { timestamp: bigint; data: Uint8Array } | null = null;
  try {
    while (stmt.step()) {
      const row = stmt.get();
      const ts = row[0] as number | bigint;
      const data = row[1] as Uint8Array;
      const tsBig = typeof ts === 'bigint' ? ts : BigInt(ts);
      const dist = tsBig > timeNs ? tsBig - timeNs : timeNs - tsBig;
      const bestDist =
        best === null
          ? null
          : best.timestamp > timeNs
            ? best.timestamp - timeNs
            : timeNs - best.timestamp;
      if (bestDist === null || dist < bestDist) {
        best = { timestamp: tsBig, data };
      }
    }
  } finally {
    stmt.free();
  }

  if (!best) return null;
  const value = await rememberDecodedDb3(
    cache,
    topicName,
    best.timestamp,
    best.data,
    msgType,
  );
  return { timestamp: best.timestamp, value };
}

/** Get the ROS2 type name for a topic in this db3 file. */
export async function getTopicTypeDb3(
  source: BagSource,
  topicName: string,
): Promise<string | undefined> {
  const { topicTypeByName } = await loadDb(source);
  return topicTypeByName.get(topicName);
}

/**
 * Sliver of the cached `.db3` state needed for v1.2 bag editing. Same pattern
 * as `loadMcapForEdit` and `loadBagForEdit`. Exposes just the SQLite handle
 * and the topic-name -> type map; `editDb3` runs its own SQL to do the
 * time + topic filter, and looks types up against the bundled type registry
 * for schema synthesis.
 */
export interface CachedDb3ForEdit {
  db: SqlDatabase;
  topicTypeByName: Map<string, string>;
}

export async function loadDb3ForEdit(source: BagSource): Promise<CachedDb3ForEdit> {
  const meta = await loadDb(source);
  return {
    db: meta.db,
    topicTypeByName: meta.topicTypeByName,
  };
}
