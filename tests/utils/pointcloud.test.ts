import { describe, it, expect } from 'vitest';
import {
  decodePointCloud2,
  heightAxisToReader,
  heightRangeForAxis,
  turboColor,
  POINT_FIELD_TYPE,
  type PointCloud2Message,
  type PointField,
} from '../../src/utils/pointcloud';

/**
 * Build a PointCloud2 buffer where x/y/z are FLOAT32 (the fast-path layout).
 * Each point row is [x, y, z] little-endian. Returned message includes the
 * minimum metadata the decoder reads.
 */
function buildFloat32Cloud(points: number[][]): PointCloud2Message {
  const pointStep = 12;
  const data = new Uint8Array(points.length * pointStep);
  const view = new DataView(data.buffer);
  for (let i = 0; i < points.length; i++) {
    view.setFloat32(i * pointStep + 0, points[i][0], true);
    view.setFloat32(i * pointStep + 4, points[i][1], true);
    view.setFloat32(i * pointStep + 8, points[i][2], true);
  }
  const fields: PointField[] = [
    { name: 'x', offset: 0, datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 },
    { name: 'y', offset: 4, datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 },
    { name: 'z', offset: 8, datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 },
  ];
  return {
    header: { frame_id: 'velodyne' },
    width: points.length,
    height: 1,
    fields,
    point_step: pointStep,
    row_step: points.length * pointStep,
    data,
    is_bigendian: false,
    is_dense: true,
  };
}

/**
 * Build a PointCloud2 buffer where x/y/z are FLOAT64 (forces the DataView
 * slow path). Same layout otherwise.
 */
function buildFloat64Cloud(points: number[][]): PointCloud2Message {
  const pointStep = 24;
  const data = new Uint8Array(points.length * pointStep);
  const view = new DataView(data.buffer);
  for (let i = 0; i < points.length; i++) {
    view.setFloat64(i * pointStep + 0, points[i][0], true);
    view.setFloat64(i * pointStep + 8, points[i][1], true);
    view.setFloat64(i * pointStep + 16, points[i][2], true);
  }
  const fields: PointField[] = [
    { name: 'x', offset: 0, datatype: POINT_FIELD_TYPE.FLOAT64, count: 1 },
    { name: 'y', offset: 8, datatype: POINT_FIELD_TYPE.FLOAT64, count: 1 },
    { name: 'z', offset: 16, datatype: POINT_FIELD_TYPE.FLOAT64, count: 1 },
  ];
  return {
    header: { frame_id: 'velodyne' },
    width: points.length,
    height: 1,
    fields,
    point_step: pointStep,
    row_step: points.length * pointStep,
    data,
    is_bigendian: false,
    is_dense: true,
  };
}

describe('pointcloud/decodePointCloud2 — FLOAT32 fast path', () => {
  it('decodes positions exactly for a small known cloud', () => {
    const msg = buildFloat32Cloud([
      [0, 0, 0],
      [1, 2, 3],
      [-1, 0.5, -0.5],
    ]);
    const decoded = decodePointCloud2(msg);
    expect(decoded).not.toBeNull();
    expect(decoded!.pointCount).toBe(3);
    expect(Array.from(decoded!.positions)).toEqual([0, 0, 0, 1, 2, 3, -1, 0.5, -0.5]);
  });

  it('reports correct AABB bounds across the input', () => {
    const decoded = decodePointCloud2(
      buildFloat32Cloud([
        [0, 0, 0],
        [5, 10, -2],
      ]),
    );
    expect(decoded!.bounds).toEqual({
      min: { x: 0, y: 0, z: -2 },
      max: { x: 5, y: 10, z: 0 },
    });
  });

  it('drops NaN / Infinity returns silently', () => {
    const decoded = decodePointCloud2(
      buildFloat32Cloud([
        [0, 0, 0],
        [NaN, 1, 1],
        [Infinity, 0, 0],
        [2, 2, 2],
      ]),
    );
    expect(decoded!.pointCount).toBe(2);
    expect(Array.from(decoded!.positions)).toEqual([0, 0, 0, 2, 2, 2]);
  });

  it('drops returns with absurd magnitudes (>1e4) — Velodyne sentinel guard', () => {
    const decoded = decodePointCloud2(
      buildFloat32Cloud([
        [0, 0, 0],
        [1e5, 0, 0],
        [0, -1e5, 0],
      ]),
    );
    expect(decoded!.pointCount).toBe(1);
  });

  it('honours maxRange (Euclidean cap, applied before bounds + colour)', () => {
    const decoded = decodePointCloud2(
      buildFloat32Cloud([
        [0, 0, 0], // r=0 keep
        [10, 0, 0], // r=10 drop
        [3, 4, 0], // r=5 keep
      ]),
      { maxRange: 6 },
    );
    expect(decoded!.pointCount).toBe(2);
    expect(decoded!.bounds!.max.x).toBe(3);
  });

  it('reports the source frame_id', () => {
    const decoded = decodePointCloud2(buildFloat32Cloud([[0, 0, 0]]));
    expect(decoded!.frameId).toBe('velodyne');
  });

  it('returns null when the message has no x/y/z fields', () => {
    const decoded = decodePointCloud2({
      width: 1,
      height: 1,
      point_step: 4,
      data: new Uint8Array(4),
      fields: [
        { name: 'intensity', offset: 0, datatype: POINT_FIELD_TYPE.FLOAT32, count: 1 },
      ],
    });
    expect(decoded).toBeNull();
  });

  it('returns null when the message lacks data or point_step', () => {
    expect(decodePointCloud2({ fields: [] })).toBeNull();
    expect(
      decodePointCloud2({
        fields: [
          { name: 'x', offset: 0, datatype: 7, count: 1 },
          { name: 'y', offset: 4, datatype: 7, count: 1 },
          { name: 'z', offset: 8, datatype: 7, count: 1 },
        ],
        point_step: 0,
        data: new Uint8Array(12),
      }),
    ).toBeNull();
  });

  it('reuses the supplied output buffers when the size matches', () => {
    const positions = new Float32Array(9);
    const colors = new Float32Array(9);
    const decoded = decodePointCloud2(
      buildFloat32Cloud([
        [0, 0, 0],
        [1, 1, 1],
        [2, 2, 2],
      ]),
      { reuse: { positions, colors } },
    );
    // The decoder is allowed to slice when fewer points decode than allocated,
    // but with a stable size + no rejections it should reuse the buffer.
    expect(decoded!.positions).toBe(positions);
  });
});

