/**
 * Bounded range reads, per format: walking a range in small batches must give
 * exactly the messages one full read would, for varied strides and batch sizes,
 * on every container the app opens.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';

vi.mock('sql.js', async () => {
  const actual = await vi.importActual<typeof import('sql.js')>('sql.js');
  const init = actual.default;
  return { default: () => init(), __esModule: true };
});

const { readMessagesInRange, readDeserializedMessages, disposeParserCaches } = await import('../../src/parsers/core');
const { createFileSource } = await import('../../src/parsers/source');
const {
  bytesToFile,
  collectMessageDefinitions,
  writeSyntheticMcap,
  writeSyntheticRos1Bag,
  writeSyntheticDb3,
  encodeRos1String,
} = await import('../fixtures/synth');
import type { RangeParams } from '../../src/parsers/range';

const N = 60;
const T0 = 1_000_000_000n;
const STEP = 10_000_000n; // 10 ms
const at = (i: number) => T0 + BigInt(i) * STEP;
const text = (i: number) => `m${i}`;

type Format = 'mcap' | 'bag' | 'db3';
const fixtures = new Map<string, { format: Format; file: File }>();

beforeAll(async () => {
  const mcapTopic = [{ topic: '/t', type: 'std_msgs/msg/String', messages: Array.from({ length: N }, (_, i) => ({ logTime: at(i), value: { data: text(i) } })) }];
  fixtures.set('mcap', { format: 'mcap', file: bytesToFile(await writeSyntheticMcap(mcapTopic), 'a.mcap') });
  fixtures.set('mcap zstd', { format: 'mcap', file: bytesToFile(await writeSyntheticMcap(mcapTopic, { compress: true }), 'b.mcap') });

  const ros1 = await writeSyntheticRos1Bag(
    [
      {
        topic: '/t',
        type: 'std_msgs/String',
        messageDefinition: 'string data\n',
        messages: Array.from({ length: N }, (_, i) => ({ time: { sec: Number(at(i) / 1_000_000_000n), nsec: Number(at(i) % 1_000_000_000n) }, data: encodeRos1String(text(i)) })),
      },
    ],
    { chunkCount: 5 },
  );
  fixtures.set('ros1 bag', { format: 'bag', file: bytesToFile(ros1, 'c.bag') });

  const writer = new MessageWriter(collectMessageDefinitions('std_msgs/msg/String'));
  const db3 = await writeSyntheticDb3([
    { topic: '/t', type: 'std_msgs/msg/String', messages: Array.from({ length: N }, (_, i) => ({ timestampNs: at(i), data: writer.writeMessage({ data: text(i) }) })) },
  ]);
  fixtures.set('db3', { format: 'db3', file: bytesToFile(db3, 'd.db3') });
});

const base = (extra: Partial<RangeParams> = {}): RangeParams => ({ startNs: 0n, endNs: 10n ** 19n, stride: 1, phase: 0, max: 10_000, ...extra });

async function drain(name: string, params: RangeParams): Promise<{ ts: bigint; text: string }[]> {
  const { format, file } = fixtures.get(name)!;
  const source = createFileSource(file);
  const out: { ts: bigint; text: string }[] = [];
  let start: bigint | null = params.startNs;
  let phase = 0;
  for (let calls = 0; start !== null && calls < 500; calls++) {
    const r = await readMessagesInRange(source, format, '/t', { ...params, startNs: start, phase });
    for (const m of r.messages) out.push({ ts: m.timestamp, text: (m.value as { data: string }).data });
    start = r.nextStartNs;
    phase = r.phase;
  }
  return out;
}

const NAMES = ['mcap', 'mcap zstd', 'ros1 bag', 'db3'];

describe.each(NAMES)('range read: %s', (name) => {
  it('one call returns the whole topic in order', async () => {
    const all = await drain(name, base());
    expect(all).toHaveLength(N);
    expect(all.map((m) => m.text)).toEqual(Array.from({ length: N }, (_, i) => text(i)));
    expect(all[0]!.ts).toBe(at(0));
    expect(all[N - 1]!.ts).toBe(at(N - 1));
  });

  it('honours both ends of the range, inclusive', async () => {
    const r = await drain(name, base({ startNs: at(10), endNs: at(14) }));
    expect(r.map((m) => m.ts)).toEqual([at(10), at(11), at(12), at(13), at(14)]);
    expect(await drain(name, base({ startNs: at(N + 5), endNs: at(N + 9) }))).toEqual([]);
    expect(await drain(name, base({ startNs: 0n, endNs: at(0) - 1n }))).toEqual([]);
  });

  it('batches of any size with any stride match one big read', async () => {
    for (const stride of [1, 3, 7, 60]) {
      const whole = (await drain(name, base({ stride, startNs: at(5), endNs: at(55) }))).map((m) => m.text);
      for (const max of [1, 2, 5, 17, 100]) {
        const batched = (await drain(name, base({ stride, max, startNs: at(5), endNs: at(55) }))).map((m) => m.text);
        expect(batched, `stride ${stride}, batch ${max}`).toEqual(whole);
      }
    }
  });

  it('a stride takes the first and then every Nth', async () => {
    const r = await drain(name, base({ stride: 20 }));
    expect(r.map((m) => m.text)).toEqual([text(0), text(20), text(40)]);
  });

  it('is the same data a full read gives', async () => {
    const { format, file } = fixtures.get(name)!;
    const source = createFileSource(file);
    const full = await readDeserializedMessages(source, format, '/t');
    const ranged = await drain(name, base({ max: 7 }));
    expect(ranged.map((m) => m.ts)).toEqual(full.map((m) => m.timestamp));
  });

  it('an unknown topic is empty, not an error', async () => {
    const { format, file } = fixtures.get(name)!;
    const r = await readMessagesInRange(createFileSource(file), format, '/nope', base());
    expect(r).toEqual({ messages: [], nextStartNs: null, phase: 0 });
  });

  it('keeps working across many reuses of the same parsed file', async () => {
    for (let i = 0; i < 25; i++) {
      const lo = (i * 7) % 40;
      const r = await drain(name, base({ startNs: at(lo), endNs: at(lo + 9), max: 1 + (i % 4) }));
      expect(r.map((m) => m.text)).toEqual(Array.from({ length: 10 }, (_, k) => text(lo + k)));
    }
    disposeParserCaches();
    expect((await drain(name, base({ max: 11 }))).length).toBe(N);
  });
});
