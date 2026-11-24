/**
 * The page reader (`db3Stream.ts` on `sqlitePages.ts`) against sql.js, the
 * proven path, answer for answer, on .db3 files built with deliberately
 * varied SQLite layouts: page sizes from 512 to 65536, auto_vacuum (ptrmap
 * pages), trees two and three levels deep, blobs exactly at the local /
 * overflow thresholds and spanning long overflow chains, deleted rows left on
 * the freelist, with and without timestamp_idx, extra and ALTER-added topic
 * columns, UTF-16 text, orphan topic ids, and per-message zstd.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zstdCompressSync } from 'node:zlib';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';
import {
  parseDb3,
  readRawMessagesDb3,
  readDeserializedMessagesDb3,
  readMessageAtTimeDb3,
  readRangeDb3,
  getTopicTypeDb3,
  readAllMessageStatsDb3,
  disposeDb3Cache,
} from '../../src/parsers/db3';
import {
  loadStreamDb,
  readRawMessagesDb3Stream,
  readMessageAtTimeDb3Stream,
  readRangeDb3Stream,
  getTopicTypeDb3Stream,
  readAllMessageStatsDb3Stream,
} from '../../src/parsers/db3Stream';
import { SqlitePages, parseColumns, readVarint } from '../../src/parsers/sqlitePages';
import type { SingleBagSource } from '../../src/parsers/source';
import { collectMessageDefinitions } from '../fixtures/synth';

type Db = {
  run: (sql: string, params?: unknown[]) => void;
  exec: (sql: string) => unknown;
  export: () => Uint8Array;
  close: () => void;
};
let SQL: { Database: new () => Db } | null = null;
async function sqlJs() {
  if (!SQL) {
    const mod = await import('sql.js');
    const init = ((mod as unknown as { default?: unknown }).default ?? mod) as (c: { locateFile: () => string }) => Promise<typeof SQL>;
    SQL = await init({ locateFile: () => resolve(dirname(fileURLToPath(import.meta.url)), '../../node_modules/sql.js/dist/sql-wasm.wasm') });
  }
  return SQL!;
}

const stringWriter = new MessageWriter(collectMessageDefinitions('std_msgs/msg/String'));
const intWriter = new MessageWriter(collectMessageDefinitions('std_msgs/msg/Int32'));

interface Layout {
  pageSize?: number;
  autoVacuum?: 0 | 1 | 2;
  utf16?: boolean;
  index?: boolean;
  extraTopicColumns?: boolean;
  /** Payload lengths (string message data) cycled through for /text. */
  sizes: number[];
  rows: number;
  deleteEvery?: number;
  zstdEvery?: number;
  orphans?: boolean;
}

/** Build a .db3 with sql.js. /text carries strings of the given sizes, /ints small ints, /quiet one message. */
async function build(l: Layout): Promise<Uint8Array> {
  const { Database } = await sqlJs();
  const db = new Database();
  if (l.pageSize) db.run(`PRAGMA page_size = ${l.pageSize}`);
  if (l.autoVacuum) db.run(`PRAGMA auto_vacuum = ${l.autoVacuum}`);
  if (l.utf16) db.run(`PRAGMA encoding = 'UTF-16le'`);
  db.run(`CREATE TABLE topics(id INTEGER PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, serialization_format TEXT NOT NULL${
    l.extraTopicColumns ? ', offered_qos_profiles TEXT NOT NULL, type_description_hash TEXT NOT NULL' : ''
  })`);
  db.run('CREATE TABLE messages(id INTEGER PRIMARY KEY, topic_id INTEGER NOT NULL, timestamp INTEGER NOT NULL, data BLOB NOT NULL)');
  if (l.index) db.run('CREATE INDEX timestamp_idx ON messages (timestamp ASC)');
  const topic = (id: number, name: string, type: string) =>
    db.run(
      l.extraTopicColumns
        ? `INSERT INTO topics (id, name, type, serialization_format, offered_qos_profiles, type_description_hash) VALUES (?, ?, ?, 'cdr', 'qos: ${'x'.repeat(300)}', 'RIHS01_abc')`
        : `INSERT INTO topics (id, name, type, serialization_format) VALUES (?, ?, ?, 'cdr')`,
      [id, name, type],
    );
  topic(1, '/text', 'std_msgs/msg/String');
  topic(2, '/ints', 'std_msgs/msg/Int32');
  topic(3, '/quiet', 'std_msgs/msg/Int32');
  const base = 1_700_000_000_000_000_000n;
  db.run('BEGIN');
  for (let i = 0; i < l.rows; i++) {
    const ts = base + BigInt(i) * 10_000_000n + 3n;
    const n = l.sizes[i % l.sizes.length];
    let data: Uint8Array = stringWriter.writeMessage({ data: String.fromCharCode(97 + (i % 26)).repeat(n) + `#${i}` });
    if (l.zstdEvery && i % l.zstdEvery === 0) data = new Uint8Array(zstdCompressSync(data));
    db.run('INSERT INTO messages (topic_id, timestamp, data) VALUES (1, ?, ?)', [ts, data]);
    // Same timestamp on another topic: ties across topics, never within one.
    db.run('INSERT INTO messages (topic_id, timestamp, data) VALUES (2, ?, ?)', [ts, intWriter.writeMessage({ data: i * 7 - 50 })]);
    if (l.orphans && i % 9 === 0) db.run('INSERT INTO messages (topic_id, timestamp, data) VALUES (99, ?, ?)', [ts - 5n, new Uint8Array([1, 2, 3])]);
  }
  db.run('INSERT INTO messages (topic_id, timestamp, data) VALUES (3, ?, ?)', [base + 123_456_789n, intWriter.writeMessage({ data: 42 })]);
  db.run('COMMIT');
  if (l.deleteEvery) db.run(`DELETE FROM messages WHERE topic_id = 1 AND id % ${l.deleteEvery} = 0`);
  if (l.extraTopicColumns) {
    db.run('ALTER TABLE topics ADD COLUMN later TEXT');
    topic(4, '/late', 'std_msgs/msg/String');
  }
  const bytes = db.export();
  db.close();
  return bytes;
}

