/**
 * rosbag1.ts tests: the ROS1 wire-format deserializer that `bag.ts` uses.
 *
 * Focus areas:
 *  - concatenated `.msg` definitions (the `=====` separator blocks that ROS1
 *    connection records embed), constants, fixed + variable arrays, nested
 *    `std_msgs/Header`;
 *  - the `nanosec` alias pass over every `{sec, nsec}` time object;
 *  - stateful behavior of the module-level MessageReader cache: hundreds of
 *    sequential decodes on a reused instance, alternating cache keys, and
 *    `clearRos1ReaderCache`.
 *
 * Fixtures are encoded with `@foxglove/rosmsg-serialization`'s own
 * MessageWriter so the bytes are producer-realistic.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { parse as parseMessageDefinition } from '@foxglove/rosmsg';
import { MessageWriter } from '@foxglove/rosmsg-serialization';

import {
  deserializeRos1Message,
  clearRos1ReaderCache,
} from '../../src/parsers/rosbag1';

/** Root definition with constants, arrays, a nested Header and a Point. */
const COMPLEX_DEFINITION =
  'byte FLAG=1\n' + // constant: parsed for md5, never emitted as a field
  'std_msgs/Header header\n' +
  'geometry_msgs/Point pt\n' +
  'int32[3] arr3\n' +
  'float32[] varr\n' +
  'string name\n' +
  '================================================================================\n' +
  'MSG: std_msgs/Header\n' +
  'uint32 seq\n' +
  'time stamp\n' +
  'string frame_id\n' +
  '================================================================================\n' +
  'MSG: geometry_msgs/Point\n' +
  'float64 x\n' +
  'float64 y\n' +
  'float64 z\n';

const COMPLEX_MESSAGE = {
  header: { seq: 1, stamp: { sec: 5, nsec: 6 }, frame_id: 'odom' },
  pt: { x: 1.5, y: -2.5, z: 3.5 },
  arr3: [1, 2, 3],
  varr: [1.5, 2.5],
  name: 'bagel',
};

/** Root definition with a top-level `time` primitive. */
const TOP_TIME_DEFINITION = 'time t\nint32 value\n';

beforeEach(() => clearRos1ReaderCache());
afterAll(() => clearRos1ReaderCache());

describe('rosbag1/deserializeRos1Message: definition handling', () => {
  it('decodes concatenated definitions with constants and nested types', () => {
    const writer = new MessageWriter(
      parseMessageDefinition(COMPLEX_DEFINITION, { ros2: false }),
    );
    const data = writer.writeMessage(COMPLEX_MESSAGE);
    const out = deserializeRos1Message(COMPLEX_DEFINITION, data, 'complex');

    // Constants are part of the schema but are not emitted as fields.
    expect('FLAG' in out).toBe(false);
    expect(Object.keys(out).sort()).toEqual(['arr3', 'header', 'name', 'pt', 'varr']);
    expect(out.name).toBe('bagel');
    // Fixed-size array decodes element-wise.
    expect(Array.from(out.arr3 as ArrayLike<number>)).toEqual([1, 2, 3]);
    // Variable-size array decodes with its runtime length.
    expect(Array.from(out.varr as ArrayLike<number>)).toEqual([1.5, 2.5]);
    const pt = out.pt as { x: number; y: number; z: number };
    expect([pt.x, pt.y, pt.z]).toEqual([1.5, -2.5, 3.5]);
    // The nested Header (via the `=====` separator block) decodes fully and
    // the `time` primitive gains the `nanosec` alias.
    const header = out.header as {
      seq: number;
      stamp: { sec: number; nsec: number; nanosec: number };
      frame_id: string;
    };
    expect(header.seq).toBe(1);
    expect(header.frame_id).toBe('odom');
    expect(header.stamp).toEqual({ sec: 5, nsec: 6, nanosec: 6 });
    // Non-time fields must not gain a bogus alias; the alias lives on the
    // time object itself.
    expect('nanosec' in (out as Record<string, unknown>)).toBe(false);
    expect('nanosec' in header.stamp).toBe(true);
    expect((header.frame_id as unknown as { nanosec?: number }).nanosec).toBeUndefined();
  });

  it('adds the nanosec alias to top-level time fields too', () => {
    const writer = new MessageWriter(parseMessageDefinition(TOP_TIME_DEFINITION, { ros2: false }));
    const data = writer.writeMessage({ t: { sec: 12, nsec: 34 }, value: 7 });
    const out = deserializeRos1Message(TOP_TIME_DEFINITION, data, 'top-time');
    expect(out.t).toEqual({ sec: 12, nsec: 34, nanosec: 34 });
    expect(out.value).toBe(7);
  });

  it('throws on truncated input instead of returning partial data', () => {
    const writer = new MessageWriter(parseMessageDefinition(TOP_TIME_DEFINITION, { ros2: false }));
    const data = writer.writeMessage({ t: { sec: 1, nsec: 2 }, value: 3 });
    // bag.ts wraps this call in try/catch and surfaces `value: null`; the
    // strictness lives here: short buffers must throw, not decode garbage.
    expect(() => deserializeRos1Message(TOP_TIME_DEFINITION, data.subarray(0, 4), 'short')).toThrow();
    expect(() => deserializeRos1Message(TOP_TIME_DEFINITION, data.subarray(0, 7), 'short')).toThrow();
  });
});

