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
  fileName: string;
  fileSize: number;
  db: SqlDatabase;
  topicTypeByName: Map<string, string>;
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

async function loadDb(file: File): Promise<CachedDb> {
  if (
    cachedDb &&
    cachedDb.fileName === file.name &&
    cachedDb.fileSize === file.size
  ) {
    return cachedDb;
  }

  disposeCachedDb();

  const SQL = await getSqlJs();
  const buffer = await file.arrayBuffer();
  const db = new SQL.Database(new Uint8Array(buffer));

  const topicTypeByName = new Map<string, string>();
  const topicsResult = db.exec(`SELECT name, type FROM topics`);
  if (topicsResult.length > 0) {
    for (const row of topicsResult[0].values) {
      topicTypeByName.set(row[0] as string, row[1] as string);
    }
  }

  cachedDb = {
    fileName: file.name,
    fileSize: file.size,
    db,
    topicTypeByName,
  };
  return cachedDb;
}

/**
 * Parse a .db3 ROS2 bag file and return a BagSummary.
 */
export async function parseDb3(file: File): Promise<BagSummary> {
  const { db } = await loadDb(file);

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
    fileName: file.name,
    fileSize: file.size,
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
  file: File,
  topicName: string,
  limit?: number,
): Promise<RawMessage[]> {
  const { db } = await loadDb(file);

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
 */
export async function readDeserializedMessagesDb3(
  file: File,
  topicName: string,
  limit?: number,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null }[]> {
  const { topicTypeByName } = await loadDb(file);
  const msgType = topicTypeByName.get(topicName);
  if (!msgType) return [];

  const raws = await readRawMessagesDb3(file, topicName, limit);
  const out: { timestamp: bigint; value: Record<string, unknown> | null }[] = [];
  for (const raw of raws) {
    try {
      const value = await deserializeByType(msgType, raw.data);
      out.push({ timestamp: raw.timestamp, value });
    } catch {
      out.push({ timestamp: raw.timestamp, value: null });
    }
  }
  return out;
}

/** Get the ROS2 type name for a topic in this db3 file. */
export async function getTopicTypeDb3(
  file: File,
  topicName: string,
): Promise<string | undefined> {
  const { topicTypeByName } = await loadDb(file);
  return topicTypeByName.get(topicName);
}
