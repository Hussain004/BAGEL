/**
 * `.db3` reading without loading the file: the same read APIs as `db3.ts`,
 * answered from SQLite pages fetched on demand (`sqlitePages.ts`).
 *
 * Opening walks the `messages` table once and keeps, per topic, every row's
 * timestamp, rowid, blob length and page location, in typed arrays sorted by
 * time. That walk reads every leaf page but none of the blob overflow pages,
 * which are most of the bytes in an image or point cloud bag. After it, each
 * read is a binary search plus a fetch of just the rows it returns. Nothing
 * here depends on an index (rosbag2 has none on (topic_id, timestamp), and
 * `timestamp_idx` differs between distros).
 *
 * `db3.ts` routes large files and URLs here and keeps sql.js for the rest;
 * tests compare the two answer for answer.
 */

import type { AllTopicStats, RawMessage, TopicInfo } from '../types/bag';
import { deserializeByType } from './cdr';
import { db3MessageBytes } from './db3Bytes';
import { RangePicker, type RangeParams, type RangeResult } from './range';
import { SqlitePages, type Row, type SqliteTable } from './sqlitePages';
import { sourceDisplayName, sourceKey, sourceReadSlice, sourceSize, type SingleBagSource } from './source';

interface TopicIndex {
  ts: BigInt64Array;
  rowid: Float64Array;
  page: Uint32Array;
  cell: Uint16Array;
  size: Uint32Array;
}

interface StreamDb {
  key: string;
  displayName: string;
  size: number;
  pages: SqlitePages;
  messages: SqliteTable;
  dataColumn: number;
  topics: TopicInfo[];
  topicTypeByName: Map<string, string>;
  index: Map<string, TopicIndex>;
  /** MIN / MAX / COUNT over the whole messages table, as the SQL path computes them. */
  minTs: bigint | null;
  maxTs: bigint | null;
  rowCount: number;
  /** Every row's (rowid, topic, ts, size), for the stats sampler; topic is '' for an unknown topic_id. */
  all: { rowid: Float64Array; topic: string[]; ts: BigInt64Array; size: Uint32Array };
  messageCache: Map<string, Map<bigint, Record<string, unknown> | null>>;
}

let cached: StreamDb | null = null;
let opening: { key: string; promise: Promise<StreamDb> } | null = null;

function column(table: SqliteTable, name: string): number {
  const i = table.columns.indexOf(name);
  if (i < 0) throw new Error(`db3: table "${table.name}" has no "${name}" column.`);
  return i;
}

const toBig = (v: unknown): bigint => (typeof v === 'bigint' ? v : BigInt(Math.trunc(Number(v))));

