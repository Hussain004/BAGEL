import { describe, expect, it } from 'vitest';
import { extractBoxes, MAX_BOXES } from '../../src/components/panels/ThreeDScene/boxObjects';
import { isDetection3DArrayType, isPathLikeType, is3DCapableType } from '../../src/utils/messages';
import { detectKind } from '../../src/components/panels/ThreeDScene/sceneKind';
import { panelOptionsFor, suggestPanelKind } from '../../src/utils/panelOptions';

const det = (x: number, y: number, z: number, sx: number, sy: number, sz: number, q = { x: 0, y: 0, z: 0, w: 1 }, cls = 'car') => ({
  bbox: { center: { position: { x, y, z }, orientation: q }, size: { x: sx, y: sy, z: sz } },
  results: [{ hypothesis: { class_id: cls, score: 0.9 } }],
});

function extent(positions: Float32Array) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, positions[i + k]!);
      max[k] = Math.max(max[k]!, positions[i + k]!);
    }
  }
  return { min, max };
}

describe('extractBoxes', () => {
  it('makes 12 edges per box spanning the size around the centre', () => {
    const { positions, colors } = extractBoxes({ detections: [det(10, 0, 1, 4, 2, 1.5)] });
    expect(positions.length).toBe(24 * 3);
    expect(colors).toHaveLength(1);
    const { min, max } = extent(positions);
    expect(min).toEqual([8, -1, 0.25]);
    expect(max).toEqual([12, 1, 1.75]);
  });

  it('applies the orientation: a 90 degree yaw swaps the x and y extents', () => {
    const s = Math.SQRT1_2;
    const { positions } = extractBoxes({ detections: [det(0, 0, 0, 4, 2, 1, { x: 0, y: 0, z: s, w: s })] });
    const { min, max } = extent(positions);
    expect(min[0]).toBeCloseTo(-1);
    expect(max[0]).toBeCloseTo(1);
    expect(min[1]).toBeCloseTo(-2);
    expect(max[1]).toBeCloseTo(2);
  });

  it('treats an all-zero orientation as no rotation instead of producing NaNs', () => {
    const { positions } = extractBoxes({ detections: [det(0, 0, 0, 2, 2, 2, { x: 0, y: 0, z: 0, w: 0 })] });
    expect([...positions].every(Number.isFinite)).toBe(true);
    expect(extent(positions).max).toEqual([1, 1, 1]);
  });

  it('skips boxes with a missing, zero or non-finite size or position, and keeps the rest', () => {
    const bad = [
      det(0, 0, 0, 0, 1, 1),
      det(0, 0, 0, NaN, 1, 1),
      det(NaN, 0, 0, 1, 1, 1),
      { results: [] },
      null,
      { bbox: { center: {}, size: { x: 1, y: 1, z: 1 } } },
    ];
    const { positions, colors } = extractBoxes({ detections: [...bad, det(1, 1, 1, 1, 1, 1)] });
    expect(colors).toHaveLength(1);
    expect(positions).toHaveLength(72);
  });

  it('colours by class: same class same colour, and different classes differ', () => {
    const { colors } = extractBoxes({ detections: [det(0, 0, 0, 1, 1, 1, undefined, 'car'), det(5, 0, 0, 1, 1, 1, undefined, 'car'), det(9, 0, 0, 1, 1, 1, undefined, 'person')] });
    expect(colors[0]).toBe(colors[1]);
    expect(colors[0]).not.toBe(colors[2]);
  });

  it('reads the older results shape (results[].id) too', () => {
    const old = { bbox: { center: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }, size: { x: 1, y: 1, z: 1 } }, results: [{ id: 3, score: 0.5 }] };
    expect(extractBoxes({ detections: [old] }).colors).toHaveLength(1);
  });

  it('caps a runaway message, and survives empty or malformed input', () => {
    const many = Array.from({ length: MAX_BOXES + 500 }, (_, i) => det(i, 0, 0, 1, 1, 1));
    expect(extractBoxes({ detections: many }).colors).toHaveLength(MAX_BOXES);
    for (const m of [{}, null, undefined, { detections: 'x' }, { detections: [] }]) {
      expect(extractBoxes(m as never).positions).toHaveLength(0);
    }
  });
});

describe('Detection3DArray routing', () => {
  it('is recognised in both spellings and goes to the 3D scene as a path-like kind', () => {
    for (const t of ['vision_msgs/Detection3DArray', 'vision_msgs/msg/Detection3DArray']) {
      expect(isDetection3DArrayType(t)).toBe(true);
      expect(isPathLikeType(t)).toBe(true);
      expect(is3DCapableType(t)).toBe(true);
      expect(detectKind(t)).toBe('path');
      expect(suggestPanelKind({ name: '/d', type: t, messageCount: 1, serializationFormat: 'cdr' })).toBe('3d');
      expect(panelOptionsFor({ name: '/d', type: t, messageCount: 1, serializationFormat: 'cdr' })).toEqual(['3d', 'raw']);
    }
    expect(isDetection3DArrayType('vision_msgs/msg/Detection2DArray')).toBe(false);
  });
});
