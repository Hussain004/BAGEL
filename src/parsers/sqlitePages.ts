/**
 * Read-only SQLite file reader that fetches pages on demand.
 *
 * sql.js needs the whole database in memory, so a multi-GB `.db3` (or one
 * behind a URL) used to mean reading all of it first. This reads the file
 * format directly (https://www.sqlite.org/fileformat2.html) through a
 * `readSlice(start, end)` callback, so callers fetch only the pages a query
 * touches: table b-tree pages, plus the overflow pages of the rows actually
 * read. Covers what rosbag2 tables need: rowid tables, every record serial
 * type, overflow chains, any page size (512 to 65536), reserved bytes, and
 * UTF-8 / UTF-16 text. Indexes and WITHOUT ROWID tables are not read.
 */

export type ReadSlice = (start: number, end: number) => Promise<Uint8Array>;

export type SqlValue = null | number | bigint | string | Uint8Array;

export interface SqliteTable {
  name: string;
  rootPage: number;
  columns: string[];
  /** Index of the `INTEGER PRIMARY KEY` column (stored as NULL, read from the rowid), or -1. */
  rowidColumn: number;
}

/** Where a row lives, so it can be re-read later without walking the tree. */
export interface RowLocation {
  page: number;
  cell: number;
}

/** A leaf cell with its record header parsed; values are read on request. */
export interface Row {
  rowid: number;
  location: RowLocation;
  /** Serial type of each stored column. */
  types: number[];
  /** Byte offset of each column's value inside the payload. */
  offsets: number[];
  payloadSize: number;
  /** Values of the columns asked for with `pick`, in that order. */
  picked?: SqlValue[];
}

const HEADER_MAGIC = 'SQLite format 3\0';

export function readVarint(b: Uint8Array, at: number): [value: number, length: number] {
  let v = 0;
  for (let i = 0; i < 8; i++) {
    const byte = b[at + i];
    if (byte === undefined) throw new Error('SQLite: varint runs past the page.');
    v = v * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return [v, i + 1];
  }
  const last = b[at + 8];
  if (last === undefined) throw new Error('SQLite: varint runs past the page.');
  return [v * 256 + last, 9];
}

/** Bytes a value of this serial type occupies in a record. */
export function serialSize(t: number): number {
  if (t <= 4) return [0, 1, 2, 3, 4][t];
  if (t === 5) return 6;
  if (t === 6 || t === 7) return 8;
  if (t === 8 || t === 9) return 0;
  if (t >= 12) return (t - (t % 2 === 0 ? 12 : 13)) / 2;
  throw new Error(`SQLite: reserved serial type ${t}.`);
}

