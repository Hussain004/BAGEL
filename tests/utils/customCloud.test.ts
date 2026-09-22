/**
 * Tests for the list-of-structs point cloud decoder (customCloud.ts).
 *
 * Exercises:
 *  - Basic decode of a `points: []` message into positions/colors.
 *  - maxPoints edge cases (0 / 1): a zero cap must not stride to Infinity
 *    and write into a zero-length buffer.
 *  - The re-exported type predicate matches messages.ts's canonical
 *    (narrow) isCustomLidarType so the two modules can't drift.
 */

import { describe, it, expect } from 'vitest';
import {
  decodeCustomCloud,
  isCustomLidarType,
  looksLikeCustomCloud,
} from '../../src/utils/customCloud';
import {
  isCustomLidarCapableType,
  isCustomLidarType as messagesIsCustomLidarType,
} from '../../src/utils/messages';

function buildCloud(points: number[][]): Record<string, unknown> {
  return {
    header: { frame_id: 'livox' },
    points: points.map(([x, y, z]) => ({ x, y, z, reflectivity: 42 })),
  };
}

const FOUR = () =>
  buildCloud([
    [0, 0, 0],
    [1, 1, 1],
    [2, 2, 2],
    [3, 3, 3],
  ]);

describe('customCloud/decodeCustomCloud', () => {
  it('decodes positions for a list-of-structs cloud', () => {
    const decoded = decodeCustomCloud(buildCloud([[1, 2, 3]]));
    expect(decoded).not.toBeNull();
    expect(decoded!.pointCount).toBe(1);
    expect(Array.from(decoded!.positions)).toEqual([1, 2, 3]);
    expect(decoded!.frameId).toBe('livox');
  });

  it('returns null for null / messages without points', () => {
    expect(decodeCustomCloud(null)).toBeNull();
    expect(decodeCustomCloud({})).toBeNull();
    expect(decodeCustomCloud({ points: [] })).toBeNull();
  });

  it('maxPoints: 0 falls back to the default cap (no zero-length buffer)', () => {
    // A zero cap used to give stride = Infinity and sampleCount = 0, writing
    // into zero-length Float32Arrays.
    const decoded = decodeCustomCloud(FOUR(), { maxPoints: 0 });
    expect(decoded).not.toBeNull();
    expect(decoded!.pointCount).toBe(4);
    expect(decoded!.positions).toHaveLength(12);
    expect(decoded!.colors).toHaveLength(12);
  });

  it('maxPoints: 1 decodes exactly one sampled point', () => {
    const decoded = decodeCustomCloud(FOUR(), { maxPoints: 1 });
    expect(decoded).not.toBeNull();
    expect(decoded!.pointCount).toBe(1);
    expect(Array.from(decoded!.positions)).toEqual([0, 0, 0]);
  });

  it('negative maxPoints falls back to the default cap too', () => {
    const decoded = decodeCustomCloud(FOUR(), { maxPoints: -1 });
    expect(decoded).not.toBeNull();
    expect(decoded!.pointCount).toBe(4);
  });
});

describe('customCloud/looksLikeCustomCloud', () => {
  it('recognizes a points array with numeric x/y/z', () => {
    expect(looksLikeCustomCloud(buildCloud([[0, 0, 0]]))).toBe(true);
    expect(looksLikeCustomCloud(null)).toBe(false);
    expect(looksLikeCustomCloud({ points: [] })).toBe(false);
    expect(looksLikeCustomCloud({ points: [{ x: 'a', y: 0, z: 0 }] })).toBe(false);
  });
});

describe('customCloud type predicate re-export', () => {
  it('is the same function as messages.ts (single source of truth)', () => {
    expect(isCustomLidarType).toBe(messagesIsCustomLidarType);
    expect(isCustomLidarType('livox_ros_driver2/msg/CustomMsg')).toBe(true);
    // Narrow behavior preserved at every call site: /PointCloud names need
    // the explicitly wider isCustomLidarCapableType.
    expect(isCustomLidarType('vendor_msgs/PointCloud')).toBe(false);
    expect(isCustomLidarCapableType('vendor_msgs/PointCloud')).toBe(true);
  });
});
