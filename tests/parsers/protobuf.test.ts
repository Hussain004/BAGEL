// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import goldenJson from '../fixtures/golden/protobuf.golden.json';
import { createProtobufDecoder, createProtobufDecoderFromBase64, parseDescriptorSet } from '../../src/parsers/protobuf';
import { translateFoxgloveMessage } from '../../src/parsers/foxgloveSchemas';
import { parseImageAnnotations } from '../../src/utils/imageAnnotations';
import { decodeLiveMessage } from '../../src/live/liveDecoder';
import { disposeParserCaches, parseBag, readDeserializedMessages } from '../../src/parsers/core';
import { createFileSource } from '../../src/parsers/source';
import {
  TYPE, concat, descriptorSet, encode, encodeFoxglove, fixed32, fixed64, foxgloveDescriptorSet, ld, str, tag,
  ts, varint, vint, writeProtobufMcap, zigzag, type FieldSpec, type MessageSpec,
} from '../fixtures/protobuf';

afterEach(() => disposeParserCaches());

const f = (name: string, number: number, type: number, extra: Partial<FieldSpec> = {}): FieldSpec => ({ name, number, type, ...extra });
const set = (m: MessageSpec) => descriptorSet([{ name: 't.proto', pkg: 't', messages: [m] }]);
const decoderFor = (m: MessageSpec) => createProtobufDecoder(set(m), `t.${m.name}`);
const bytes = (...n: number[]) => Uint8Array.from(n);

describe('wire format, from byte vectors written out by hand', () => {
  // The first three are the examples in the protobuf encoding guide.
  const M: MessageSpec = {
    name: 'M',
    fields: [f('a', 1, TYPE.INT32), f('b', 2, TYPE.STRING), f('d', 4, TYPE.INT32, { repeated: true }), f('e', 5, TYPE.SINT32), f('g', 6, TYPE.INT64), f('flag', 7, TYPE.BOOL)],
  };
  const dec = decoderFor(M);

  it('reads a varint field', () => {
    expect(dec(bytes(0x08, 0x96, 0x01))).toMatchObject({ a: 150 });
  });

  it('reads a string field', () => {
    expect(dec(bytes(0x12, 0x07, 0x74, 0x65, 0x73, 0x74, 0x69, 0x6e, 0x67))).toMatchObject({ b: 'testing' });
  });

  it('reads a packed repeated field', () => {
    expect(dec(bytes(0x22, 0x06, 0x03, 0x8e, 0x02, 0x9e, 0xa7, 0x05))).toMatchObject({ d: [3, 270, 86942] });
  });

  it('reads negative int32 as ten bytes of varint', () => {
    const out = dec(bytes(0x08, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01));
    expect(out['a']).toBe(-1);
  });

  it('zigzag decodes sint32', () => {
    expect([0, 1, 2, 3, 4294967294].map((z) => dec(bytes(0x28, ...varint(z)))['e'])).toEqual([0, -1, 1, -2, 2147483647]);
  });

  it('bool is any nonzero varint', () => {
    expect(dec(bytes(0x38, 0x01))['flag']).toBe(true);
    expect(dec(bytes(0x38, 0x00))['flag']).toBe(false);
  });
});

describe('64-bit integers stay exact', () => {
  const M: MessageSpec = {
    name: 'M',
    fields: [f('i', 1, TYPE.INT64), f('u', 2, TYPE.UINT64), f('s', 3, TYPE.SINT64), f('fx', 4, TYPE.FIXED64), f('sf', 5, TYPE.SFIXED64)],
  };
  const dec = decoderFor(M);
  const enc = (v: Record<string, unknown>) => encode(M, v, () => M);

  it('numbers when they fit in 53 bits, bigints when they do not', () => {
    const out = dec(enc({ i: 9007199254740991n, u: 9007199254740992n, s: -9007199254740992n, fx: 1700000000123456789n, sf: -1 }));
    expect(out['i']).toBe(9007199254740991);
    expect(out['u']).toBe(9007199254740992n);
    expect(out['s']).toBe(-9007199254740992n);
    expect(out['fx']).toBe(1700000000123456789n);
    expect(out['sf']).toBe(-1);
  });

  it('negative int64 and the extremes', () => {
    const out = dec(enc({ i: -1, u: 18446744073709551615n, s: -4611686018427387904n }));
    expect(out['i']).toBe(-1);
    expect(out['u']).toBe(18446744073709551615n);
    expect(out['s']).toBe(-4611686018427387904n);
    expect(dec(enc({ i: -9223372036854775808n }))['i']).toBe(-9223372036854775808n);
  });
});