const file = (b: Uint8Array, name = 'bag.db3'): SingleBagSource => ({ kind: 'file', file: new File([b], `${Math.random()}-${name}`) });

/** Local/overflow boundary sizes for a page size, as string lengths (CDR adds 8 bytes, the record header ~5). */
function thresholds(pageSize: number): number[] {
  const u = pageSize;
  const x = u - 35;
  const m = Math.floor(((u - 12) * 32) / 255) - 23;
  const overhead = 8 + 6; // CDR header + length + NUL, and the "#i" suffix
  return [0, 1, m - overhead, x - overhead - 20, x - overhead + 20, 3 * u, 9 * u + 17].map((n) => Math.max(0, n));
}

async function compare(bytes: Uint8Array) {
  const src = file(bytes);
  disposeDb3Cache();
  const viaSql = await parseDb3(src, false);
  const viaPages = await parseDb3(src, true);
  expect(viaPages).toEqual(viaSql);

  for (const t of viaSql.topics) {
    expect(await getTopicTypeDb3Stream(src, t.name)).toBe(await getTopicTypeDb3(src, t.name));
    const raw = await readRawMessagesDb3(src, t.name);
    expect(await readRawMessagesDb3Stream(src, t.name)).toEqual(raw);
    expect(await readRawMessagesDb3Stream(src, t.name, 3)).toEqual(await readRawMessagesDb3(src, t.name, 3));
    if (raw.length === 0) continue;
    const first = raw[0].timestamp;
    const last = raw[raw.length - 1].timestamp;
    const probes = [first - 1_000_000n, first, first + 1n, (first + last) / 2n, (first + last) / 2n + 4_999_999n, last, last + 9n];
    for (const at of probes) {
      expect(await readMessageAtTimeDb3Stream(src, t.name, at)).toEqual(await readMessageAtTimeDb3(src, t.name, at));
    }
    for (const params of [
      { startNs: first, endNs: last, stride: 1, phase: 0, max: 1000 },
      { startNs: first + 1n, endNs: (first + last) / 2n, stride: 3, phase: 1, max: 5 },
    ]) {
      expect(await readRangeDb3Stream(src, t.name, params)).toEqual(await readRangeDb3(src, t.name, params));
    }
  }
  expect(await readAllMessageStatsDb3Stream(src)).toEqual(await readAllMessageStatsDb3(src));
  return src;
}

beforeEach(() => disposeDb3Cache());

