/**
 * `BagSource` — a uniform abstraction over local `File` handles and remote
 * HTTP URLs, so every parser can read bytes from either without caring how
 * the bytes got there.
 *
 * Both MCAP and ROS1 already do range reads internally — they only need
 * "give me bytes at offset+length". Wrapping a URL with an HTTP-Range-using
 * reader gives us URL loading nearly for free: only the chunks the user
 * actually scrubs through ever hit the network.
 *
 * `.db3` is the exception: sql.js needs the whole file in memory. For URL
 * sources we eager-fetch via a single GET (sql.js-httpvfs would do real
 * partial reads via a custom SQLite VFS but adds ~70 KB plus a non-trivial
 * amount of glue — deferred until someone hits the practical cap of
 * ~250 MB on a `.db3`).
 *
 * The `BagSource` discriminator is what flows through every parser API
 * (and through structured-clone across the worker boundary — both `File`
 * and plain `{ url, contentLength }` clone fine).
 */

// NOTE: This module is imported on the main thread (via `bagStore` →
// `parsers/index.ts`). Keep its imports tight — only types and pure-JS HTTP
// glue. The MCAP and rosbag adapter classes (BlobReadable / BlobReader)
// live in `mcap.ts` and `bag.ts` so they stay isolated to the worker chunk.
import type { IReadable } from '@mcap/core';
import type { Filelike } from '@foxglove/rosbag';

export type BagSource =
  | { kind: 'file'; file: File }
  | {
      kind: 'url';
      url: string;
      /** Total content size in bytes. Resolved once via HEAD before parsing. */
      contentLength: number;
      /**
       * Display name extracted from the URL path (e.g. `tour.mcap` for
       * `https://example.com/datasets/tour.mcap`). Falls back to the host
       * when the path has no usable basename. Used for the parser cache key
       * and the toolbar's "filename" display so URL bags look like file
       * bags everywhere downstream.
       */
      displayName: string;
    };

/** Stable per-source cache key — file (name + size) or URL string. */
export function sourceKey(source: BagSource): string {
  if (source.kind === 'file') return `file:${source.file.name}:${source.file.size}`;
  return `url:${source.url}`;
}

export function sourceDisplayName(source: BagSource): string {
  return source.kind === 'file' ? source.file.name : source.displayName;
}

export function sourceSize(source: BagSource): number {
  return source.kind === 'file' ? source.file.size : source.contentLength;
}