async function open(source: SingleBagSource): Promise<StreamDb> {
  const size = sourceSize(source);
  const pages = await SqlitePages.open(size, (a, b) => sourceReadSlice(source, a, b));
  const tables = await pages.tables();
  const topicsTable = tables.get('topics');
  const messages = tables.get('messages');
  if (!topicsTable || !messages) throw new Error('db3: this SQLite file has no rosbag2 "topics" and "messages" tables.');

  const tId = column(topicsTable, 'id');
  const tName = column(topicsTable, 'name');
  const tType = column(topicsTable, 'type');
  const tFmt = topicsTable.columns.indexOf('serialization_format');
  const topicRows: Row[] = [];
  const tPick = [tId, tName, tType, ...(tFmt >= 0 ? [tFmt] : [])];
  await pages.scan(topicsTable.rootPage, (r) => topicRows.push(...r), tPick, topicsTable);
  const topics: TopicInfo[] = [];
  const nameById = new Map<number, string>();
  const topicTypeByName = new Map<string, string>();
  for (const row of topicRows) {
    const [id, name, type, fmt] = row.picked!;
    topics.push({ name: String(name), type: String(type), messageCount: 0, serializationFormat: (fmt as string) || 'cdr' });
    nameById.set(Number(id), String(name));
    topicTypeByName.set(String(name), String(type));
  }

  const mTopic = column(messages, 'topic_id');
  const mTs = column(messages, 'timestamp');
  const dataColumn = column(messages, 'data');
  const rowid: number[] = [];
  const topicOf: string[] = [];
  const tsAll: bigint[] = [];
  const sizeAll: number[] = [];
  const pageAll: number[] = [];
  const cellAll: number[] = [];
  let minTs: bigint | null = null;
  let maxTs: bigint | null = null;
  await pages.scan(
    messages.rootPage,
    (rows) => {
      for (const row of rows) {
        const [topicId, ts] = row.picked!;
        if (ts === null) continue; // MIN / MAX / ORDER BY skip NULLs too
        const t = toBig(ts);
        if (minTs === null || t < minTs) minTs = t;
        if (maxTs === null || t > maxTs) maxTs = t;
        rowid.push(row.rowid);
        topicOf.push(nameById.get(Number(topicId)) ?? '');
        tsAll.push(t);
        sizeAll.push(SqlitePages.valueLength(row, dataColumn));
        pageAll.push(row.location.page);
        cellAll.push(row.location.cell);
      }
    },
    [mTopic, mTs],
    messages,
  );

  // Per-topic arrays sorted by (timestamp, rowid): the SQL path's ORDER BY timestamp.
  const byTopic = new Map<string, number[]>();
  for (let i = 0; i < rowid.length; i++) {
    if (!topicOf[i]) continue;
    let list = byTopic.get(topicOf[i]);
    if (!list) byTopic.set(topicOf[i], (list = []));
    list.push(i);
  }
  const index = new Map<string, TopicIndex>();
  for (const [name, list] of byTopic) {
    list.sort((a, b) => (tsAll[a] < tsAll[b] ? -1 : tsAll[a] > tsAll[b] ? 1 : rowid[a] - rowid[b]));
    index.set(name, {
      ts: BigInt64Array.from(list, (i) => tsAll[i]),
      rowid: Float64Array.from(list, (i) => rowid[i]),
      page: Uint32Array.from(list, (i) => pageAll[i]),
      cell: Uint16Array.from(list, (i) => cellAll[i]),
      size: Uint32Array.from(list, (i) => sizeAll[i]),
    });
  }
  for (const t of topics) t.messageCount = index.get(t.name)?.ts.length ?? 0;

  return {
    key: sourceKey(source),
    displayName: sourceDisplayName(source),
    size,
    pages,
    messages,
    dataColumn,
    topics,
    topicTypeByName,
    index,
    minTs,
    maxTs,
    rowCount: rowid.length,
    all: { rowid: Float64Array.from(rowid), topic: topicOf, ts: BigInt64Array.from(tsAll), size: Uint32Array.from(sizeAll) },
    messageCache: new Map(),
  };
}

export async function loadStreamDb(source: SingleBagSource): Promise<StreamDb> {
  const key = sourceKey(source);
  if (cached?.key === key) return cached;
  if (opening?.key === key) return opening.promise;
  const promise = open(source).then(
    (db) => {
      cached = db;
      opening = null;
      return db;
    },
    (err) => {
      opening = null;
      throw err;
    },
  );
  opening = { key, promise };
  return promise;
}

export function disposeDb3StreamCache(): void {
  cached = null;
  opening = null;
}

export function clearDb3StreamDecodedCache(): void {
  cached?.messageCache.clear();
}

/** The data blob of the i-th (time-ordered) message of a topic. */
async function blobAt(db: StreamDb, idx: TopicIndex, i: number): Promise<Uint8Array> {
  const row = await db.pages.rowAt({ page: idx.page[i], cell: idx.cell[i] });
  const v = await db.pages.value(row, db.dataColumn, db.messages);
  return v instanceof Uint8Array ? v : typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(0);
}

/** First index with ts >= t. */
function lowerBound(ts: BigInt64Array, t: bigint): number {
  let lo = 0;
  let hi = ts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export async function summaryStream(source: SingleBagSource) {
  const db = await loadStreamDb(source);
  return {
    displayName: db.displayName,
    size: db.size,
    topics: db.topics.map((t) => ({ ...t })),
    startTime: db.minTs ?? 0n,
    endTime: db.maxTs ?? 0n,
  };
}

export async function readRawMessagesDb3Stream(source: SingleBagSource, topicName: string, limit?: number): Promise<RawMessage[]> {
  const db = await loadStreamDb(source);
  const idx = db.index.get(topicName);
  if (!idx) return [];
  const n = limit ? Math.min(Math.floor(limit), idx.ts.length) : idx.ts.length;
  const out: RawMessage[] = new Array(n);
  // A few rows in flight at once; each is its own small set of page reads.
  let next = 0;
  const worker = async () => {
    while (next < n) {
      const i = next++;
      out[i] = { topicName, timestamp: idx.ts[i], data: db3MessageBytes(await blobAt(db, idx, i)) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, n) }, worker));
  return out;
}