/** Column names, in order, from a `CREATE TABLE` statement. */
export function parseColumns(sql: string): { columns: string[]; rowidColumn: number } {
  const open = sql.indexOf('(');
  const close = sql.lastIndexOf(')');
  if (open < 0 || close < open) return { columns: [], rowidColumn: -1 };
  const body = sql.slice(open + 1, close);
  const defs: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'" || ch === '`' || ch === '[') {
      quote = ch === '[' ? ']' : ch;
    } else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      defs.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  defs.push(cur);
  const columns: string[] = [];
  let rowidColumn = -1;
  for (const raw of defs) {
    const def = raw.trim();
    if (!def || /^(constraint|primary\s+key|unique|check|foreign\s+key)\b/i.test(def)) continue;
    const m = def.match(/^(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|(\S+))\s*(.*)$/s);
    if (!m) continue;
    const rest = m[5] ?? '';
    // Only an INTEGER PRIMARY KEY aliases the rowid (and is stored as NULL); DESC does not.
    if (/^integer\s+primary\s+key(?!\s+desc)\b/i.test(rest)) rowidColumn = columns.length;
    columns.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  }
  return { columns, rowidColumn };
}

export class SqlitePages {
  readonly pageSize: number;
  readonly usable: number;
  readonly pageCount: number;
  private readonly textDecoder: TextDecoder;
  private readonly readSlice: ReadSlice;
  private readonly cache = new Map<number, Uint8Array>();
  private readonly cacheLimit: number;
  /** Bytes fetched so far (for tests and diagnostics). */
  bytesRead = 0;

  private constructor(header: Uint8Array, fileSize: number, readSlice: ReadSlice, cacheBytes: number) {
    const dv = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const raw = dv.getUint16(16);
    this.pageSize = raw === 1 ? 65536 : raw;
    if (this.pageSize < 512 || this.pageSize > 65536 || (this.pageSize & (this.pageSize - 1)) !== 0) {
      throw new Error(`SQLite: invalid page size ${raw}.`);
    }
    this.usable = this.pageSize - header[20];
    if (this.usable < 480) throw new Error('SQLite: too many reserved bytes per page.');
    // The in-header page count is only trustworthy when the "version valid
    // for" number matches the change counter; otherwise use the file size.
    const inHeader = dv.getUint32(28);
    const fromFile = Math.floor(fileSize / this.pageSize);
    this.pageCount = inHeader > 0 && dv.getUint32(92) === dv.getUint32(24) ? Math.min(inHeader, fromFile) : fromFile;
    const enc = dv.getUint32(56);
    this.textDecoder = new TextDecoder(enc === 2 ? 'utf-16le' : enc === 3 ? 'utf-16be' : 'utf-8');
    this.readSlice = readSlice;
    this.cacheLimit = Math.max(16, Math.floor(cacheBytes / this.pageSize));
  }

  static async open(fileSize: number, readSlice: ReadSlice, cacheBytes = 64 * 1024 * 1024): Promise<SqlitePages> {
    if (fileSize < 512) throw new Error('SQLite: file is too small to be a database.');
    const header = await readSlice(0, 100);
    if (new TextDecoder('latin1').decode(header.subarray(0, 16)) !== HEADER_MAGIC) {
      throw new Error('SQLite: file does not start with the SQLite header.');
    }
    const db = new SqlitePages(header, fileSize, readSlice, cacheBytes);
    db.bytesRead = header.length;
    return db;
  }

  private checkPage(n: number) {
    if (!Number.isInteger(n) || n < 1 || n > this.pageCount) {
      throw new Error(`SQLite: page ${n} is outside the ${this.pageCount}-page file (corrupt database?).`);
    }
  }

  private remember(n: number, page: Uint8Array) {
    this.cache.delete(n);
    this.cache.set(n, page);
    while (this.cache.size > this.cacheLimit) this.cache.delete(this.cache.keys().next().value!);
  }

  /** Fetch pages first..first+count-1 in one read, caching each. */
  async fetchRun(first: number, count: number): Promise<void> {
    const last = Math.min(this.pageCount, first + count - 1);
    this.checkPage(first);
    const bytes = await this.readSlice((first - 1) * this.pageSize, last * this.pageSize);
    this.bytesRead += bytes.length;
    if (bytes.length < (last - first + 1) * this.pageSize) throw new Error('SQLite: the file ended inside a page.');
    for (let n = first; n <= last; n++) {
      const o = (n - first) * this.pageSize;
      this.remember(n, bytes.subarray(o, o + this.pageSize));
    }
  }

  /**
   * Fetch many pages, merging neighbours into one read and running a few
   * reads at once. For walking every leaf of a table: their page numbers
   * are known from the level above before any of them is read.
   */
  async prefetch(pages: number[], concurrency = 6, maxRun = 64): Promise<void> {
    const want = [...new Set(pages)].filter((n) => !this.cache.has(n)).sort((a, b) => a - b);
    const runs: [number, number][] = [];
    for (const n of want) {
      this.checkPage(n);
      const run = runs[runs.length - 1];
      if (run && n === run[0] + run[1] && run[1] < maxRun) run[1]++;
      else runs.push([n, 1]);
    }
    let next = 0;
    const worker = async () => {
      while (next < runs.length) {
        const [first, count] = runs[next++];
        await this.fetchRun(first, count);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, runs.length) }, worker));
  }

  async page(n: number): Promise<Uint8Array> {
    this.checkPage(n);
    const hit = this.cache.get(n);
    if (hit) {
      this.remember(n, hit);
      return hit;
    }
    await this.fetchRun(n, 1);
    return this.cache.get(n)!;
  }

  /** Header fields of a b-tree page. */
  private btree(n: number, p: Uint8Array) {
    const h = n === 1 ? 100 : 0;
    const type = p[h];
    if (type !== 5 && type !== 13 && type !== 2 && type !== 10) {
      throw new Error(`SQLite: page ${n} is not a b-tree page (type ${type}).`);
    }
    const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
    const cells = dv.getUint16(h + 3);
    const interior = type === 5 || type === 2;
    const ptrs = h + (interior ? 12 : 8);
    if (ptrs + cells * 2 > this.usable) throw new Error(`SQLite: page ${n} claims more cells than fit.`);
    return { type, cells, dv, ptrs, rightmost: interior ? dv.getUint32(h + 8) : 0 };
  }

  /** Child pages of an interior table page, in key order. */
  async children(n: number): Promise<number[]> {
    const p = await this.page(n);
    const { type, cells, dv, ptrs, rightmost } = this.btree(n, p);
    if (type !== 5) return [];
    const out: number[] = [];
    for (let i = 0; i < cells; i++) out.push(dv.getUint32(dv.getUint16(ptrs + i * 2)));
    out.push(rightmost);
    return out;
  }

  /** Bytes of a table-leaf payload stored on the page itself. */
  private localSize(payload: number): number {
    const u = this.usable;
    const x = u - 35;
    if (payload <= x) return payload;
    const m = Math.floor(((u - 12) * 32) / 255) - 23;
    const k = m + ((payload - m) % (u - 4));
    return k <= x ? k : m;
  }

  /**
   * Parse every cell of a table leaf page (record headers only), plus the
   * values of the `pick` columns, which are decoded straight from the page
   * when stored there (the common case for small columns).
   */
  async leafRows(n: number, pick?: number[], table?: SqliteTable): Promise<Row[]> {
    const p = await this.page(n);
    const { type, cells, dv, ptrs } = this.btree(n, p);
    if (type !== 13) return [];
    const rows: Row[] = [];
    for (let i = 0; i < cells; i++) {
      const at = dv.getUint16(ptrs + i * 2);
      rows.push(await this.parseCell(n, i, p, at, pick, table));
    }
    return rows;
  }

  private decode(t: number, bytes: Uint8Array): SqlValue {
    if (t === 0) return null;
    if (t === 8) return 0;
    if (t === 9) return 1;
    if (t >= 12) return t % 2 === 0 ? bytes : this.textDecoder.decode(bytes);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (t === 7) return dv.getFloat64(0);
    if (t === 6) return dv.getBigInt64(0);
    if (t === 5) return dv.getInt16(0) * 2 ** 32 + dv.getUint32(2);
    if (t === 3) return (dv.getInt8(0) << 16) | dv.getUint16(1);
    return t === 1 ? dv.getInt8(0) : t === 2 ? dv.getInt16(0) : dv.getInt32(0);
  }

  private async parseCell(
    n: number,
    cell: number,
    p: Uint8Array,
    at: number,
    pick?: number[],
    table?: SqliteTable,
  ): Promise<Row> {
    if (at >= this.usable) throw new Error(`SQLite: cell ${cell} of page ${n} starts past the page.`);
    const [payloadSize, l1] = readVarint(p, at);
    const [rowid, l2] = readVarint(p, at + l1);
    const start = at + l1 + l2;
    const local = this.localSize(payloadSize);
    // The record header is nearly always local; read through overflow if not.
    let head = p.subarray(start, start + local);
    const [headerSize] = readVarint(head, 0);
    if (headerSize > head.length) head = await this.payload({ page: n, cell }, 0, headerSize);
    const types: number[] = [];
    const offsets: number[] = [];
    let o = readVarint(head, 0)[1];
    let value = headerSize;
    while (o < headerSize) {
      const [t, len] = readVarint(head, o);
      o += len;
      types.push(t);
      offsets.push(value);
      value += serialSize(t);
    }
    if (value !== payloadSize) throw new Error(`SQLite: record on page ${n} does not match its payload size.`);
    const row: Row = { rowid, location: { page: n, cell }, types, offsets, payloadSize };
    if (pick) {
      row.picked = [];
      for (const i of pick) {
        const size = i < types.length ? serialSize(types[i]) : 0;
        if (table && i === table.rowidColumn) row.picked.push(rowid);
        else if (i >= types.length) row.picked.push(null);
        else if (offsets[i] + size <= local) row.picked.push(this.decode(types[i], p.subarray(start + offsets[i], start + offsets[i] + size)));
        else row.picked.push(await this.value(row, i, table));
      }
    }
    return row;
  }

  /** Re-read the row at a known location. */
  async rowAt(loc: RowLocation): Promise<Row> {
    const p = await this.page(loc.page);
    const { cells, dv, ptrs } = this.btree(loc.page, p);
    if (loc.cell >= cells) throw new Error(`SQLite: page ${loc.page} has no cell ${loc.cell}.`);
    return this.parseCell(loc.page, loc.cell, p, dv.getUint16(ptrs + loc.cell * 2));
  }

  /**
   * Bytes [from, from + length) of a row's payload, following the overflow
   * chain as needed. Overflow pages are usually consecutive, so the whole
   * expected run is fetched in one read and the chain then checked page by page.
   */
  async payload(loc: RowLocation, from: number, length: number): Promise<Uint8Array> {
    const p = await this.page(loc.page);
    const { dv, ptrs } = this.btree(loc.page, p);
    const at = dv.getUint16(ptrs + loc.cell * 2);
    const [payloadSize, l1] = readVarint(p, at);
    const [, l2] = readVarint(p, at + l1);
    const start = at + l1 + l2;
    const local = this.localSize(payloadSize);
    const end = Math.min(payloadSize, from + length);
    const out = new Uint8Array(Math.max(0, end - from));
    let filled = 0;
    if (from < local) {
      const take = p.subarray(start + from, start + Math.min(local, end));
      out.set(take, 0);
      filled = take.length;
    }
    if (from + filled >= end) return out;

    const chunk = this.usable - 4;
    let next = new DataView(p.buffer, p.byteOffset + start + local, 4).getUint32(0);
    let pos = local; // payload offset at the start of the current overflow page
    let guard = Math.ceil((payloadSize - local) / chunk) + 1;
    while (next !== 0 && pos < end) {
      if (guard-- <= 0) throw new Error('SQLite: overflow chain is longer than its payload (loop?).');
      // Guess the rest of the chain is consecutive (it usually is) and read it in one go.
      if (!this.cache.has(next)) await this.fetchRun(next, Math.min(Math.ceil((end - pos) / chunk), 256));
      const op = await this.page(next);
      const pageEnd = pos + chunk;
      if (pageEnd > from) {
        const a = Math.max(from, pos) - pos;
        const b = Math.min(end, pageEnd) - pos;
        out.set(op.subarray(4 + a, 4 + b), Math.max(from, pos) - from);
        filled += b - a;
      }
      pos = pageEnd;
      next = new DataView(op.buffer, op.byteOffset, 4).getUint32(0);
    }
    if (filled < out.length) throw new Error('SQLite: overflow chain ended before the payload did.');
    return out;
  }

  /** Decode column `i` of a row. */
  async value(row: Row, i: number, table?: SqliteTable): Promise<SqlValue> {
    if (table && i === table.rowidColumn) return row.rowid;
    if (i >= row.types.length) return null; // added by ALTER TABLE after this row was written
    const t = row.types[i];
    const size = serialSize(t);
    return this.decode(t, size === 0 ? new Uint8Array(0) : await this.payload(row.location, row.offsets[i], size));
  }

  /** Length in bytes of a blob or text column, without reading it. */
  static valueLength(row: Row, i: number): number {
    const t = row.types[i];
    return t === undefined ? 0 : t >= 12 ? serialSize(t) : 0;
  }

  /** Every row of a table, in rowid order, fetching each tree level in merged parallel reads. */
  async scan(rootPage: number, onRows: (rows: Row[]) => void, pick?: number[], table?: SqliteTable): Promise<void> {
    let level = [rootPage];
    const seen = new Set<number>();
    // Windows smaller than the cache, so prefetched pages are still there when read.
    const window = Math.max(1, Math.floor(this.cacheLimit / 2));
    while (level.length > 0) {
      const next: number[] = [];
      for (let w = 0; w < level.length; w += window) {
        const slice = level.slice(w, w + window);
        await this.prefetch(slice);
        for (const n of slice) {
        if (seen.has(n)) throw new Error(`SQLite: page ${n} appears twice in one table (corrupt database?).`);
        seen.add(n);
        const p = await this.page(n);
        const { type } = this.btree(n, p);
        if (type === 5) next.push(...(await this.children(n)));
        else if (type === 13) onRows(await this.leafRows(n, pick, table));
        else throw new Error(`SQLite: page ${n} is an index page inside a table.`);
        }
      }
      level = next;
    }
  }

  /** Tables from `sqlite_schema` (page 1). */
  async tables(): Promise<Map<string, SqliteTable>> {
    const out = new Map<string, SqliteTable>();
    const rows: Row[] = [];
    await this.scan(1, (r) => rows.push(...r));
    for (const row of rows) {
      const [type, name, , rootPage, sql] = await Promise.all([0, 1, 2, 3, 4].map((i) => this.value(row, i)));
      if (type !== 'table' || typeof name !== 'string' || typeof sql !== 'string') continue;
      const { columns, rowidColumn } = parseColumns(sql);
      out.set(name, { name, rootPage: Number(rootPage), columns, rowidColumn });
    }
    return out;
  }
}
