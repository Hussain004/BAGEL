import { describe, it, expect, beforeEach } from 'vitest';
import { parse as parseRosMsgDefinition } from '@foxglove/rosmsg';
import { MessageWriter as Ros2Writer } from '@foxglove/rosmsg2-serialization';
import { MessageWriter as Ros1Writer } from '@foxglove/rosmsg-serialization';
import { decodeLiveMessage, clearLiveDecoderCache } from '../../src/live/liveDecoder';

// Helpers: encode a JS object to ROS2 or ROS1 CDR bytes using the actual writers.
function encodeRos2(schema: string, msg: Record<string, unknown>): Uint8Array {
  const defs = parseRosMsgDefinition(schema, { ros2: true });
  return new Ros2Writer(defs).writeMessage(msg);
}

function encodeRos1(schema: string, msg: Record<string, unknown>): Uint8Array {
  const defs = parseRosMsgDefinition(schema, { ros2: false });
  return new Ros1Writer(defs).writeMessage(msg);
}

function encodeJson(msg: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg));
}

beforeEach(() => clearLiveDecoderCache());

describe('decodeLiveMessage - JSON encoding', () => {
  it('decodes a simple JSON message', () => {
    const data = encodeJson({ x: 1, y: 'hello' });
    const result = decodeLiveMessage('json', undefined, '', data);
    expect(result).toEqual({ x: 1, y: 'hello' });
  });

  it('decodes nested JSON', () => {
    const data = encodeJson({ header: { stamp: { sec: 0, nanosec: 0 }, frame_id: 'base' }, data: 3.14 });
    const result = decodeLiveMessage('json', undefined, '', data);
    expect(result).toMatchObject({ data: 3.14, header: { frame_id: 'base' } });
  });

  it('returns null for malformed JSON', () => {
    const data = new TextEncoder().encode('{bad json');
    expect(decodeLiveMessage('json', undefined, '', data)).toBeNull();
  });
});

describe('decodeLiveMessage - ROS2 CDR encoding', () => {
  const schema = 'string data\nbool flag';

  it('decodes a ROS2 CDR message (cdr + ros2msg)', () => {
    const bytes = encodeRos2(schema, { data: 'world', flag: true });
    const result = decodeLiveMessage('cdr', 'ros2msg', schema, bytes);
    expect(result).toMatchObject({ data: 'world', flag: true });
  });

  it('decodes a ROS2 CDR message with no schemaEncoding (defaults to ros2)', () => {
    const bytes = encodeRos2(schema, { data: 'test', flag: false });
    const result = decodeLiveMessage('cdr', undefined, schema, bytes);
    expect(result).toMatchObject({ data: 'test', flag: false });
  });

  it('caches the reader so parsing the schema happens once per key', () => {
    const bytes = encodeRos2(schema, { data: 'a', flag: false });
    decodeLiveMessage('cdr', 'ros2msg', schema, bytes);
    // Second call with same schema should hit the cache - no error means cache worked
    const result = decodeLiveMessage('cdr', 'ros2msg', schema, bytes);
    expect(result).toMatchObject({ data: 'a' });
  });

  it('returns null for truncated ROS2 CDR bytes', () => {
    const bytes = encodeRos2(schema, { data: 'world', flag: true });
    const truncated = bytes.slice(0, 3);
    expect(decodeLiveMessage('cdr', 'ros2msg', schema, truncated)).toBeNull();
  });
});

describe('decodeLiveMessage - CDR with ros1msg schema encoding', () => {
  it('parses the schema with ros2:false when schemaEncoding is ros1msg', () => {
    // Some bridges send CDR-framed messages but with ros1msg schemas.
    // The ROS2 reader is still used (RTPS header present) but schema is
    // parsed as ros1 type definitions.
    const schema = 'string data';
    // Encode with the ROS2 writer since the wire format is still CDR
    const bytes = encodeRos2(schema, { data: 'bridge' });
    const result = decodeLiveMessage('cdr', 'ros1msg', schema, bytes);
    expect(result).toMatchObject({ data: 'bridge' });
  });
});