export async function getTopicTypeDb3Stream(source: SingleBagSource, topicName: string): Promise<string | undefined> {
  return (await loadStreamDb(source)).topicTypeByName.get(topicName);
}

export async function readRangeDb3Stream(source: SingleBagSource, topicName: string, params: RangeParams): Promise<RangeResult> {
  const db = await loadStreamDb(source);
  const msgType = db.topicTypeByName.get(topicName);
  const idx = db.index.get(topicName);
  if (!msgType || !idx) return { messages: [], nextStartNs: null, phase: 0 };
  const picker = new RangePicker(params);
  const out: RangeResult['messages'] = [];
  for (let i = lowerBound(idx.ts, picker.params.startNs); i < idx.ts.length && idx.ts[i] <= picker.params.endNs; i++) {
    if (picker.offer(idx.ts[i])) {
      let value: Record<string, unknown> | null = null;
      try {
        value = await deserializeByType(msgType, db3MessageBytes(await blobAt(db, idx, i)));
      } catch {
        // counted, like everywhere else
      }
      out.push({ timestamp: idx.ts[i], value });
    }
    if (picker.done) break;
  }
  return picker.finish(out);
}

const CACHE_PER_TOPIC = 6;

export async function readMessageAtTimeDb3Stream(
  source: SingleBagSource,
  topicName: string,
  timeNs: bigint,
): Promise<{ timestamp: bigint; value: Record<string, unknown> | null } | null> {
  const db = await loadStreamDb(source);
  const msgType = db.topicTypeByName.get(topicName);
  const idx = db.index.get(topicName);
  if (!msgType || !idx || idx.ts.length === 0) return null;
  // Same rule as the SQL path: the first row at or after the time, replaced
  // by the last one before it only when strictly closer.
  const at = lowerBound(idx.ts, timeNs);
  let best = at < idx.ts.length ? at : -1;
  if (at > 0) {
    const before = at - 1;
    const dist = (i: number) => (idx.ts[i] > timeNs ? idx.ts[i] - timeNs : timeNs - idx.ts[i]);
    if (best < 0 || dist(before) < dist(best)) best = before;
  }
  const ts = idx.ts[best];
  let perTopic = db.messageCache.get(topicName);
  if (!perTopic) db.messageCache.set(topicName, (perTopic = new Map()));
  if (perTopic.has(ts)) {
    const hit = perTopic.get(ts)!;
    perTopic.delete(ts);
    perTopic.set(ts, hit);
    return { timestamp: ts, value: hit };
  }
  let value: Record<string, unknown> | null;
  try {
    value = await deserializeByType(msgType, db3MessageBytes(await blobAt(db, idx, best)));
  } catch {
    value = null;
  }
  perTopic.set(ts, value);
  while (perTopic.size > CACHE_PER_TOPIC) perTopic.delete(perTopic.keys().next().value!);
  return { timestamp: ts, value };
}

const MAX_TOTAL_SAMPLES = 100_000;

export async function readAllMessageStatsDb3Stream(source: SingleBagSource): Promise<AllTopicStats> {
  const db = await loadStreamDb(source);
  const startNs = db.minTs ?? 0n;
  // Same sampling as the SQL path: every step-th rowid.
  const step = Math.max(1, Math.floor(db.rowCount / MAX_TOTAL_SAMPLES));
  const { rowid, topic, ts, size } = db.all;
  const picked: number[] = [];
  for (let i = 0; i < rowid.length; i++) {
    if (topic[i] && (step <= 1 || (rowid[i] - 1) % step === 0)) picked.push(i);
  }
  picked.sort((a, b) => (ts[a] < ts[b] ? -1 : ts[a] > ts[b] ? 1 : rowid[a] - rowid[b]));
  const times = new Map<string, number[]>();
  const sizes = new Map<string, number[]>();
  for (const i of picked) {
    let t = times.get(topic[i]);
    if (!t) {
      times.set(topic[i], (t = []));
      sizes.set(topic[i], []);
    }
    t.push(Number(ts[i] - startNs));
    sizes.get(topic[i])!.push(size[i]);
  }
  const result: AllTopicStats = {};
  for (const [name, t] of times) result[name] = { times: new Float64Array(t), sizes: new Uint32Array(sizes.get(name)!) };
  return result;
}
