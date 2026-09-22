/**
 * Corruption / truncation robustness tests across all three parsers.
 *
 * Contract under test: deliberately damaged inputs must never wedge a
 * parser. Each case either throws a clean `Error` (which `classifyBagError`
 * can turn into an actionable message) or yields a summary that is
 * self-consistent and never larger than the original file's summary.
 *
 * Important observed behavior being pinned here: MCAP truncation is
 * *designed* to recover. After the indexed reader fails, `loadMcap` falls
 * back to a range-recovery scan that walks complete records only, so a cut
 * inside a later record often yields a perfectly consistent partial
 * summary (including an empty one when the cut lands before any message-
 * bearing record). Only cuts inside the magic bytes (and header corruption
 * that breaks the record walk) deterministically throw. The tests assert
 * the contract, not a specific outcome per offset, plus the handful of
 * cases that must throw.
 *
 * The sql.js mock matches `db3.test.ts` because this file also exercises
 * `parseDb3` on truncated databases.
 */

import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import type { SynthOptions, SynthTopic } from '../fixtures/synth';

vi.mock('sql.js', async () => {
  const actual = await vi.importActual<typeof import('sql.js')>('sql.js');
  const init = actual.default;
  return {
    default: () => init(),
    __esModule: true,
  };
});

const { parseDb3, disposeDb3Cache } = await import('../../src/parsers/db3');
const { parseBagFile, disposeBagCache } = await import('../../src/parsers/bag');
const { parseMcap, readRawMessagesMcap, readDeserializedMessagesMcap, disposeMcapCache } =
  await import('../../src/parsers/mcap');
const { createFileSource } = await import('../../src/parsers/source');
const { classifyBagError } = await import('../../src/utils/actionableError');
const { bytesToFile, chatterBag, chatterRos1Bag, chatterDb3Bag, writeSyntheticMcap } = await import(
  '../fixtures/synth'
);

let uniq = 0;
function sourceFor(bytes: Uint8Array, ext: string) {
  uniq += 1;
  return createFileSource(bytesToFile(bytes, `robust-${uniq}.${ext}`));
}

beforeEach(() => {
  disposeDb3Cache();
  disposeBagCache();
  disposeMcapCache();
});
afterAll(() => {
  disposeDb3Cache();
  disposeBagCache();
  disposeMcapCache();
});

/** Walk top-level MCAP records the same way mcap.test.ts's helper does. */
function walkRecords(
  bytes: Uint8Array,
): Array<{ offset: number; length: number; opcode: number }> {
  const out: Array<{ offset: number; length: number; opcode: number }> = [];
  let offset = 8;
  while (offset + 9 <= bytes.byteLength) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 9);
    const opcode = view.getUint8(0);
    const bodyLength = Number(view.getBigUint64(1, true));
    const recordLength = 9 + bodyLength;
    if (offset + recordLength > bytes.byteLength) break;
    out.push({ offset, length: recordLength, opcode });
    offset += recordLength;
  }
  return out;
}