describe('what real producers do differently', () => {
  const M: MessageSpec = {
    name: 'M',
    fields: [
      f('count', 1, TYPE.UINT32), f('xs', 2, TYPE.DOUBLE, { repeated: true }), f('ids', 3, TYPE.FIXED32, { repeated: true }),
      f('name', 4, TYPE.STRING), f('tags', 5, TYPE.STRING, { repeated: true }), f('blob', 6, TYPE.BYTES), f('f', 7, TYPE.FLOAT), f('on', 8, TYPE.BOOL),
    ],
  };
  const dec = decoderFor(M);
  const value = { count: 7, xs: [1.5, -2.25, 1e300], ids: [1, 4294967295], name: 'robot', tags: ['a', '', 'ccc'], blob: bytes(0, 255, 128), f: 0.5, on: true };
  const lookup = () => M;

  it('reads the same value whether repeated scalars are packed or one tag each, and in any field order', () => {
    const reference = dec(encode(M, value, lookup));
    expect(reference).toMatchObject({ ...value, blob: bytes(0, 255, 128) });
    for (const opts of [{ packed: false }, { reverse: true }, { packed: false, reverse: true }]) {
      expect(dec(encode(M, value, lookup, opts))).toEqual(reference);
    }
  });

  it('accepts packed and unpacked pieces of one field in the same message', () => {
    const out = dec(concat(ld(2, concat(...[1, 2].map((v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); return b; }))), fixed64(2, (dv) => dv.setFloat64(0, 3, true))));
    expect(out['xs']).toEqual([1, 2, 3]);
  });

  it('proto3 omits zero values, so absent fields read as their defaults', () => {
    expect(dec(new Uint8Array(0))).toEqual({ count: 0, xs: [], ids: [], name: '', tags: [], blob: new Uint8Array(0), f: 0, on: false });
  });

  it('the last occurrence of a scalar wins', () => {
    expect(dec(concat(vint(1, 1), vint(1, 2), vint(1, 3)))['count']).toBe(3);
  });

  it('skips fields it does not know, of every wire type, including groups', () => {
    const unknown = concat(
      vint(50, 123456), fixed64(51, (dv) => dv.setFloat64(0, 1, true)), str(52, 'ignored'), fixed32(53, (dv) => dv.setUint32(0, 9, true)),
      tag(54, 3), vint(1, 5), tag(55, 3), vint(2, 1), tag(55, 4), tag(54, 4), // a group holding a group
    );
    const out = dec(concat(unknown, vint(1, 42), unknown, str(4, 'kept'), unknown));
    expect(out).toMatchObject({ count: 42, name: 'kept' });
  });

  it('keeps bytes independent of the input buffer', () => {
    const buf = encode(M, { blob: bytes(1, 2, 3) }, lookup);
    const out = dec(buf);
    buf.fill(0);
    expect(out['blob']).toEqual(bytes(1, 2, 3));
    expect((out['blob'] as Uint8Array).byteOffset).toBe(0);
  });

  it('decodes a message that is a view into a bigger buffer', () => {
    const inner = encode(M, value, lookup);
    const big = concat(new Uint8Array(37).fill(0xee), inner, new Uint8Array(11).fill(0xee));
    expect(dec(big.subarray(37, 37 + inner.length))).toEqual(dec(inner));
  });

  it('reads NaN, infinities and floats exactly', () => {
    const out = dec(encode(M, { xs: [NaN, Infinity, -Infinity, -0], f: 3.4028234663852886e38 }, lookup));
    expect(out['xs']).toEqual([NaN, Infinity, -Infinity, -0]);
    expect(out['f']).toBe(3.4028234663852886e38);
  });
});