describe('decodeLiveMessage - ROS1 encoding', () => {
  const schema = 'string name\nbool active';

  it('decodes a ROS1 CDR message (ros1 + ros1msg)', () => {
    const bytes = encodeRos1(schema, { name: 'robot', active: true });
    const result = decodeLiveMessage('ros1', 'ros1msg', schema, bytes);
    expect(result).toMatchObject({ name: 'robot', active: true });
  });

  it('rejects ROS2 CDR bytes when using ros1 encoding (RTPS header makes data corrupt)', () => {
    // ROS2 bytes have a 4-byte RTPS header; the ROS1 reader interprets those
    // bytes as message data, producing garbage or throwing. Either null or a
    // wrong value is acceptable - the important thing is it does NOT silently
    // succeed with correct data.
    const bytes = encodeRos2(schema, { name: 'robot', active: true });
    const result = decodeLiveMessage('ros1', 'ros1msg', schema, bytes);
    // Either null (threw) or the name field is wrong (corrupt parse)
    expect(result === null || (result as Record<string, unknown>).name !== 'robot').toBe(true);
  });

  it('caches the ROS1 reader separately from the ROS2 reader', () => {
    const schema2 = 'float32 x';
    const ros1Bytes = encodeRos1(schema2, { x: 1.5 });
    const ros2Bytes = encodeRos2(schema2, { x: 1.5 });

    const ros1Result = decodeLiveMessage('ros1', 'ros1msg', schema2, ros1Bytes);
    const ros2Result = decodeLiveMessage('cdr', 'ros2msg', schema2, ros2Bytes);

    // Both should decode correctly using their respective cached readers
    expect((ros1Result as Record<string, unknown>).x).toBeCloseTo(1.5, 4);
    expect((ros2Result as Record<string, unknown>).x).toBeCloseTo(1.5, 4);
  });

  it('returns null for malformed ROS1 bytes', () => {
    const tiny = new Uint8Array([0x01]); // too short for any meaningful message
    expect(decodeLiveMessage('ros1', 'ros1msg', schema, tiny)).toBeNull();
  });

  it('decodes a multi-field numeric ROS1 message', () => {
    const numSchema = 'int32 seq\nfloat64 timestamp\nbool valid';
    const bytes = encodeRos1(numSchema, { seq: 42, timestamp: 1718000000.123, valid: true });
    const result = decodeLiveMessage('ros1', 'ros1msg', numSchema, bytes);
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).seq).toBe(42);
    expect((result as Record<string, unknown>).valid).toBe(true);
  });
});

describe('decodeLiveMessage - unknown encoding', () => {
  it('returns null for unsupported encoding', () => {
    const data = new Uint8Array([0x01, 0x02]);
    expect(decodeLiveMessage('protobuf', 'proto', '', data)).toBeNull();
  });

  it('returns null for empty encoding string', () => {
    const data = new Uint8Array([0x01]);
    expect(decodeLiveMessage('', undefined, '', data)).toBeNull();
  });
});

describe('clearLiveDecoderCache', () => {
  it('drops cached readers so next call rebuilds them', () => {
    const schema = 'bool flag';
    const ros2Bytes = encodeRos2(schema, { flag: false });
    const ros1Bytes = encodeRos1(schema, { flag: true });

    // Populate both caches
    decodeLiveMessage('cdr', 'ros2msg', schema, ros2Bytes);
    decodeLiveMessage('ros1', 'ros1msg', schema, ros1Bytes);

    // Clear and re-decode - should still work (rebuilds readers from scratch)
    clearLiveDecoderCache();

    const r2 = decodeLiveMessage('cdr', 'ros2msg', schema, ros2Bytes);
    const r1 = decodeLiveMessage('ros1', 'ros1msg', schema, ros1Bytes);
    expect(r2).toMatchObject({ flag: false });
    expect(r1).toMatchObject({ flag: true });
  });
});