describe('rosbag1/deserializeRos1Message: sequential reuse', () => {
  it('survives 300+ decodes on a reused writer buffer with a shared cacheKey', () => {
    const defs = parseMessageDefinition(COMPLEX_DEFINITION, { ros2: false });
    const writer = new MessageWriter(defs);
    // One preallocated buffer for every iteration; sized for the longest
    // string we ever write (MessageWriter throws if the output is too small).
    const reusable = new Uint8Array(
      writer.calculateByteSize({ ...COMPLEX_MESSAGE, name: 'msg000' }),
    );

    let lastDecoded: Record<string, unknown> | undefined;
    for (let i = 0; i < 300; i++) {
      const message = {
        header: { seq: i, stamp: { sec: i, nsec: i * 2 }, frame_id: `f${i % 7}` },
        pt: { x: i, y: -i, z: 0.5 },
        arr3: [i, i + 1, i + 2],
        varr: [i * 0.5, i * 0.25],
        name: `msg${i}`,
      };
      const bytes = writer.writeMessage(message, reusable);
      const decoded = deserializeRos1Message(
        COMPLEX_DEFINITION,
        bytes,
        'shared-cache-key',
      );

      // Assert immediately, before the next iteration overwrites the buffer:
      // decoded fixed arrays are views into the input buffer (documented in
      // the aliasing test below), so deferring the check would read the
      // *next* message's bytes.
      expect(decoded.name).toBe(`msg${i}`);
      expect((decoded.header as { seq: number }).seq).toBe(i);
      expect(Array.from(decoded.arr3 as ArrayLike<number>)).toEqual([i, i + 1, i + 2]);
      expect(Array.from(decoded.varr as ArrayLike<number>)).toEqual([i * 0.5, i * 0.25]);
      const stamp = (decoded.header as { stamp: { sec: number; nanosec: number } }).stamp;
      expect(stamp.sec).toBe(i);
      expect(stamp.nanosec).toBe(i * 2);
      lastDecoded = decoded;
    }
    expect(lastDecoded).toBeDefined();
    // After 300 sequential calls the shared reader still produced correct
    // output on its final iteration (stateful instance never wedged).
    expect(lastDecoded!.name).toBe('msg299');
  });

  it('keeps alternating cache keys isolated from each other', () => {
    const stringDef = 'string data\n';
    const intDef = 'int32 data\n';
    const stringWriter = new MessageWriter(parseMessageDefinition(stringDef, { ros2: false }));
    const intWriter = new MessageWriter(parseMessageDefinition(intDef, { ros2: false }));

    for (let i = 0; i < 100; i++) {
      const sBytes = stringWriter.writeMessage({ data: `v${i}` });
      const sOut = deserializeRos1Message(stringDef, sBytes, 'key:string');
      expect(sOut.data).toBe(`v${i}`);

      const iBytes = intWriter.writeMessage({ data: i });
      const iOut = deserializeRos1Message(intDef, iBytes, 'key:int');
      expect(iOut.data).toBe(i);

      // Re-hit the first key: still the cached reader, still correct.
      const sAgain = deserializeRos1Message(stringDef, stringWriter.writeMessage({ data: `w${i}` }), 'key:string');
      expect(sAgain.data).toBe(`w${i}`);
    }
  });

  it('clearRos1ReaderCache forgets readers without breaking subsequent decodes', () => {
    const stringDef = 'string data\n';
    const writer = new MessageWriter(parseMessageDefinition(stringDef, { ros2: false }));
    const before = deserializeRos1Message(stringDef, writer.writeMessage({ data: 'a' }), 'k');
    expect(before.data).toBe('a');

    clearRos1ReaderCache();

    // The next decode rebuilds the reader for the same key and must produce
    // the same results as the cached one did.
    const after1 = deserializeRos1Message(stringDef, writer.writeMessage({ data: 'b' }), 'k');
    expect(after1.data).toBe('b');
    const after2 = deserializeRos1Message(stringDef, writer.writeMessage({ data: 'c' }), 'k');
    expect(after2.data).toBe('c');
  });
});