/** Read the entire content of the source into a Uint8Array. */
export async function sourceReadAll(source: BagSource): Promise<Uint8Array> {
  if (source.kind === 'file') {
    const ab = await source.file.arrayBuffer();
    return new Uint8Array(ab);
  }
  // URL: single GET, no Range header. sql.js needs the whole thing anyway.
  // Errors (404, CORS, network) propagate as the caller's parse error.
  const res = await fetch(source.url, { mode: 'cors' });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch "${source.url}": HTTP ${res.status} ${res.statusText}. ` +
        'Verify the URL is reachable and the server allows cross-origin requests.',
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Read a small head slice — used by `detectFormat` to sniff magic bytes
 * before committing to a parser. Cheap on both backends (a 16-byte Range
 * request is one round-trip even on slow links).
 */
export async function sourceReadSlice(
  source: BagSource,
  start: number,
  end: number,
): Promise<Uint8Array> {
  if (source.kind === 'file') {
    const ab = await source.file.slice(start, end).arrayBuffer();
    return new Uint8Array(ab);
  }
  // URLs use HTTP Range. end is exclusive in Blob.slice; Range is inclusive,
  // so the header byte-end is end - 1.
  const res = await fetch(source.url, {
    mode: 'cors',
    headers: { Range: `bytes=${start}-${end - 1}` },
  });
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(
      `Failed to fetch range from "${source.url}": HTTP ${res.status}. ` +
        'The server may not support Range requests.',
    );
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.subarray(0, end - start);
}

/**
 * LRU cache for raw HTTP Range responses, keyed by "offset:size".
 *
 * Seeking backward in the timeline causes the MCAP IndexedReader (and the
 * rosbag Bag reader) to request the same chunk bytes repeatedly. Without
 * this cache every backward seek re-fetches the compressed chunk over the
 * network, even though the decompressed result may already be in the
 * ChunkCache in mcap.ts — the fingerprint can't be checked without the
 * bytes, and uncompressed chunks have no ChunkCache entry at all.
 *
 * Keying by (offset, size) is exact for MCAP: the IndexedReader always
 * requests each chunk at a fixed (offset, uncompressedSize) pair derived
 * from the chunk index, so cache hits are guaranteed for repeated seeks
 * into the same chunk.
 *
 * The 64 MB limit covers ~30 typical compressed chunks, enough to absorb
 * a backward scrub of ≈30 seconds in a bag with 1-second chunk granularity.
 */
const HTTP_RANGE_CACHE_MAX_BYTES = 64 * 1024 * 1024;

class HttpRangeCache {
  private readonly entries = new Map<string, Uint8Array>();
  private totalBytes = 0;
  private readonly maxBytes: number;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
  }

  get(key: string): Uint8Array | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    // LRU: move to most-recently-used end.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  set(key: string, data: Uint8Array): void {
    if (this.entries.has(key)) return;
    while (this.totalBytes + data.byteLength > this.maxBytes && this.entries.size > 0) {
      const oldest = this.entries.keys().next().value!;
      this.totalBytes -= this.entries.get(oldest)!.byteLength;
      this.entries.delete(oldest);
    }
    this.entries.set(key, data);
    this.totalBytes += data.byteLength;
  }
}

/**
 * MCAP `IReadable` over HTTP Range. Holds the size as a cached bigint so
 * the indexed reader doesn't re-fetch HEAD on every probe.
 *
 * Exported so worker-only modules can construct one without importing the
 * `BlobReadable` factory below into the main bundle.
 */
export class HttpReadable implements IReadable {
  private readonly url: string;
  private readonly sizeBytes: bigint;
  private readonly rangeCache = new HttpRangeCache(HTTP_RANGE_CACHE_MAX_BYTES);
  constructor(url: string, sizeBytes: bigint) {
    this.url = url;
    this.sizeBytes = sizeBytes;
  }
  async size(): Promise<bigint> {
    return this.sizeBytes;
  }
  async read(offset: bigint, size: bigint): Promise<Uint8Array> {
    const key = `${offset}:${size}`;
    const hit = this.rangeCache.get(key);
    if (hit) return hit;
    const data = await rangeFetch(this.url, Number(offset), Number(size));
    this.rangeCache.set(key, data);
    return data;
  }
}

/** rosbag `Filelike` over HTTP Range. Same shape, sync `size()`. */
export class HttpFilelike implements Filelike {
  private readonly url: string;
  private readonly contentLength: number;
  private readonly rangeCache = new HttpRangeCache(HTTP_RANGE_CACHE_MAX_BYTES);
  constructor(url: string, contentLength: number) {
    this.url = url;
    this.contentLength = contentLength;
  }
  size(): number {
    return this.contentLength;
  }
  async read(offset: number, length: number): Promise<Uint8Array> {
    const key = `${offset}:${length}`;
    const hit = this.rangeCache.get(key);
    if (hit) return hit;
    const data = await rangeFetch(this.url, offset, length);
    this.rangeCache.set(key, data);
    return data;
  }
}

/**
 * Issue a single HTTP Range request. Returns exactly `length` bytes (or
 * throws with a specific message on the most common failure modes).
 */
async function rangeFetch(url: string, offset: number, length: number): Promise<Uint8Array> {
  const end = offset + length - 1;
  let res: Response;
  try {
    res = await fetch(url, {
      mode: 'cors',
      headers: { Range: `bytes=${offset}-${end}` },
    });
  } catch (err) {
    // CORS rejections surface as a TypeError without status info — relay
    // something actionable instead of `TypeError: Failed to fetch`.
    throw new Error(
      `Could not fetch from "${url}": ${err instanceof Error ? err.message : String(err)}. ` +
        'This often means the remote server does not allow cross-origin requests. ' +
        'Try a CORS-enabled mirror, or download the file and drag it in.',
      { cause: err },
    );
  }
  if (res.status === 416) {
    throw new Error(
      `Server returned 416 Range Not Satisfiable for "${url}" (bytes=${offset}-${end}). ` +
        'The bag may be truncated or the wrong content length was advertised.',
    );
  }
  if (res.status !== 206) {
    // Some hosts ignore Range and return 200 + the full body. That works
    // but defeats the point of streaming, so flag it once. Subsequent reads
    // will refetch the entire body each time, which is brutally slow for a
    // multi-GB bag — give the user a way to understand the symptom.
    if (res.status === 200) {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length === length) return buf;
      if (offset === 0 && length <= buf.length) return buf.subarray(0, length);
      return buf.subarray(offset, offset + length);
    }
    throw new Error(
      `Server returned ${res.status} for range request to "${url}". ` +
        'Expected 206 Partial Content. The host may not support HTTP Range.',
    );
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Resolve a URL into a fully-formed `BagSource` (running the HEAD request
 * once so downstream Filelike consumers can read `size()` synchronously).
 *
 * Throws with specific messages for the failure modes we can detect, since
 * a clear error is the whole UX here — "URL loading is broken" with no
 * context is the worst outcome.
 */
export async function createUrlSource(url: string): Promise<BagSource> {
  let head: Response;
  try {
    head = await fetch(url, { method: 'HEAD', mode: 'cors' });
  } catch (err) {
    throw new Error(
      `Could not reach "${url}": ${err instanceof Error ? err.message : String(err)}. ` +
        'The server may not allow cross-origin requests. ' +
        'Try a CORS-enabled mirror, or download the file and drag it in.',
      { cause: err },
    );
  }
  if (!head.ok) {
    throw new Error(`HEAD ${url} returned HTTP ${head.status} ${head.statusText}.`);
  }
  const lenHeader = head.headers.get('content-length');
  if (!lenHeader) {
    throw new Error(
      `BAGEL needs the server to expose Content-Length for "${url}", but the HEAD ` +
        'response didn\'t include it. Try a host that supports it (S3 / GitHub releases / your own server).',
    );
  }
  const contentLength = Number(lenHeader);
  if (!Number.isFinite(contentLength) || contentLength <= 0) {
    throw new Error(`Server reported invalid Content-Length "${lenHeader}" for "${url}".`);
  }
  // Range support — if absent, we can still fall back to reading the whole
  // body, but warn loudly via the error path so the user knows performance
  // will tank on a multi-GB bag.
  const acceptRanges = head.headers.get('accept-ranges');
  if (acceptRanges && acceptRanges.toLowerCase() === 'none') {
    throw new Error(
      `Server for "${url}" advertises Accept-Ranges: none — BAGEL can't stream ` +
        'this bag in chunks. Choose a host that supports HTTP Range, or download ' +
        'and drag the file in.',
    );
  }
  return {
    kind: 'url',
    url,
    contentLength,
    displayName: extractDisplayName(url),
  };
}

function extractDisplayName(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter((s) => s.length > 0);
    const last = segments[segments.length - 1] ?? '';
    // Strip query string if it leaked in (URL pathname shouldn't include it,
    // but content-disposition-style URLs sometimes do).
    return last.split('?')[0] || parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Build a file-backed `BagSource` — the call-site for the existing
 * drag-and-drop / file-picker flow. Convenience so consumers don't have to
 * type the discriminator literal everywhere.
 */
export function createFileSource(file: File): BagSource {
  return { kind: 'file', file };
}
