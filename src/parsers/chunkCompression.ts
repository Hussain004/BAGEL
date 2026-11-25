import * as lz4 from 'lz4js';
import { decompress as fzstdDecompress } from 'fzstd';

/**
 * Chunk compression for every bag BAGEL writes from an edit.
 *
 * zstd (MCAP's default, which every MCAP reader supports) comes from the
 * `@hpcc-js/wasm-zstd` WASM build, loaded only when an edit is written. That
 * makes it a WASM codec on a hot path, and v1.6.7 reverted one (zstd-wasm)
 * that corrupted memory, so every chunk it produces is decoded again by the
 * pure-JS fzstd and compared with the input before it is used. A chunk that
 * does not match, or any error from the WASM, turns zstd off for the rest of
 * the session and the editor carries on with lz4, which never needs WASM. A
 * chunk that would not shrink (already-compressed images, noise) is stored as
 * it is.
 */
export type ChunkCompressor = (chunkData: Uint8Array) => { compression: string; compressedData: Uint8Array };

export const compressChunkLz4: ChunkCompressor = (chunkData) => {
  const packed = lz4.compress(chunkData);
  return packed.length < chunkData.length
    ? { compression: 'lz4', compressedData: packed }
    : { compression: '', compressedData: chunkData };
};

interface ZstdEncoder {
  compress(data: Uint8Array, level?: number): Uint8Array;
}

const ZSTD_LEVEL = 3;
let zstdPromise: Promise<ZstdEncoder | null> | null = null;
let zstdDistrusted = false;

function loadZstd(): Promise<ZstdEncoder | null> {
  zstdPromise ??= import('@hpcc-js/wasm-zstd')
    .then(({ Zstd }) => Zstd.load())
    .catch(() => null);
  return zstdPromise;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Why zstd was turned off, if it was (for tests and diagnostics). */
export let zstdDisabledReason: string | null = null;

/** The compressor an edit should use: verified zstd when the WASM loads and has behaved, else lz4. */
export async function chunkCompressor(): Promise<ChunkCompressor> {
  const zstd = zstdDistrusted ? null : await loadZstd();
  if (!zstd) return compressChunkLz4;
  return (chunkData) => {
    if (!zstdDistrusted) {
      try {
        const packed = zstd.compress(chunkData, ZSTD_LEVEL);
        if (sameBytes(fzstdDecompress(packed), chunkData)) {
          return packed.length < chunkData.length
            ? { compression: 'zstd', compressedData: packed }
            : { compression: '', compressedData: chunkData };
        }
        zstdDisabledReason = `a ${chunkData.length}-byte chunk did not survive a zstd round trip`;
      } catch (err) {
        zstdDisabledReason = `zstd threw: ${err instanceof Error ? err.message : String(err)}`;
      }
      zstdDistrusted = true;
    }
    return compressChunkLz4(chunkData);
  };
}

/** Test hook: forget a distrust verdict so each test starts clean. */
export function _resetZstdForTests(): void {
  zstdDistrusted = false;
  zstdDisabledReason = null;
}