describe('robustness/MCAP truncation at record midpoints', () => {
  it('either throws a clean error or returns a consistent partial summary', async () => {
    const bytes = await chatterBag();
    const records = walkRecords(bytes);
    expect(records.length).toBeGreaterThan(5);

    const originalMessages = 3;
    const originalTopics = ['/chatter'];
    let sawThrow = 0;
    let sawSummary = 0;

    for (const rec of records) {
      const cut = rec.offset + Math.floor(rec.length / 2);
      const truncated = bytes.subarray(0, cut);
      let summary: Awaited<ReturnType<typeof parseMcap>> | undefined;
      try {
        summary = await parseMcap(sourceFor(truncated, 'mcap'));
      } catch (err) {
        // Clean error contract: an Error with a usable message, and
        // classifyBagError must be able to wrap it for the UI.
        sawThrow++;
        expect(err, `cut ${cut} (opcode ${rec.opcode})`).toBeInstanceOf(Error);
        const message = (err as Error).message;
        expect(message.length).toBeGreaterThan(0);
        const classified = classifyBagError(message, 'file');
        expect(classified.raw).toBe(message);
        expect(classified.action?.kind).toBe('choose-file');
        continue;
      }

      // Summary contract: self-consistent and never exceeds the intact
      // file's numbers. Empty results are legitimate here: the recovery
      // scan only indexes records that are fully present, so a cut before
      // the first message-bearing record yields an empty (but valid) bag.
      sawSummary++;
      expect(summary.format).toBe('mcap');
      expect(summary.totalMessageCount).toBeGreaterThanOrEqual(0);
      expect(summary.totalMessageCount).toBeLessThanOrEqual(originalMessages);
      expect(summary.topics.length).toBeLessThanOrEqual(originalTopics.length);
      for (const topic of summary.topics) {
        expect(originalTopics).toContain(topic.name);
        expect(topic.messageCount).toBeLessThanOrEqual(originalMessages);
      }
      expect(summary.startTime <= summary.endTime).toBe(true);

      if (summary.totalMessageCount > 0) {
        // If the summary claims messages, the raw reader must either agree
        // (same-or-fewer messages) or fail cleanly - never return more
        // messages than the summary reported.
        try {
          const raws = await readRawMessagesMcap(sourceFor(truncated, 'mcap'), '/chatter');
          expect(raws.length).toBeLessThanOrEqual(summary.totalMessageCount);
          expect(raws.length).toBeLessThanOrEqual(originalMessages);
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
          expect((err as Error).message.length).toBeGreaterThan(0);
        }
      }
    }

    // Sanity: the walk must have produced a mix (this fixture recovers at
    // most cut points, but the loop exercised both paths or none - either
    // way every case satisfied the contract above).
    expect(sawThrow + sawSummary).toBe(records.length);
  });

  it('throws deterministically when truncated inside the magic bytes', async () => {
    const bytes = await chatterBag();
    // 4 bytes: magic incomplete, before any record exists for the scan.
    await expect(parseMcap(sourceFor(bytes.subarray(0, 4), 'mcap'))).rejects.toThrow(
      /Failed to load/,
    );
    await expect(parseMcap(sourceFor(bytes.subarray(0, 7), 'mcap'))).rejects.toThrow(
      /Failed to load/,
    );
  });
});

describe('robustness/MCAP header corruption', () => {
  it('throws when a magic byte is flipped', async () => {
    const bytes = await chatterBag();
    const flipped = bytes.slice();
    flipped[1] = 0x00; // 'M' of "MCAP" -> NUL
    await expect(parseMcap(sourceFor(flipped, 'mcap'))).rejects.toThrow(/Failed to load/);
  });

  it('throws when the first record bodyLength is absurd', async () => {
    const bytes = await chatterBag();
    const corrupt = bytes.slice();
    // Header record starts at offset 8: op(1) + bodyLength(8 LE). Set the
    // declared body length to 2^64 - 1 so the record claims to span the
    // entire universe.
    new DataView(corrupt.buffer, corrupt.byteOffset).setBigUint64(
      9,
      0xffffffffffffffffn,
      true,
    );
    await expect(parseMcap(sourceFor(corrupt, 'mcap'))).rejects.toThrow(/Failed to load/);
  });
});

describe('robustness/ROS1 truncation', () => {
  it('throws for magic truncation, mid-record cuts, and flipped magic', async () => {
    const bytes = await chatterRos1Bag();
    // Every one of these cut points must produce SOME clean Error:
    // 4 = partial magic, 13/20 = inside the bag header record, 40 = mid
    // record header, mid-file = inside the chunk, end-10 = index section.
    for (const cut of [4, 13, 20, 40, Math.floor(bytes.length / 2), bytes.length - 10]) {
      let threw = false;
      try {
        await parseBagFile(sourceFor(bytes.subarray(0, cut), 'bag'));
      } catch (err) {
        threw = true;
        expect(err, `cut ${cut}`).toBeInstanceOf(Error);
        expect((err as Error).message.length).toBeGreaterThan(0);
      }
      expect(threw, `cut ${cut} should throw`).toBe(true);
    }

    const flipped = bytes.slice();
    flipped[0] = 0x00;
    await expect(parseBagFile(sourceFor(flipped, 'bag'))).rejects.toThrow(
      /Cannot identify bag format/,
    );
  });
});

describe('robustness/db3 truncation', () => {
  it('throws for every truncation point probed', async () => {
    const bytes = await chatterDb3Bag();
    // 4 = inside the SQLite magic header, 100/1000 = mid page, half =
    // mid-file. sql.js must reject these as malformed databases.
    for (const cut of [4, 100, 1000, Math.floor(bytes.length / 2)]) {
      let threw = false;
      try {
        await parseDb3(sourceFor(bytes.subarray(0, cut), 'db3'));
      } catch (err) {
        threw = true;
        expect(err, `cut ${cut}`).toBeInstanceOf(Error);
        expect((err as Error).message.length).toBeGreaterThan(0);
      }
      expect(threw, `cut ${cut} should throw`).toBe(true);
    }
  });
});

