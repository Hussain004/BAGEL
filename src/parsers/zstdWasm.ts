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
export function decompressZstdWasm(buffer: Uint8Array): Uint8Array {
  if (!decompressor) {
    throw new Error('decompressZstdWasm() called before ensureZstdWasmReady() resolved.');
  }
  return decompressor.decompress(buffer);
}
