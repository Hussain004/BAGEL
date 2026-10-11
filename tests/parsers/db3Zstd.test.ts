/**
 * rosbag2 `compression_mode: message`: every blob in the messages table is
 * its own zstd frame (NVIDIA's r2b benchmark bags ship like this). Fixtures
 * vary the producer options on purpose: frames with and without the
 * content-size field, plain and compressed rows in one topic, tiny and
 * image-sized payloads, and a corrupt frame.
 */

import { zstdCompressSync, constants as zstdConstants } from 'node:zlib';
import { describe, it, expect, beforeEach, vi, afterAll } from 'vitest';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';

vi.mock('sql.js', async () => {
  const actual = await vi.importActual<typeof import('sql.js')>('sql.js');
  const init = actual.default;
  return { default: () => init(), __esModule: true };
});

const {
  parseDb3,
  readRawMessagesDb3,
  readDeserializedMessagesDb3,
  readMessageAtTimeDb3,
  readRangeDb3,
  disposeDb3Cache,
} = await import('../../src/parsers/db3');
const { editDb3Bag } = await import('../../src/parsers/editDb3');
const { parseMcap, readDeserializedMessagesMcap, disposeMcapCache } = await import('../../src/parsers/mcap');
const { createFileSource } = await import('../../src/parsers/source');
const { bytesToFile, collectMessageDefinitions, writeSyntheticDb3 } = await import('../fixtures/synth');

const strings = new MessageWriter(collectMessageDefinitions('std_msgs/msg/String'));
const ints = new MessageWriter(collectMessageDefinitions('std_msgs/msg/Int32'));

function zstd(bytes: Uint8Array, contentSize: boolean): Uint8Array {
  return new Uint8Array(
    zstdCompressSync(bytes, contentSize ? undefined : { params: { [zstdConstants.ZSTD_c_contentSizeFlag]: 0 } }),
  );
}

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

/** A string payload of a varied shape, so frames differ in size and ratio. */
function payload(i: number, rand: () => number): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz0123456789 ';
  const noise = (n: number) => Array.from({ length: n }, () => letters[Math.floor(rand() * letters.length)]).join('');
  switch (i % 5) {
    case 0: return 'scan '.repeat(1 + Math.floor(rand() * 3000));
    case 1: return noise(200 + Math.floor(rand() * 8000));
    case 2: return noise(1);
    case 3: return '';
    default: return noise(1_800_000); // about one raw camera frame
  }
}

const sec = (s: number) => BigInt(Math.round(s * 1e9));
const source = (bytes: Uint8Array) => createFileSource(bytesToFile(bytes, 'compressed.db3'));

beforeEach(() => {
  disposeDb3Cache();
  disposeMcapCache();
});
afterAll(() => disposeDb3Cache());

describe('db3 per-message zstd', () => {
  // /chatter: compressed, alternating frames with and without content size.
  // /ints: plain CDR. /mixed: plain and compressed rows interleaved.
  const chatter = ['hello', 'world', 'bagel'];
  async function bag() {
    return writeSyntheticDb3([
      {
        topic: '/chatter',
        type: 'std_msgs/msg/String',
        messages: chatter.map((data, i) => ({ timestampNs: sec(i + 1), data: zstd(strings.writeMessage({ data }), i % 2 === 0) })),
      },
      {
        topic: '/ints',
        type: 'std_msgs/msg/Int32',
        messages: [1, 2].map((data, i) => ({ timestampNs: sec(i + 1.5), data: ints.writeMessage({ data }) })),
      },
      {
        topic: '/mixed',
        type: 'std_msgs/msg/Int32',
        messages: [10, 11, 12, 13].map((data, i) => {
          const cdr = ints.writeMessage({ data });
          return { timestampNs: sec(1 + i * 0.5), data: i % 2 ? zstd(cdr, true) : cdr };
        }),
      },
    ]);
  }

  it('hands out plain CDR from the raw reader', async () => {
    const src = source(await bag());
    const raw = await readRawMessagesDb3(src, '/chatter');
    expect(raw.map((m) => Array.from(m.data))).toEqual(chatter.map((data) => Array.from(strings.writeMessage({ data }))));
  });

  it('decodes compressed, plain and mixed topics on every read path', async () => {
    const src = source(await bag());
    const summary = await parseDb3(src);
    expect(summary.totalMessageCount).toBe(9);

    const values = async (topic: string) => (await readDeserializedMessagesDb3(src, topic)).map((m) => m.value?.data);
    expect(await values('/chatter')).toEqual(chatter);
    expect(await values('/ints')).toEqual([1, 2]);
    expect(await values('/mixed')).toEqual([10, 11, 12, 13]);

    expect((await readMessageAtTimeDb3(src, '/chatter', sec(2.1)))?.value?.data).toBe('world');
    expect((await readMessageAtTimeDb3(src, '/mixed', sec(1.5)))?.value?.data).toBe(11);

    const range = await readRangeDb3(src, '/mixed', { startNs: sec(1.4), endNs: sec(2.6), stride: 1, phase: 0, max: 100 });
    expect(range.messages.map((m) => m.value?.data)).toEqual([11, 12, 13]);
  });

  it('decodes many differently shaped frames in a row, image-sized ones included', async () => {
    const rand = rng(7);
    const expected = Array.from({ length: 60 }, (_, i) => payload(i, rand));
    const src = source(
      await writeSyntheticDb3([
        {
          topic: '/varied',
          type: 'std_msgs/msg/String',
          messages: expected.map((data, i) => ({ timestampNs: sec(1 + i * 0.01), data: zstd(strings.writeMessage({ data }), i % 3 !== 0) })),
        },
      ]),
    );
    const got = await readDeserializedMessagesDb3(src, '/varied');
    expect(got).toHaveLength(expected.length);
    got.forEach((m, i) => expect(m.value?.data, `message ${i}`).toBe(expected[i]));
    // Nearest-message reads go through the cached path; walk it backwards too.
    for (let i = expected.length - 1; i >= 0; i -= 7) {
      expect((await readMessageAtTimeDb3(src, '/varied', sec(1 + i * 0.01)))?.value?.data).toBe(expected[i]);
    }
  });

  it('fails only the row whose frame is corrupt', async () => {
    const broken = zstd(strings.writeMessage({ data: 'lost' }), true).slice(0, 12);
    const src = source(
      await writeSyntheticDb3([
        {
          topic: '/chatter',
          type: 'std_msgs/msg/String',
          messages: [
            { timestampNs: sec(1), data: zstd(strings.writeMessage({ data: 'before' }), true) },
            { timestampNs: sec(2), data: broken },
            { timestampNs: sec(3), data: zstd(strings.writeMessage({ data: 'after' }), false) },
          ],
        },
      ]),
    );
    expect((await readDeserializedMessagesDb3(src, '/chatter')).map((m) => m.value?.data ?? null)).toEqual(['before', null, 'after']);
  });

  it('writes plain CDR into an edited MCAP', async () => {
    const result = await editDb3Bag(source(await bag()), { startNs: 0n, endNs: sec(10) });
    expect(result.messageCount).toBe(9);
    const out = createFileSource(bytesToFile(result.bytes, 'edited.mcap'));
    await parseMcap(out);
    expect((await readDeserializedMessagesMcap(out, '/chatter')).map((m) => m.value?.data)).toEqual(chatter);
    expect((await readDeserializedMessagesMcap(out, '/mixed')).map((m) => m.value?.data)).toEqual([10, 11, 12, 13]);
  });
});
