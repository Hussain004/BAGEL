/**
 * Stress test for the WASM zstd encoder behind edit output (#121), held to
 * the bar AGENTS.md sets after the v1.6.7 zstd-wasm revert: many varied
 * sequential calls on one reused instance, checked against an independent
 * decoder (Node's own libzstd), a heap that must stop growing, and a proven
 * fallback when the encoder misbehaves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zstdDecompressSync } from 'node:zlib';

function chunk(n: number, size: number, rnd: () => number): Uint8Array {
  const raw = new Uint8Array(size);
  const kind = n % 7;
  for (let i = 0; i < size; i++) {
    raw[i] =
      kind === 0 ? 0
      : kind === 1 ? (i * 7) & 0x3f
      : kind === 2 ? Math.floor(rnd() * 256) // noise: does not shrink
      : kind === 3 ? 'base_link odom '.charCodeAt(i % 15)
      : kind === 4 ? ((i >> 5) + (rnd() < 0.05 ? 1 : 0)) & 0xff
      : kind === 5 ? (i % 16 < 4 ? Math.floor(rnd() * 256) : i & 0xff)
      : (i * i) >> 3; // long-period pattern
  }
  return raw;
}

describe('verified zstd chunk compressor', () => {
  beforeEach(async () => (await import('../../src/parsers/chunkCompression'))._resetZstdForTests());

  it('round-trips 2,000 varied chunks through one reused WASM instance, checked by libzstd', async () => {
    const { chunkCompressor, zstdDisabledReason } = await import('../../src/parsers/chunkCompression');
    const compress = await chunkCompressor();
    let x = 7;
    const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const edges = [0, 1, 2, 3, 15, 16, 127, 128, 4095, 4096, 65535, 65536, 65537, 131072, 1 << 20, (1 << 20) + 1];
    const seen = new Set<string>();
    for (let n = 0; n < 2000; n++) {
      const size = n < edges.length * 7 ? edges[n % edges.length]! : Math.floor(rnd() * rnd() * 600_000);
      const raw = chunk(n, size, rnd);
      const { compression, compressedData } = compress(raw);
      seen.add(compression);
      if (compression === '') {
        expect(compressedData).toBe(raw);
        continue;
      }
      expect(compression).toBe('zstd');
      expect(compressedData.length).toBeLessThan(raw.length);
      expect(Buffer.from(zstdDecompressSync(compressedData)).equals(Buffer.from(raw))).toBe(true);
    }
    expect([...seen].sort()).toEqual(['', 'zstd']);
    expect(zstdDisabledReason).toBeNull();
  }, 120_000);

  it('a 24 MB chunk survives too', async () => {
    const { chunkCompressor } = await import('../../src/parsers/chunkCompression');
    const raw = new Uint8Array(24 << 20).map((_, i) => (i >> 9) & 0xff);
    const out = (await chunkCompressor())(raw);
    expect(out.compression).toBe('zstd');
    expect(Buffer.from(zstdDecompressSync(out.compressedData)).equals(Buffer.from(raw))).toBe(true);
  });

  it('does not leak: the WASM heap stops growing over thousands of calls', async () => {
    const { chunkCompressor } = await import('../../src/parsers/chunkCompression');
    const { Zstd } = await import('@hpcc-js/wasm-zstd');
    const heap = async () => ((await Zstd.load()) as unknown as { _mainModule: { _module: { HEAPU8: Uint8Array } } })._mainModule._module.HEAPU8.buffer.byteLength;
    const compress = await chunkCompressor();
    let x = 3;
    const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    // Warm up at the largest size used below, so the heap reaches its working size.
    for (let n = 0; n < 20; n++) compress(chunk(n, 1 << 20, rnd));
    const warm = await heap();
    for (let n = 0; n < 2500; n++) compress(chunk(n, Math.floor(rnd() * (1 << 20)), rnd));
    expect(await heap()).toBe(warm);
  }, 180_000);
});

describe('when the WASM encoder misbehaves', () => {
  afterEach(() => {
    vi.doUnmock('@hpcc-js/wasm-zstd');
    vi.resetModules();
  });

  it('a chunk that fails the round trip switches the rest of the session to lz4', async () => {
    vi.resetModules();
    let calls = 0;
    vi.doMock('@hpcc-js/wasm-zstd', async () => {
      const real = await vi.importActual<typeof import('@hpcc-js/wasm-zstd')>('@hpcc-js/wasm-zstd');
      const z = await real.Zstd.load();
      return {
        Zstd: {
          load: async () => ({
            compress: (d: Uint8Array, level?: number) => {
              const out = z.compress(d, level);
              // The third call returns a corrupt frame, as a memory-corruption bug would.
              if (++calls === 3) out[out.length >> 1] ^= 0x5a;
              return out;
            },
          }),
        },
      };
    });
    const cc = await import('../../src/parsers/chunkCompression');
    const compress = await cc.chunkCompressor();
    // Text-like data, so the frame is real entropy-coded content, not a run.
    const raw = new TextEncoder().encode(Array.from({ length: 4000 }, (_, i) => `frame ${i} x=${(i * 37) % 1000}`).join(' '));
    expect(compress(raw).compression).toBe('zstd');
    expect(compress(raw).compression).toBe('zstd');
    expect(compress(raw).compression).toBe('lz4'); // caught, not written
    expect(cc.zstdDisabledReason).toMatch(/round trip/);
    expect(compress(raw).compression).toBe('lz4');
    expect((await cc.chunkCompressor())(raw).compression).toBe('lz4');
  });

  it('a WASM that fails to load leaves edits on lz4', async () => {
    vi.resetModules();
    vi.doMock('@hpcc-js/wasm-zstd', () => ({ Zstd: { load: () => Promise.reject(new Error('no wasm')) } }));
    const cc = await import('../../src/parsers/chunkCompression');
    expect((await cc.chunkCompressor())(new Uint8Array(10_000)).compression).toBe('lz4');
  });
});