describe('nesting, maps and well-known types', () => {
  const Entry: MessageSpec = { name: 'CountsEntry', fields: [f('key', 1, TYPE.STRING), f('value', 2, TYPE.INT32)], mapEntry: true };
  const Inner: MessageSpec = { name: 'Inner', fields: [f('v', 1, TYPE.INT32)] };
  const Outer: MessageSpec = {
    name: 'Outer',
    nested: [Entry],
    fields: [
      f('at', 1, TYPE.MESSAGE, { typeName: '.google.protobuf.Timestamp' }), f('inner', 2, TYPE.MESSAGE, { typeName: '.t.Inner' }),
      f('inners', 3, TYPE.MESSAGE, { typeName: '.t.Inner', repeated: true }), f('counts', 4, TYPE.MESSAGE, { typeName: '.t.Outer.CountsEntry', repeated: true }),
      f('span', 5, TYPE.MESSAGE, { typeName: '.google.protobuf.Duration' }),
    ],
  };

  it('Timestamp and Duration become { sec, nsec }, even when the set does not ship their file', () => {
    const dec = createProtobufDecoder(
      descriptorSet([{ name: 't.proto', pkg: 't', messages: [Outer, Inner] }]),
      't.Outer',
    );
    const out = dec(concat(ld(1, concat(vint(1, 1700000000), vint(2, 250))), ld(5, vint(1, 3))));
    expect(out['at']).toEqual({ sec: 1700000000, nsec: 250 });
    expect(out['span']).toEqual({ sec: 3, nsec: 0 });
  });

  it('repeated and singular submessages, absent ones stay absent', () => {
    const dec = createProtobufDecoder(descriptorSet([{ name: 't.proto', pkg: 't', messages: [Outer, Inner] }]), 't.Outer');
    const out = dec(concat(ld(2, vint(1, 5)), ld(3, vint(1, 1)), ld(3, vint(1, 2)), ld(3, new Uint8Array(0))));
    expect(out['inner']).toEqual({ v: 5 });
    expect(out['inners']).toEqual([{ v: 1 }, { v: 2 }, { v: 0 }]);
    expect(out['at']).toBeUndefined();
  });

  it('map fields become an object', () => {
    const dec = createProtobufDecoder(descriptorSet([{ name: 't.proto', pkg: 't', messages: [Outer, Inner] }]), 't.Outer');
    const entry = (k: string, v: number) => ld(4, concat(str(1, k), vint(2, v)));
    expect(dec(concat(entry('a', 1), entry('b', -2), entry('a', 3)))['counts']).toEqual({ a: 3, b: -2 });
  });

  it('finds a type in a package that is split across several files', () => {
    const files = [
      { name: 'a.proto', pkg: 'one.two', messages: [{ name: 'A', fields: [f('b', 1, TYPE.MESSAGE, { typeName: '.three.B' })] }] },
      { name: 'b.proto', pkg: 'three', messages: [{ name: 'B', fields: [f('n', 1, TYPE.INT32)] }] },
    ];
    expect(createProtobufDecoder(descriptorSet(files), 'one.two.A')(ld(1, vint(1, 9)))).toEqual({ b: { n: 9 } });
  });

  it('a file with no package defines top-level names', () => {
    const d = createProtobufDecoder(descriptorSet([{ name: 'x.proto', pkg: '', messages: [{ name: 'Bare', fields: [f('n', 1, TYPE.INT32)] }] }]), 'Bare');
    expect(d(vint(1, 4))).toEqual({ n: 4 });
  });
});