describe('page reader matches sql.js', () => {
  for (const pageSize of [512, 4096, 65536]) {
    it(`page size ${pageSize}, blobs at the overflow thresholds`, async () => {
      await compare(await build({ pageSize, sizes: thresholds(pageSize), rows: pageSize === 512 ? 400 : 120 }));
    });
  }

  it('a three-level tree of small rows (512-byte pages)', async () => {
    const bytes = await build({ pageSize: 512, sizes: [3, 40], rows: 3000 });
    const pages = await SqlitePages.open(bytes.length, async (a, b) => bytes.slice(a, b));
    const messages = (await pages.tables()).get('messages')!;
    const depth = async (n: number): Promise<number> => {
      const kids = await pages.children(n);
      return kids.length ? 1 + (await depth(kids[0])) : 1;
    };
    expect(await depth(messages.rootPage)).toBeGreaterThanOrEqual(3);
    await compare(bytes);
  });

  it('auto_vacuum full and incremental (ptrmap pages)', async () => {
    await compare(await build({ pageSize: 1024, autoVacuum: 1, sizes: [10, 2000], rows: 200 }));
    await compare(await build({ pageSize: 1024, autoVacuum: 2, sizes: [10, 5000], rows: 150, deleteEvery: 3 }));
  });

  it('deleted rows on the freelist, timestamp_idx, extra and ALTER-added topic columns', async () => {
    await compare(await build({ index: true, extraTopicColumns: true, sizes: [5, 6000], rows: 200, deleteEvery: 4 }));
  });

  it('UTF-16 text, orphan topic ids, per-message zstd', async () => {
    await compare(await build({ utf16: true, orphans: true, zstdEvery: 3, sizes: [20, 9000], rows: 150 }));
  });

  it('deserializes through db3.ts routing the same way', async () => {
    const src = file(await build({ sizes: [5, 70000], rows: 40 }));
    const viaSql = await readDeserializedMessagesDb3(src, '/text');
    expect(viaSql).toHaveLength(40);
    expect(viaSql[39].value).toMatchObject({ data: expect.stringMatching(/#39$/) });
  });
});

describe('reads pages, not the file', () => {
  it('opening a blob-heavy bag reads a small fraction of it', async () => {
    // A big row keeps up to one page of its payload on the leaf, so opening
    // costs about a page per large message: under 5% here, far less for MB images.
    const bytes = await build({ sizes: [200_000], rows: 60 });
    const src = file(bytes);
    const db = await loadStreamDb(src);
    expect(db.topics.find((t) => t.name === '/text')!.messageCount).toBe(60);
    expect(db.pages.bytesRead).toBeLessThan(bytes.length * 0.05);
    const before = db.pages.bytesRead;
    const one = await readMessageAtTimeDb3Stream(src, '/text', 1_700_000_000_000_000_000n + 50n * 10_000_000n);
    expect((one!.value as { data: string }).data).toMatch(/#50$/);
    // One message is about its own size, not the file's.
    expect(db.pages.bytesRead - before).toBeLessThan(260_000);
  });

  it('a URL source streams through HTTP Range requests', async () => {
    const bytes = await build({ sizes: [30_000], rows: 100 });
    const realFetch = globalThis.fetch;
    let whole = 0;
    let fetched = 0;
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (!range) {
        whole++;
        return new Response(bytes);
      }
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(range)!;
      fetched += Number(b) - Number(a) + 1;
      return new Response(bytes.slice(Number(a), Number(b) + 1), { status: 206 });
    }) as typeof fetch;
    try {
      const src: SingleBagSource = { kind: 'url', url: 'https://example.com/big.db3', contentLength: bytes.length, displayName: 'big.db3' };
      const summary = await parseDb3(src, true);
      expect(summary.topics.find((t) => t.name === '/text')!.messageCount).toBe(100);
      expect(whole).toBe(0);
      expect(fetched).toBeLessThan(bytes.length * 0.1);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('damaged files fail with a reason', () => {
  it('a truncated file', async () => {
    const bytes = await build({ sizes: [50, 3000], rows: 100 });
    const cut = bytes.slice(0, Math.floor(bytes.length * 0.6));
    await expect(loadStreamDb(file(cut))).rejects.toThrow(/SQLite: page \d+ is outside|ended inside a page|SQLite/);
  });

  it('a child pointer past the end, or back at an ancestor', async () => {
    const bytes = await build({ pageSize: 512, sizes: [3], rows: 800 });
    const pages = await SqlitePages.open(bytes.length, async (a, b) => bytes.slice(a, b));
    const root = (await pages.tables()).get('messages')!.rootPage;
    // The interior root's right-most pointer lives at offset 8 of its header.
    const at = (root - 1) * 512 + (root === 1 ? 100 : 0) + 8;
    const bad = bytes.slice();
    new DataView(bad.buffer).setUint32(at, 1_000_000);
    await expect(loadStreamDb(file(bad))).rejects.toThrow(/outside/);
    const loop = bytes.slice();
    new DataView(loop.buffer).setUint32(at, root);
    await expect(loadStreamDb(file(loop))).rejects.toThrow(/twice|not a b-tree/);
  });

  it('not a SQLite file', async () => {
    await expect(loadStreamDb(file(new Uint8Array(4096).fill(7)))).rejects.toThrow(/SQLite header/);
  });
});

describe('format helpers', () => {
  it('reads one- to nine-byte varints', () => {
    expect(readVarint(new Uint8Array([0x7f]), 0)).toEqual([127, 1]);
    expect(readVarint(new Uint8Array([0x81, 0x00]), 0)).toEqual([128, 2]);
    expect(readVarint(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]), 0)).toEqual([2 ** 56 - 1, 8]);
    expect(readVarint(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01]), 0)).toEqual([1, 9]);
  });

  it('parses column lists, rowid aliases and table constraints', () => {
    expect(parseColumns('CREATE TABLE messages(id INTEGER PRIMARY KEY,topic_id INTEGER NOT NULL, "time stamp" INTEGER, data BLOB)')).toEqual({
      columns: ['id', 'topic_id', 'time stamp', 'data'],
      rowidColumn: 0,
    });
    expect(parseColumns('CREATE TABLE t(a TEXT DEFAULT (lower(\'X,Y\')), id INTEGER PRIMARY KEY DESC, PRIMARY KEY (a), CHECK (a <> \'\'))')).toEqual({
      columns: ['a', 'id'],
      rowidColumn: -1,
    });
  });
});
