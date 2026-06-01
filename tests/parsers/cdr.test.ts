import { describe, it, expect, beforeEach } from 'vitest';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';
import {
  deserializeWithSchema,
  deserializeByType,
  clearReaderCache,
} from '../../src/parsers/cdr';
import { collectMessageDefinitions, flattenSchemaText } from '../fixtures/synth';

function encode(
  typeName: string,
  value: Record<string, unknown>,
): { bytes: Uint8Array; schemaText: string } {
  const definitions = collectMessageDefinitions(typeName);
  const writer = new MessageWriter(definitions);
  const bytes = writer.writeMessage(value);
  return { bytes, schemaText: flattenSchemaText(definitions) };
}

describe('cdr/deserializeWithSchema', () => {
  beforeEach(() => clearReaderCache());

  it('round-trips a geometry_msgs/Twist message', () => {
    const original = {
      linear: { x: 0.5, y: 0.0, z: 0.0 },
      angular: { x: 0.0, y: 0.0, z: 1.2 },
    };
    const { bytes, schemaText } = encode('geometry_msgs/msg/Twist', original);
    const decoded = deserializeWithSchema(schemaText, bytes);
    expect(decoded).toEqual(original);
  });

  it('round-trips a std_msgs/String', () => {
    const original = { data: 'hello bagel' };
    const { bytes, schemaText } = encode('std_msgs/msg/String', original);
    expect(deserializeWithSchema(schemaText, bytes)).toEqual(original);
  });

  it('round-trips a nested type (Odometry has pose+twist+covariance)', () => {
    const original = {
      header: { stamp: { sec: 1, nanosec: 500_000_000 }, frame_id: 'odom' },
      child_frame_id: 'base_link',
      pose: {
        pose: {
          position: { x: 1, y: 2, z: 3 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
        covariance: new Array(36).fill(0),
      },
      twist: {
        twist: {
          linear: { x: 0.5, y: 0, z: 0 },
          angular: { x: 0, y: 0, z: 0.1 },
        },
        covariance: new Array(36).fill(0),
      },
    };
    const { bytes, schemaText } = encode('nav_msgs/msg/Odometry', original);
    const decoded = deserializeWithSchema(schemaText, bytes) as typeof original;
    expect(decoded.header.frame_id).toBe('odom');
    expect(decoded.child_frame_id).toBe('base_link');
    expect(decoded.pose.pose.position).toEqual(original.pose.pose.position);
    expect(decoded.twist.twist.angular.z).toBeCloseTo(0.1, 6);
  });

  it('reuses the cached MessageReader across calls with the same schema head', () => {
    const { bytes, schemaText } = encode('std_msgs/msg/String', { data: 'a' });
    const first = deserializeWithSchema(schemaText, bytes);
    const second = deserializeWithSchema(schemaText, bytes);
    expect(first).toEqual(second);
  });
});

describe('cdr/deserializeByType', () => {
  beforeEach(() => clearReaderCache());

  it('decodes a known type via the bundled type registry', async () => {
    const { bytes } = encode('geometry_msgs/msg/Vector3', { x: 1, y: 2, z: 3 });
    const decoded = await deserializeByType('geometry_msgs/msg/Vector3', bytes);
    expect(decoded).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('returns null for an unknown type (not in registry, no schema text)', async () => {
    const decoded = await deserializeByType('my_pkg/msg/Bogus', new Uint8Array([0, 0, 0, 0]));
    expect(decoded).toBeNull();
  });

  it('caches readers keyed by type name (idempotent on repeat calls)', async () => {
    const { bytes } = encode('std_msgs/msg/Int32', { data: 42 });
    const a = await deserializeByType('std_msgs/msg/Int32', bytes);
    const b = await deserializeByType('std_msgs/msg/Int32', bytes);
    expect(a).toEqual({ data: 42 });
    expect(a).toEqual(b);
  });
});
