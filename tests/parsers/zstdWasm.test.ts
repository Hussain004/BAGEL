/**
 * Tests for the WASM zstd decompression wrapper (zstdWasm.ts).
 *
 * Exercises the two real-world failure modes that broke on actual bags
 * after the fzstd -> zstd-wasm swap:
 *  - zstd frames without an embedded content-size header (v1.6.5).
 *  - a `decompressedSize` hint (MCAP's chunk-record `uncompressed_size`)
 *    that doesn't match the real decompressed length, in both directions
 *    (v1.6.6) - some real bags carry an inaccurate value here, and the old
 *    `fzstd` decoder never broke on them because it measures the real
 *    output length instead of trusting any hint.
 */

import { zstdCompressSync, constants } from 'node:zlib';
import { describe, it, expect, beforeAll } from 'vitest';
import { ensureZstdWasmReady, decompressZstdWasm } from '../../src/parsers/zstdWasm';

beforeAll(() => ensureZstdWasmReady());

function payload(byteLength: number): Buffer {
  const buf = Buffer.alloc(byteLength);
  for (let i = 0; i < byteLength; i++) buf[i] = (i * 37 + 11) & 0xff;
  return buf;
}

describe('zstdWasm/decompressZstdWasm', () => {
  it('decompresses correctly when the size hint matches exactly', () => {
    const raw = payload(50_000);
    const compressed = zstdCompressSync(raw);
    const out = decompressZstdWasm(new Uint8Array(compressed), BigInt(raw.length));
    expect(Buffer.compare(Buffer.from(out), raw)).toBe(0);
  });

  it('decompresses correctly when the frame omits the content-size header', () => {
    const raw = payload(50_000);
    const compressed = zstdCompressSync(raw, {
      params: { [constants.ZSTD_c_contentSizeFlag]: 0 },
    });
    const out = decompressZstdWasm(new Uint8Array(compressed), BigInt(raw.length));
    expect(Buffer.compare(Buffer.from(out), raw)).toBe(0);
  });

  it('decompresses correctly when the size hint is smaller than the real output (must grow)', () => {
    const raw = payload(200_000);
    const compressed = zstdCompressSync(raw);
    // Deliberately-wrong, far too small hint - simulates a bag whose
    // chunk-record uncompressed_size understates the real content.
    const out = decompressZstdWasm(new Uint8Array(compressed), 10n);
    expect(out.length).toBe(raw.length);
    expect(Buffer.compare(Buffer.from(out), raw)).toBe(0);
  });

  it('decompresses correctly when the size hint is larger than the real output (must trim)', () => {
    const raw = payload(50_000);
    const compressed = zstdCompressSync(raw);
    // Deliberately-wrong, far too large hint.
    const out = decompressZstdWasm(new Uint8Array(compressed), 10_000_000n);
    expect(out.length).toBe(raw.length);
    expect(Buffer.compare(Buffer.from(out), raw)).toBe(0);
  });

  it('decompresses correctly when the size hint is zero', () => {
    const raw = payload(50_000);
    const compressed = zstdCompressSync(raw);
    const out = decompressZstdWasm(new Uint8Array(compressed), 0n);
    expect(out.length).toBe(raw.length);
    expect(Buffer.compare(Buffer.from(out), raw)).toBe(0);
  });

  it('handles a size hint mismatch combined with no embedded content-size header', () => {
    const raw = payload(200_000);
    const compressed = zstdCompressSync(raw, {
      params: { [constants.ZSTD_c_contentSizeFlag]: 0 },
    });
    const out = decompressZstdWasm(new Uint8Array(compressed), 1n);
    expect(out.length).toBe(raw.length);
    expect(Buffer.compare(Buffer.from(out), raw)).toBe(0);
  });
});
