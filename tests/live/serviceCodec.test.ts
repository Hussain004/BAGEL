import { describe, expect, it } from 'vitest';
import { decodeResponse, encodeRequest, skeletonFor, toJson } from '../../src/live/serviceCodec';
import { normalizeService, type FoxgloveService } from '../../src/live/foxgloveClient';
import { MessageReader as Ros2Reader, MessageWriter as Ros2Writer } from '@foxglove/rosmsg2-serialization';
import { parse } from '@foxglove/rosmsg';

const RULE = '='.repeat(80);
const SET_POSE = `string frame\nfloat64[3] xyz\nint32[] ids\nbool fast\nPose2D pose\nPose2D[] path\nuint8 mode 3\n${RULE}\nMSG: geometry_msgs/Pose2D\nfloat64 x\nfloat64 y\nfloat64 theta`;

const svc = (over: Partial<FoxgloveService> = {}): FoxgloveService => ({
  id: 1, name: '/set_pose', type: 'demo/srv/SetPose',
  requestSchema: SET_POSE, requestEncoding: 'cdr', responseSchema: 'bool success\nstring message', responseEncoding: 'cdr', schemaEncoding: 'ros2msg', ...over,
});

/** The reader returns typed arrays for numeric arrays; compare by value. */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (ArrayBuffer.isView(x) ? Array.from(x as unknown as ArrayLike<number>) : x)));

describe('skeletonFor', () => {
  it('zeroes every field, fills fixed arrays, nests complex types and honours defaults', () => {
    expect(skeletonFor(SET_POSE)).toEqual({
      frame: '', xyz: [0, 0, 0], ids: [], fast: false, pose: { x: 0, y: 0, theta: 0 }, path: [], mode: 3,
    });
  });
  it('an empty schema (std_srvs/Empty) is an empty request', () => {
    expect(skeletonFor('')).toEqual({});
    expect(skeletonFor('  \n')).toEqual({});
  });
  it('skips constants and survives a type that refers to itself', () => {
    expect(skeletonFor('uint8 FLAG=1\nint32 value')).toEqual({ value: 0 });
    const loop = `Node next\n${RULE}\nMSG: pkg/Node\nNode next\nint32 v`;
    expect(() => skeletonFor(loop)).not.toThrow();
  });
});

describe('request and response encodings', () => {
  it('CDR request is readable by the standard reader with the same values', () => {
    const req = { frame: 'map', xyz: [1, 2, 3], ids: [4, 5], fast: true, pose: { x: 1.5, y: -2, theta: 0.25 }, path: [{ x: 1, y: 2, theta: 3 }], mode: 7 };
    const { encoding, payload } = encodeRequest(svc(), req);
    expect(encoding).toBe('cdr');
    expect(plain(new Ros2Reader(parse(SET_POSE, { ros2: true })).readMessage(payload))).toEqual(req);
  });

  it('round-trips a skeleton exactly', () => {
    const sk = skeletonFor(SET_POSE);
    const { payload } = encodeRequest(svc(), sk);
    expect(plain(new Ros2Reader(parse(SET_POSE, { ros2: true })).readMessage(payload))).toEqual(sk);
  });

  it('an empty CDR request still has its header, and an empty ROS 1 request has no bytes', () => {
    expect(encodeRequest(svc({ requestSchema: '' }), {}).payload.length).toBeGreaterThanOrEqual(4);
    expect(encodeRequest(svc({ requestSchema: '', requestEncoding: 'ros1' }), {}).payload).toHaveLength(0);
  });

  it('JSON requests are plain JSON', () => {
    const { encoding, payload } = encodeRequest(svc({ requestEncoding: 'json' }), { a: 1 });
    expect(encoding).toBe('json');
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({ a: 1 });
  });

  it('ROS 1 requests are written with the ROS 1 serialiser', () => {
    const s = svc({ requestEncoding: 'ros1', requestSchema: 'int32 a\nstring b', schemaEncoding: 'ros1msg' });
    const { payload } = encodeRequest(s, { a: 5, b: 'hi' });
    expect(Array.from(payload)).toEqual([5, 0, 0, 0, 2, 0, 0, 0, 0x68, 0x69]);
  });

  it('refuses an encoding it cannot write, and says which', () => {
    expect(() => encodeRequest(svc({ requestEncoding: 'protobuf' }), {})).toThrow(/protobuf/);
  });

  it('a request that does not match its schema fails with an error rather than sending garbage', () => {
    expect(() => encodeRequest(svc(), { frame: 5, xyz: 'no' })).toThrow();
  });

  it('decodes CDR and JSON responses', () => {
    const resp = new Ros2Writer(parse('bool success\nstring message', { ros2: true })).writeMessage({ success: true, message: 'ok' });
    expect(decodeResponse(svc(), 'cdr', resp)).toEqual({ success: true, message: 'ok' });
    expect(decodeResponse(svc(), 'json', new TextEncoder().encode('{"success":false}'))).toEqual({ success: false });
    expect(() => decodeResponse(svc(), 'protobuf', new Uint8Array(1))).toThrow(/protobuf/);
    expect(decodeResponse(svc({ responseSchema: '' }), 'cdr', new Uint8Array(4))).toEqual({});
  });

  it('toJson prints bigints and typed arrays', () => {
    expect(JSON.parse(toJson({ n: 12345678901234567890n, d: new Uint8Array([1, 2]) }))).toEqual({ n: '12345678901234567890', d: [1, 2] });
  });
});

describe('normalizeService', () => {
  it('reads the nested request/response form', () => {
    const s = normalizeService({ id: 3, name: '/a', type: 'x/srv/A', request: { encoding: 'cdr', schemaEncoding: 'ros2msg', schema: 'int32 a' }, response: { encoding: 'cdr', schema: 'bool ok' } });
    expect(s).toMatchObject({ id: 3, requestSchema: 'int32 a', responseSchema: 'bool ok', requestEncoding: 'cdr', responseEncoding: 'cdr', schemaEncoding: 'ros2msg' });
  });
  it('reads the older flat form and defaults the encoding to JSON', () => {
    const s = normalizeService({ id: 4, name: '/b', type: 'x/B', requestSchema: 'int32 a', responseSchema: 'int32 b' });
    expect(s).toMatchObject({ requestSchema: 'int32 a', responseSchema: 'int32 b', requestEncoding: 'json', responseEncoding: 'json' });
  });
});
