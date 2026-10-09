/**
 * Reused-decoder stress test for MCAP chunk decompression.
 *
 * The decompressor is shared module state: every chunk of every bag goes
 * through the same zstd decoder for the life of the page. A decoder that
 * corrupts output after many varied calls (the v1.6.4-1.6.6 zstd-wasm failure)
 * passes a few one-shot tests, so this pushes hundreds of sequential reads of
 * differently shaped chunks through it and compares every message against an
 * uncompressed copy of the same data.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { parseBag, readDeserializedMessages, disposeParserCaches } from '../../src/parsers/core';
import { createFileSource } from '../../src/parsers/source';
import { bytesToFile, writeSyntheticMcap } from '../fixtures/synth';

/** xorshift32, so every run sees the same "random" data. */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

type Shape = 'repeat' | 'noise' | 'text' | 'tiny' | 'big';

function payload(shape: Shape, rand: () => number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz0123456789 ';
  const pick = () => letters[Math.floor(rand() * letters.length)]!;
  switch (shape) {
    case 'repeat':
      return 'abc'.repeat(200 + Math.floor(rand() * 4000));
    case 'noise':
      return Array.from({ length: 500 + Math.floor(rand() * 6000) }, pick).join('');
    case 'text':
      return Array.from({ length: 80 + Math.floor(rand() * 400) }, () => ['robot', 'lidar', 'scan', 'odom', 'tf'][Math.floor(rand() * 5)]).join(' ');
    case 'tiny':
      return pick();
    case 'big':
      return Array.from({ length: 60000 }, pick).join('');
  }
}

const SHAPES: Shape[] = ['repeat', 'noise', 'text', 'tiny', 'big'];

function messagesFor(seed: number, count: number, shape: Shape) {
  const rand = rng(seed);
  return Array.from({ length: count }, (_, i) => ({
    logTime: 1_000_000_000n + BigInt(i) * 10_000_000n,
    value: { data: payload(shape, rand) },
  }));
}

describe('mcap zstd: one decoder, many differently shaped chunks', () => {
  beforeEach(() => disposeParserCaches());

  it('returns exactly what was written across hundreds of sequential reads', async () => {
    let reads = 0;
    for (let variant = 0; variant < 40; variant++) {
      const shape = SHAPES[variant % SHAPES.length]!;
      const count = 1 + ((variant * 7) % 23);
      const messages = messagesFor(variant + 1, count, shape);
      const topic = [{ topic: '/data', type: 'std_msgs/msg/String', messages }];
      const compressed = await writeSyntheticMcap(topic, {
        compress: true,
        // Real writers differ on whether the frame header records the content size.
        compressOmitContentSize: variant % 3 === 0,
      });
      const source = createFileSource(bytesToFile(compressed, `v${variant}.mcap`));

      // Several full reads of the same bag, and a re-parse, all on the shared decoder.
      for (let pass = 0; pass < 8; pass++) {
        if (pass === 4) disposeParserCaches(); // force a fresh decompress, not a cache hit
        const summary = await parseBag(source);
        const read = await readDeserializedMessages(source, summary.format, '/data', count + 5);
        expect(read, `variant ${variant} (${shape}, ${count} msgs) pass ${pass}`).toHaveLength(count);
        for (let i = 0; i < count; i++) {
          expect((read[i]!.value as { data: string }).data === messages[i]!.value.data, `variant ${variant} msg ${i} pass ${pass}`).toBe(true);
        }
        reads++;
      }
    }
    expect(reads).toBe(320);
  }, 120_000);

  it('interleaves bags: reading A, then B, then A again still gives A', async () => {
    const make = async (seed: number, shape: Shape) => {
      const messages = messagesFor(seed, 6, shape);
      const bytes = await writeSyntheticMcap([{ topic: '/data', type: 'std_msgs/msg/String', messages }], { compress: true });
      return { messages, source: createFileSource(bytesToFile(bytes, `i${seed}.mcap`)) };
    };
    const a = await make(101, 'noise');
    const b = await make(202, 'repeat');
    for (let round = 0; round < 25; round++) {
      for (const bag of [a, b, a]) {
        const read = await readDeserializedMessages(bag.source, 'mcap', '/data', 20);
        expect(read.map((m) => (m.value as { data: string }).data)).toEqual(bag.messages.map((m) => m.value.data));
      }
    }
  }, 60_000);
});