describe('damaged and hostile input', () => {
  const M: MessageSpec = { name: 'M', fields: [f('s', 1, TYPE.STRING), f('x', 2, TYPE.DOUBLE), f('n', 3, TYPE.MESSAGE, { typeName: '.t.M' })] };
  const dec = decoderFor(M);

  it('throws on a truncated varint, string, fixed value and submessage', () => {
    expect(() => dec(bytes(0x08, 0x80))).toThrow();
    expect(() => dec(bytes(0x0a, 0x05, 0x61))).toThrow();
    expect(() => dec(bytes(0x11, 1, 2, 3))).toThrow();
    expect(() => dec(bytes(0x1a, 0x09, 0x0a))).toThrow();
  });

  it('throws on a varint that never ends and on wire types 6 and 7', () => {
    expect(() => dec(bytes(0x08, ...new Array(11).fill(0xff)))).toThrow();
    expect(() => dec(bytes(0x0e))).toThrow();
    expect(() => dec(bytes(0x0f))).toThrow();
  });

  it('refuses absurdly deep nesting instead of overflowing the stack', () => {
    let body: Uint8Array = new Uint8Array(0);
    for (let i = 0; i < 5000; i++) body = ld(3, body);
    expect(() => dec(body)).toThrow(/deeply/);
  });

  it('refuses an unterminated group, including deeply nested ones', () => {
    expect(() => dec(concat(tag(9, 3), vint(1, 1)))).toThrow();
    expect(() => dec(concat(...new Array(500).fill(tag(9, 3))))).toThrow();
  });

  it('throws for a type the schema does not define, with a useful name', () => {
    expect(() => createProtobufDecoder(set(M), 't.Missing')).toThrow(/t\.Missing/);
    const dangling: MessageSpec = { name: 'D', fields: [f('x', 1, TYPE.MESSAGE, { typeName: '.nowhere.X' })] };
    expect(() => createProtobufDecoder(set(dangling), 't.D')(ld(1, vint(1, 1)))).toThrow(/nowhere\.X/);
  });

  it('a garbage descriptor set fails cleanly', () => {
    expect(() => createProtobufDecoder(bytes(0x0a, 0xff, 0xff, 0xff, 0x0f), 't.M')).toThrow();
    expect(parseDescriptorSet(new Uint8Array(0)).size).toBe(0);
  });
});

describe('one decoder, many different messages', () => {
  it('stays correct across thousands of varied sequential calls', () => {
    const M: MessageSpec = {
      name: 'M',
      fields: [
        f('i', 1, TYPE.INT64), f('s', 2, TYPE.SINT32), f('t', 3, TYPE.STRING), f('xs', 4, TYPE.FLOAT, { repeated: true }),
        f('bs', 5, TYPE.BYTES), f('k', 6, TYPE.FIXED32), f('ws', 7, TYPE.UINT32, { repeated: true }), f('ok', 8, TYPE.BOOL),
      ],
    };
    const dec = decoderFor(M);
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let n = 0; n < 4000; n++) {
      const value = {
        i: Math.floor((rnd() - 0.5) * 2 ** 50),
        s: Math.floor((rnd() - 0.5) * 2 ** 31),
        t: 'é'.repeat(Math.floor(rnd() * 40)) + String(n),
        xs: Array.from({ length: Math.floor(rnd() * 20) }, () => Math.fround((rnd() - 0.5) * 1e6)),
        bs: Uint8Array.from({ length: Math.floor(rnd() * 64) }, () => Math.floor(rnd() * 256)),
        k: Math.floor(rnd() * 2 ** 32),
        ws: Array.from({ length: Math.floor(rnd() * 10) }, () => Math.floor(rnd() * 2 ** 32)),
        ok: rnd() > 0.5,
      };
      const opts = { packed: rnd() > 0.5, reverse: rnd() > 0.5 };
      const got = dec(encode(M, value, () => M, opts));
      expect(got).toEqual({ ...value, i: value.i });
    }
  });

  it('caches by descriptor, so a second decoder for the same set is cheap and independent', () => {
    const d = foxgloveDescriptorSet();
    const a = createProtobufDecoder(d, 'foxglove.CompressedImage');
    const b = createProtobufDecoder(d, 'foxglove.CompressedImage');
    const msg = encodeFoxglove('foxglove.CompressedImage', { timestamp: ts(5), frame_id: 'cam', data: bytes(1, 2, 3), format: 'jpeg' });
    expect(a(msg)).toEqual(b(msg));
  });
});

