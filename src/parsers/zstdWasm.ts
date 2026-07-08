/**
 * WASM zstd decompression for MCAP chunks.
 *
 * Replaces the pure-JS `fzstd` fallback. `zstd-wasm` (not the official
 * `@foxglove/wasm-zstd`) is used because it ships genuine ESM with the WASM
 * binary embedded as a base64 string, so it bundles cleanly under Vite 8's
 * Rolldown bundler; the official package's CJS `require()` form does not.
 * Measured ~3x faster decompression than `fzstd` on realistic-entropy data.
 *
 * `@mcap/core`'s `DecompressHandlers` contract requires a *synchronous*
 * function `(buffer, decompressedSize) => Uint8Array`, but WASM
 * instantiation is inherently async. `ensureZstdWasmReady()` must be
 * awaited once (per worker/module lifetime) before any read that might hit
 * a zstd chunk; after that, `decompressZstdWasm()` is a plain synchronous
 * call, matching what the MCAP reader expects.
 *
 * Uses `Decompressor.stream()` rather than the one-shot `decompress()`.
 * `decompress()` calls `ZSTD_getFrameContentSize`, which throws
 * ("[zstd] Unable to get frame content size") whenever the zstd frame
 * doesn't have its content size embedded in the header - real-world
 * encoders (streaming compression without a known total size upfront)
 * routinely produce frames like this, it's not just a theoretical case.
 * `stream()` decompresses incrementally via `ZSTD_decompressStream` and
 * doesn't need the frame to declare its size at all.
 *
 * `decompressedSize` (MCAP's chunk-record `uncompressed_size`) is used
 * only as an initial allocation hint, not trusted as authoritative - a
 * real-world bag surfaced chunks where this field didn't match the actual
 * decompressed length (`fzstd`, the decoder this replaced, never hit this
 * because it measures the real output length as it decompresses and
 * ignores any size hint that turns out to be wrong; this must too). The
 * output buffer grows if the real data exceeds the hint and is trimmed if
 * the real data is smaller.
 */

import { Decompressor } from 'zstd-wasm';

let decompressor: Decompressor | null = null;
let initPromise: Promise<void> | null = null;

export function ensureZstdWasmReady(): Promise<void> {
  if (decompressor) return Promise.resolve();
  if (!initPromise) {
    initPromise = new Decompressor().init().then((d) => {
      decompressor = d;
    });
  }
  return initPromise;
}

/** Synchronous zstd decompression. `ensureZstdWasmReady()` must have already resolved. */
export function decompressZstdWasm(buffer: Uint8Array, decompressedSize: bigint): Uint8Array {
  if (!decompressor) {
    throw new Error('decompressZstdWasm() called before ensureZstdWasmReady() resolved.');
  }
  let out = new Uint8Array(Number(decompressedSize) || 0);
  let offset = 0;
  for (const chunk of decompressor.stream(buffer)) {
    if (offset + chunk.length > out.length) {
      const grown = new Uint8Array(Math.max(out.length * 2, offset + chunk.length));
      grown.set(out.subarray(0, offset));
      out = grown;
    }
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return offset === out.length ? out : out.slice(0, offset);
}