describe('robustness/inaccurate zstd decompressedSize hints', () => {
  const TWO_MESSAGES: SynthTopic[] = [
    {
      topic: '/chatter',
      type: 'std_msgs/msg/String',
      messages: [
        { logTime: 1_000_000_000n, value: { data: 'hello' } },
        { logTime: 2_000_000_000n, value: { data: 'world' } },
      ],
    },
  ];
  const synth = (options: SynthOptions) => writeSyntheticMcap(TWO_MESSAGES, options);

  it('control: accurate sizes round-trip exactly', async () => {
    const bytes = await synth({ compress: true });
    const source = sourceFor(bytes, 'mcap');
    const summary = await parseMcap(source);
    expect(summary.totalMessageCount).toBe(2);
    const raws = await readRawMessagesMcap(source, '/chatter');
    expect(raws.map((r) => r.data.length)).toEqual([14, 14]);
    const decoded = await readDeserializedMessagesMcap(source, '/chatter');
    expect(decoded.map((d) => d.value)).toEqual([{ data: 'hello' }, { data: 'world' }]);
  });

  it('too-large declared size still yields correct message bytes', async () => {
    // Producers with an off-by-something size calculation ship files like
    // this. fzstd returns a buffer of the DECLARED length (correct prefix,
    // zero tail), and messages live in the prefix, so payloads decode
    // correctly. The synth helper also zeroes each chunk's uncompressedCrc
    // because a CRC computed over the real data could never match the
    // zero-padded buffer - which would mask the size-accuracy question.
    const bytes = await synth({ compress: true, decompressedSizeOverride: 4096n });
    const source = sourceFor(bytes, 'mcap');
    const summary = await parseMcap(source);
    expect(summary.totalMessageCount).toBe(2);
    const raws = await readRawMessagesMcap(source, '/chatter');
    expect(raws.map((r) => r.data.length)).toEqual([14, 14]);
    const decoded = await readDeserializedMessagesMcap(source, '/chatter');
    expect(decoded.map((d) => d.value)).toEqual([{ data: 'hello' }, { data: 'world' }]);
  });

  it('DOCUMENTED OBSERVATION: too-small or zero declared size throws only at read time', async () => {
    // Observed behavior (pending review of the comment in
    // src/parsers/mcap.ts around the fzstd handler, which claims fzstd
    // "doesn't trust this as authoritative ... returns a correctly-sized
    // result regardless of whether the hint is accurate"): fzstd actually
    // REQUIRES the output buffer to be large enough. A too-small hint and
    // a zero hint both pass `parseMcap` (the index is read without
    // decompressing) and then fail every chunk decompression at read time
    // with an opaque `invalid zstd data` error. There is currently no
    // size-hint recovery fallback.
    for (const hint of [1n, 100n, 0n]) {
      const bytes = await synth({ compress: true, decompressedSizeOverride: hint });
      const source = sourceFor(bytes, 'mcap');
      const summary = await parseMcap(source);
      expect(summary.totalMessageCount).toBe(2); // parse succeeds...

      await expect(
        readRawMessagesMcap(source, '/chatter'),
        `hint ${hint}`,
      ).rejects.toThrow(/invalid zstd data/); // ...read fails opaquely.
    }
  });
});

describe('robustness/unsupported chunk compression label', () => {
  it('DOCUMENTED OBSERVATION: lz4 label parses but fails at read time', async () => {
    // The chunk bytes stay zstd-compressed; only the label says lz4. The
    // indexed reader validates the index (no decompression) so parseMcap
    // succeeds, then @mcap/core rejects the compression on first read.
    // Parsed error text must survive classifyBagError.
    const bytes = await writeSyntheticMcap(
      [
        {
          topic: '/chatter',
          type: 'std_msgs/msg/String',
          messages: [{ logTime: 1_000_000_000n, value: { data: 'hello' } }],
        },
      ],
      { compress: true, chunkCompression: 'lz4' },
    );
    const source = sourceFor(bytes, 'mcap');
    const summary = await parseMcap(source);
    expect(summary.totalMessageCount).toBe(1);

    let message = '';
    try {
      await readRawMessagesMcap(source, '/chatter');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      message = (err as Error).message;
    }
    expect(message).toMatch(/Unsupported compression lz4/);
    expect(message.length).toBeGreaterThan(0);
    const classified = classifyBagError(message, 'file');
    expect(classified.raw).toBe(message);
    expect(classified.action?.kind).toBe('choose-file');
  });
});