describe('Foxglove messages', () => {
  const RED = { r: 1, g: 0, b: 0, a: 1 };
  const decode = (name: string, v: Record<string, unknown>, opts?: { packed?: boolean; reverse?: boolean }) =>
    translateFoxgloveMessage(name, createProtobufDecoder(foxgloveDescriptorSet(), name)(encodeFoxglove(name, v, opts)));

  it('CompressedImage keeps its bytes and gets a ROS-style header', () => {
    const out = decode('foxglove.CompressedImage', { timestamp: ts(12, 34), frame_id: 'camera', data: bytes(0xff, 0xd8, 0xff), format: 'jpeg' });
    expect(out).toMatchObject({ header: { stamp: { sec: 12, nsec: 34 }, frame_id: 'camera' }, format: 'jpeg' });
    expect(out['data']).toEqual(bytes(0xff, 0xd8, 0xff));
  });

  it('ImageAnnotations parse into the same shapes the JSON path gives', () => {
    const value = {
      circles: [{ timestamp: ts(3), position: { x: 20, y: 30 }, diameter: 12, thickness: 2, outline_color: RED }],
      points: [{ timestamp: ts(3), type: 2, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], outline_color: RED, thickness: 1 }],
      texts: [{ timestamp: ts(3), position: { x: 5, y: 6 }, text: 'cone', font_size: 9, text_color: RED }],
    };
    const { shapes, stampNs } = parseImageAnnotations(decode('foxglove.ImageAnnotations', value));
    expect(stampNs).toBe(3_000_000_000n);
    expect(shapes.map((s) => s.kind)).toEqual(['circle', 'loop', 'text']);
    expect(shapes[0]).toMatchObject({ x: 20, y: 30, diameter: 12, thickness: 2, outline: 'rgba(255, 0, 0, 1.000)', fill: null });
  });

  it('SceneUpdate becomes markers, with deletions and line indices', () => {
    const pose = { position: { x: 1, y: 2, z: 3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
    const out = decode('foxglove.SceneUpdate', {
      deletions: [{ type: 0, id: 'old' }],
      entities: [{
        timestamp: ts(9), frame_id: 'map', id: 'boxes', lifetime: ts(2),
        cubes: [{ pose, size: { x: 1, y: 2, z: 3 }, color: RED }],
        lines: [{ type: 2, pose, thickness: 0.1, points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }], color: RED, indices: [2, 0] }],
      }],
    }, { packed: false });
    const markers = out['markers'] as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(markers.map((m) => [m['ns'], m['type']])).toEqual([['old', 0], ['boxes', 0], ['boxes', 1], ['boxes', 5]]);
    expect(markers[2]).toMatchObject({ header: { frame_id: 'map', stamp: { sec: 9 } }, scale: { x: 1, y: 2, z: 3 }, lifetime: { sec: 2 } });
    expect(markers[3]!['points']).toEqual([{ x: 1, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }]);
  });

  it('a live bridge sends the schema as base64', () => {
    const data = encodeFoxglove('foxglove.CompressedImage', { timestamp: ts(1), frame_id: 'c', data: bytes(9), format: 'png' });
    const schema = btoa(String.fromCharCode(...foxgloveDescriptorSet()));
    const out = decodeLiveMessage('protobuf', 'protobuf', schema, data, 'foxglove.CompressedImage');
    expect(out).toMatchObject({ format: 'png', header: { frame_id: 'c' } });
    // The same channel again reuses the parsed schema and still decodes.
    expect(decodeLiveMessage('protobuf', 'protobuf', schema, data, 'foxglove.CompressedImage')).toEqual(out);
    expect(createProtobufDecoderFromBase64(schema, 'foxglove.CompressedImage')).toBe(createProtobufDecoderFromBase64(schema, 'foxglove.CompressedImage'));
  });

  it('live: a damaged frame or a missing schema yields null, not a throw', () => {
    const schema = btoa(String.fromCharCode(...foxgloveDescriptorSet()));
    expect(decodeLiveMessage('protobuf', 'protobuf', schema, bytes(0x0a, 0x7f), 'foxglove.CompressedImage')).toBeNull();
    expect(decodeLiveMessage('protobuf', 'protobuf', '', bytes(1), 'foxglove.CompressedImage')).toBeNull();
  });
});