describe('rosbag1/deserializeRos1Message: observed aliasing', () => {
  it('DOCUMENTED OBSERVATION: decoded arrays alias the input buffer', () => {
    // Observed behavior of @foxglove/rosmsg-serialization (not BAGEL code):
    // fixed/variable arrays decode as typed-array VIEWS over the input
    // buffer rather than copies. Reusing the buffer after decoding mutates
    // previously decoded values in place. `bag.ts` passes each message's
    // bytes straight from the reader and caches decoded values by logTime,
    // so this is safe there as long as the underlying chunk bytes are not
    // rewritten - but direct callers of `deserializeRos1Message` must not
    // mutate `data` while holding on to a decoded value. This test pins the
    // observed behavior so a library upgrade that changes it gets flagged.
    const writer = new MessageWriter(parseMessageDefinition(COMPLEX_DEFINITION, { ros2: false }));
    // Overwrite candidate: longer string than the original so we can prove
    // strings are copied while arrays are not. The buffer must fit it -
    // MessageWriter throws when the output is too small.
    const other = {
      ...COMPLEX_MESSAGE,
      arr3: [9, 8, 7],
      varr: [9.5, 8.5],
      name: 'other!!', // 7 chars > 'bagel' (5)
    };
    const reusable = new Uint8Array(writer.calculateByteSize(other));
    const first = writer.writeMessage(COMPLEX_MESSAGE, reusable);
    const decodedFirst = deserializeRos1Message(COMPLEX_DEFINITION, first, 'alias');

    // Overwrite the buffer with the different message.
    writer.writeMessage(other, reusable);

    // Strings were copied, so they still show the original value...
    expect(decodedFirst.name).toBe('bagel');
    // ...but the arrays are live views and now read the new message's data.
    expect(Array.from(decodedFirst.arr3 as ArrayLike<number>)).toEqual([9, 8, 7]);
    expect(Array.from(decodedFirst.varr as ArrayLike<number>)).toEqual([9.5, 8.5]);
  });
});

describe('rosbag1/deserializeRos1Message: default cacheKey fallback', () => {
  it('DOCUMENTED OBSERVATION: default cacheKey collides on identical 100-char prefixes', () => {
    // When `cacheKey` is omitted, rosbag1.ts falls back to
    // `schemaText.slice(0, 100)`. Two definitions that share their first
    // 100 characters but diverge afterwards map to the same cached reader,
    // so the second schema silently reuses the first one's field layout and
    // any fields past the shared prefix are dropped from the decode.
    // BAGEL's own caller (`bag.ts`) always passes an explicit
    // `ros1:${topicName}` key, so this only bites external callers - which
    // is exactly why it is pinned here.
    const prefix = '# ' + 'x'.repeat(110) + '\n'; // 113 identical chars
    const defA = prefix + 'string data\nint32 alpha\n';
    const defB = prefix + 'string data\nstring tail\n';
    expect(defA.slice(0, 100)).toBe(defB.slice(0, 100));

    const writerA = new MessageWriter(parseMessageDefinition(defA, { ros2: false }));
    deserializeRos1Message(defA, writerA.writeMessage({ data: 'x', alpha: 5 })); // populates the shared slot

    const writerB = new MessageWriter(parseMessageDefinition(defB, { ros2: false }));
    const bytesB = writerB.writeMessage({ data: 'hello', tail: 'world' });
    const decoded = deserializeRos1Message(defB, bytesB); // no cacheKey

    // The definition-A reader handled definition-B's bytes without throwing,
    // but B's trailing `tail` field is missing: silent field drop.
    expect(decoded.data).toBe('hello');
    expect('tail' in decoded).toBe(false);

    // Passing an explicit distinct key restores correct behavior.
    const correct = deserializeRos1Message(defB, bytesB, 'defB');
    expect(correct.data).toBe('hello');
    expect(correct.tail).toBe('world');
  });
});