describe('pointcloud/decodePointCloud2 — slow path (FLOAT64)', () => {
  it('produces identical positions to the fast path for the same inputs', () => {
    const inputs = [
      [0, 0, 0],
      [-3.5, 2.25, 0.125],
      [10, -10, 1],
    ];
    const fast = decodePointCloud2(buildFloat32Cloud(inputs));
    const slow = decodePointCloud2(buildFloat64Cloud(inputs));
    expect(slow!.pointCount).toBe(fast!.pointCount);
    // FLOAT32 inputs went through Float32 rounding, FLOAT64 didn't. Compare
    // within a tight tolerance to absorb the 32-bit quantisation.
    for (let i = 0; i < slow!.positions.length; i++) {
      expect(slow!.positions[i]).toBeCloseTo(fast!.positions[i], 5);
    }
  });
});

describe('pointcloud/Turbo colormap helpers', () => {
  it('turboColor endpoints differ and high-end is dominated by red', () => {
    const lo = turboColor(0);
    const hi = turboColor(1);
    // The exact start-of-LUT colour comes from the polynomial's constant
    // terms (R≈0.14, G≈0.09, B≈0.11) — close to dark muddy purple, not the
    // pure deep blue the Turbo paper poster shows. Don't lock in the start
    // colour; just assert the two ends are clearly distinct and the high
    // end is the red-dominant one a user expects from a Turbo gradient.
    expect(hi.r).toBeGreaterThan(hi.b);
    expect(hi.r).toBeGreaterThan(hi.g);
    const dist = Math.hypot(hi.r - lo.r, hi.g - lo.g, hi.b - lo.b);
    // The Turbo polynomial evaluated at t=1 stops around (0.57, 0.06, 0)
    // — distance from t=0 (≈0.14, 0.09, 0.11) is ~0.44. Use a loose
    // floor to assert "they're clearly different" without locking the LUT.
    expect(dist).toBeGreaterThan(0.3);
  });

  it('turboColor clamps out-of-range values', () => {
    expect(turboColor(-1)).toEqual(turboColor(0));
    expect(turboColor(2)).toEqual(turboColor(1));
  });

  it('heightAxisToReader decodes every axis variant', () => {
    expect(heightAxisToReader('+x')).toEqual({ offset: 0, sign: 1 });
    expect(heightAxisToReader('-x')).toEqual({ offset: 0, sign: -1 });
    expect(heightAxisToReader('+y')).toEqual({ offset: 1, sign: 1 });
    expect(heightAxisToReader('-y')).toEqual({ offset: 1, sign: -1 });
    expect(heightAxisToReader('+z')).toEqual({ offset: 2, sign: 1 });
    expect(heightAxisToReader('-z')).toEqual({ offset: 2, sign: -1 });
  });

  it('heightRangeForAxis inverts bounds when sign is negative', () => {
    const bounds = {
      min: { x: -1, y: -2, z: 0 },
      max: { x: 5, y: 10, z: 3 },
    };
    // Use individual property assertions instead of toEqual so the test
    // doesn't trip on JS's -0 vs +0 distinction (which surfaces when the
    // negation produces -0 from a 0-valued bound).
    const posZ = heightRangeForAxis('+z', bounds);
    expect(posZ.min).toBe(0);
    expect(posZ.max).toBe(3);
    const negZ = heightRangeForAxis('-z', bounds);
    expect(negZ.min).toBe(-3);
    // `Object.is` treats +0 and -0 as distinct, so use a numeric equality
    // check against 0 (covers both via the IEEE-754 `==` rule).
    expect(Math.abs(negZ.max)).toBe(0);
    const posX = heightRangeForAxis('+x', bounds);
    expect(posX.min).toBe(-1);
    expect(posX.max).toBe(5);
    const negY = heightRangeForAxis('-y', bounds);
    expect(negY.min).toBe(-10);
    expect(negY.max).toBe(2);
  });
});