describe('in an MCAP file', () => {
  const T = (s: number) => BigInt(s) * 1_000_000_000n;
  const RED = { r: 1, g: 0, b: 0, a: 1 };

  async function open() {
    const bytes = await writeProtobufMcap([
      {
        topic: '/camera', schemaName: 'foxglove.CompressedImage',
        messages: [1, 2, 3].map((s) => ({ logTime: T(s), data: encodeFoxglove('foxglove.CompressedImage', { timestamp: ts(s), frame_id: 'cam', data: Uint8Array.from([s, s, s]), format: 'jpeg' }) })),
      },
      {
        topic: '/annotations', schemaName: 'foxglove.ImageAnnotations',
        messages: [1, 2].map((s) => ({ logTime: T(s), data: encodeFoxglove('foxglove.ImageAnnotations', { circles: [{ timestamp: ts(s), position: { x: s * 10, y: 5 }, diameter: 4, thickness: 1, outline_color: RED }] }) })),
      },
      {
        topic: '/scene', schemaName: 'foxglove.SceneUpdate',
        messages: [1, 2].map((s) => ({ logTime: T(s), data: encodeFoxglove('foxglove.SceneUpdate', { entities: [{ id: 'e', frame_id: 'map', cubes: new Array(s).fill({ pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }, size: { x: 1, y: 1, z: 1 }, color: RED }) }] }) })),
      },
    ]);
    const source = createFileSource(new File([bytes], 'pb.mcap'));
    return { source, summary: await parseBag(source) };
  }

  it('lists the topics and reads each one back', async () => {
    const { source, summary } = await open();
    expect(summary.topics.map((t) => [t.name, t.type, t.messageCount])).toEqual(expect.arrayContaining([
      ['/camera', 'foxglove.CompressedImage', 3], ['/annotations', 'foxglove.ImageAnnotations', 2], ['/scene', 'foxglove.SceneUpdate', 2],
    ]));
    const cam = await readDeserializedMessages(source, 'mcap', '/camera');
    expect(cam.map((m) => (m.value as { data: Uint8Array }).data[0])).toEqual([1, 2, 3]);
    const ann = await readDeserializedMessages(source, 'mcap', '/annotations');
    expect(parseImageAnnotations(ann[1]!.value as never).shapes[0]).toMatchObject({ kind: 'circle', x: 20 });
    const scene = await readDeserializedMessages(source, 'mcap', '/scene');
    expect(scene.map((m) => (m.value as { markers: unknown[] }).markers.length)).toEqual([2, 3]); // the replace marker plus one cube per count
  });
});

describe('zigzag helper in the fixture agrees with the spec', () => {
  it('maps small values the way the guide shows', () => {
    expect([0, -1, 1, -2, 2147483647, -2147483648].map((v) => Number(zigzag(v)))).toEqual([0, 1, 2, 3, 4294967294, 4294967295]);
  });
});

describe('against the reference Python implementation', () => {
  // protobuf.golden.json holds real FileDescriptorSet bytes and messages written by
  // the reference library (oneofs, proto3 optional, maps, every scalar, packed and
  // unpacked repeated fields). See fixtures/golden/make_protobuf_golden.py.
  const golden = goldenJson as { descriptorSetHex: string; message: string; cases: Array<{ hex: string; expected: unknown }> };
  const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));
  const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

  // Bigints and bytes are tagged the way the generator tags them; absent messages are null.
  const plain = (v: unknown): unknown => {
    if (v === undefined) return null;
    if (typeof v === 'bigint') return { $big: v.toString() };
    if (v instanceof Uint8Array) return { $bytes: toHex(v) };
    if (Array.isArray(v)) return v.map(plain);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]));
    return v;
  };

  it('decodes every generated message to the values the reference library put in', () => {
    const decode = createProtobufDecoder(fromHex(golden.descriptorSetHex), golden.message);
    expect(golden.cases.length).toBeGreaterThan(100);
    for (const c of golden.cases) expect(plain(decode(fromHex(c.hex)))).toEqual(c.expected);
  });
});
