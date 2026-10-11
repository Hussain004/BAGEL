// @vitest-environment jsdom
/**
 * lz4 chunks: what BAGEL's editor now writes, and what other MCAP writers
 * produce with lz4 compression.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as lz4 from 'lz4js';
import { compressChunkLz4 } from '../../src/parsers/chunkCompression';
import { editMcapBag } from '../../src/parsers/edit';
import { disposeMcapCache, loadMcapForEdit, parseMcap, readDeserializedMessagesMcap, readRawMessagesMcap } from '../../src/parsers/mcap';
import { createFileSource } from '../../src/parsers/source';

afterEach(() => disposeMcapCache());

const file = (bytes: Uint8Array, name: string) => createFileSource(new File([new Uint8Array(bytes)], name));

describe('reading an MCAP that another writer compressed with lz4', () => {
  // Written by the official Python `mcap` writer; see fixtures/golden/make_lz4_mcap.py.
  const source = () => file(readFileSync(join(__dirname, '../fixtures/golden/lz4-chunks.mcap')), 'lz4-chunks.mcap');

  it('lists the topics and decodes every message across its 14 lz4 chunks', async () => {
    const summary = await parseMcap(source());
    expect(summary.topics.map((t) => [t.name, t.messageCount]).sort()).toEqual([['/blob', 100], ['/counter', 300]]);
    const counter = await readDeserializedMessagesMcap(source(), '/counter');
    expect(counter.map((m) => (m.value as { i: number }).i)).toEqual(Array.from({ length: 300 }, (_, i) => i));
    expect((counter[13]!.value as { label: string }).label).toBe('tick '.repeat(6));
    const blob = await readDeserializedMessagesMcap(source(), '/blob');
    expect(blob.map((m) => (m.value as { i: number }).i)).toEqual(Array.from({ length: 100 }, (_, i) => i * 3));
  });
});

describe('compressChunkLz4', () => {
  it('round-trips thousands of varied chunks through the same reused encoder and decoder', () => {
    let x = 99;
    const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const sizes = [0, 1, 3, 15, 16, 4096, 65535, 65536, 65537, 262144, 300001];
    let stored = 0;
    for (let n = 0; n < 1500; n++) {
      const size = n < sizes.length * 6 ? sizes[n % sizes.length]! : Math.floor(rnd() * 120_000);
      const kind = n % 6;
      const raw = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        raw[i] =
          kind === 0 ? 0
          : kind === 1 ? (i * 7) & 0x3f
          : kind === 2 ? Math.floor(rnd() * 256) // noise: does not shrink
          : kind === 3 ? 'lidar_link '.charCodeAt(i % 11)
          : kind === 4 ? ((i >> 5) + (rnd() < 0.05 ? 1 : 0)) & 0xff // sensor-ish, mostly smooth
          : (i % 16) < 4 ? Math.floor(rnd() * 256) : i & 0xff; // float-like records
      }
      const { compression, compressedData } = compressChunkLz4(raw);
      if (compression === '') {
        stored++;
        expect(compressedData).toBe(raw);
        continue;
      }
      expect(compression).toBe('lz4');
      expect(compressedData.length).toBeLessThan(raw.length);
      const back = lz4.decompress(compressedData, raw.length);
      expect(back.length).toBe(raw.length);
      expect(Buffer.compare(Buffer.from(back), Buffer.from(raw))).toBe(0);
    }
    // The tiniest chunks (and any that do not shrink) are stored as they are rather than grown.
    expect(stored).toBeGreaterThan(sizes.length);
  });
});

describe('the bag editor writes lz4 chunks', () => {
  const SAMPLE = join(__dirname, '../../public/sample-bags/tour.mcap');
  const sample = () => file(readFileSync(SAMPLE), 'tour.mcap');

  it('a trimmed sample is compressed, smaller than its uncompressed chunks, and holds exactly the same messages', async () => {
    const summary = await parseMcap(sample());
    const startNs = summary.startTime + 10_000_000_000n;
    const endNs = summary.startTime + 15_000_000_000n;
    disposeMcapCache();
    const result = await editMcapBag(sample(), { startNs, endNs });

    disposeMcapCache();
    const out = file(result.bytes, 'tour.trim.mcap');
    const { reader } = await loadMcapForEdit(out);
    const chunks = reader!.chunkIndexes;
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((c) => c.compression === 'lz4')).toBe(true);
    const compressed = chunks.reduce((n, c) => n + Number(c.compressedSize), 0);
    const uncompressed = chunks.reduce((n, c) => n + Number(c.uncompressedSize), 0);
    expect(compressed).toBeLessThan(uncompressed * 0.6);

    // Byte-for-byte the same messages as the source's window, on a heavy topic and a light one.
    for (const topic of ['/camera/image_raw', '/lidar/points', '/odom', '/camera/annotations']) {
      disposeMcapCache();
      const want = (await readRawMessagesMcap(sample(), topic)).filter((m) => m.timestamp >= startNs && m.timestamp <= endNs);
      disposeMcapCache();
      const got = await readRawMessagesMcap(file(result.bytes, 'tour.trim.mcap'), topic);
      expect(got.length, topic).toBe(want.length);
      expect(got.length, topic).toBeGreaterThan(0);
      for (let i = 0; i < got.length; i++) {
        expect(got[i]!.timestamp).toBe(want[i]!.timestamp);
        expect(Buffer.compare(Buffer.from(got[i]!.data), Buffer.from(want[i]!.data))).toBe(0);
      }
    }
  });
});
