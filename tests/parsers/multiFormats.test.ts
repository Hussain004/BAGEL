/**
 * Split recordings in the other two container formats. The dispatcher is
 * format-agnostic, but each reader has its own idea of "nearest message" and
 * its own per-file state, so prove it rather than assume.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';

// db3.ts asks for a browser-absolute WASM path; use sql.js' own in Node.
vi.mock('sql.js', async () => {
  const actual = await vi.importActual<typeof import('sql.js')>('sql.js');
  const init = actual.default;
  return { default: () => init(), __esModule: true };
});

const { disposeParserCaches, parseBag, readDeserializedMessages, readMessageAtTime } = await import(
  '../../src/parsers/core'
);
const { bytesToFile, collectMessageDefinitions, encodeRos1String, writeSyntheticDb3, writeSyntheticRos1Bag } =
  await import('../fixtures/synth');

import type { MultiBagSource } from '../../src/parsers/source';

const S = 1_000_000_000n;
const multi = (parts: MultiBagSource['parts']): MultiBagSource => ({ kind: 'multi', parts, displayName: 'split' });
const fileOf = (bytes: Uint8Array, name: string) => ({ kind: 'file' as const, file: bytesToFile(bytes, name) });

beforeEach(() => disposeParserCaches());

describe('ROS1 .bag splits', () => {
  async function ros1Part(secs: number[], tag: string) {
    return writeSyntheticRos1Bag([
      {
        topic: '/chatter',
        type: 'std_msgs/String',
        messageDefinition: 'string data\n',
        messages: secs.map((t) => ({ time: { sec: t, nsec: 0 }, data: encodeRos1String(`${tag}@${t}`) })),
      },
    ]);
  }

  it('merges parts and answers nearest-message across the boundary', async () => {
    const p0 = fileOf(await ros1Part([1, 2, 3], 'a'), 'run_2020-01-01-00-00-00_0.bag');
    const p1 = fileOf(await ros1Part([10, 11], 'b'), 'run_2020-01-01-00-00-00_1.bag');
    const src = multi([p1, p0]);

    const summary = await parseBag(src);
    expect(summary.format).toBe('bag');
    expect(summary.totalMessageCount).toBe(5);
    expect(summary.startTime).toBe(1n * S);
    expect(summary.endTime).toBe(11n * S);

    const msgs = await readDeserializedMessages(src, 'bag', '/chatter');
    expect(msgs.map((m) => m.value?.data)).toEqual(['a@1', 'a@2', 'a@3', 'b@10', 'b@11']);
    expect((await readMessageAtTime(src, 'bag', '/chatter', 5n * S))?.value?.data).toBe('b@10');
    expect((await readMessageAtTime(src, 'bag', '/chatter', 99n * S))?.value?.data).toBe('b@11');
  });
});

describe('ROS 2 .db3 splits', () => {
  let writer: MessageWriter;
  beforeAll(() => {
    writer = new MessageWriter(collectMessageDefinitions('std_msgs/msg/String'));
  });

  async function db3Part(secs: number[], tag: string) {
    return writeSyntheticDb3([
      {
        topic: '/chatter',
        type: 'std_msgs/msg/String',
        messages: secs.map((t) => ({
          timestampNs: BigInt(t) * S,
          data: writer.writeMessage({ data: `${tag}@${t}` }),
        })),
      },
    ]);
  }

  it('merges parts and reads across the boundary', async () => {
    const p0 = fileOf(await db3Part([1, 2], 'a'), 'rosbag2_0.db3');
    const p1 = fileOf(await db3Part([5, 6], 'b'), 'rosbag2_1.db3');
    const src = multi([p0, p1]);

    const summary = await parseBag(src);
    expect(summary.format).toBe('db3');
    expect(summary.totalMessageCount).toBe(4);

    const msgs = await readDeserializedMessages(src, 'db3', '/chatter');
    expect(msgs.map((m) => m.value?.data)).toEqual(['a@1', 'a@2', 'b@5', 'b@6']);
    expect((await readMessageAtTime(src, 'db3', '/chatter', 3n * S))?.value?.data).toBe('b@5');
  });

  it('refuses to mix formats', async () => {
    const d = fileOf(await db3Part([1], 'a'), 'rosbag2_0.db3');
    const r = fileOf(
      await writeSyntheticRos1Bag([
        { topic: '/c', type: 'std_msgs/String', messageDefinition: 'string data\n', messages: [{ time: { sec: 1, nsec: 0 }, data: encodeRos1String('x') }] },
      ]),
      'rosbag2_1.bag',
    );
    await expect(parseBag(multi([d, r]))).rejects.toThrow(/not all the same format/);
  });
});
