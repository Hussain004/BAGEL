import { describe, expect, it } from 'vitest';
import type { CameraIntrinsics } from '../../src/hooks/useCameraInfo';
import { paintProjection, projectCloud } from '../../src/utils/projectCloud';

const K: CameraIntrinsics = {
  fx: 500, fy: 500, cx: 320, cy: 240, width: 640, height: 480,
  distortionCoefficients: [], distortionModel: 'plumb_bob', frameId: 'cam', timestamp: 0n,
};
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

// LiDAR frame is x forward, y left, z up; the camera optical frame is z forward, x right, y down.
// optical = (-y_lidar, -z_lidar, x_lidar). Column-major.
const LIDAR_TO_OPTICAL = [0, 0, 1, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1];

describe('projectCloud', () => {
  it('puts a point on the optical axis at the principal point, and offsets by fx * x / z', () => {
    const p = projectCloud(Float32Array.from([0, 0, 5, 1, 0, 5, 0, -1, 10]), IDENTITY, K);
    expect(p.count).toBe(3);
    expect([p.u[0], p.v[0], p.depth[0]]).toEqual([320, 240, 5]);
    expect(p.u[1]).toBeCloseTo(320 + (500 * 1) / 5, 4); // 1 m right at 5 m
    expect(p.v[2]).toBeCloseTo(240 - (500 * 1) / 10, 4); // 1 m up (y = -1) at 10 m
  });

  it('drops points behind the camera, closer than minDepth, and non-finite ones', () => {
    const p = projectCloud(Float32Array.from([0, 0, -3, 0, 0, 0.05, NaN, 0, 4, 0, 0, 4]), IDENTITY, K);
    expect(p.total).toBe(4);
    expect(p.inFront).toBe(1);
    expect(p.count).toBe(1);
  });

  it('drops points that fall outside the frame but counts them as in front', () => {
    const p = projectCloud(Float32Array.from([50, 0, 1, 0, 0, 1]), IDENTITY, K);
    expect(p.inFront).toBe(2);
    expect(p.count).toBe(1);
  });

  it('applies a lidar-to-optical extrinsic: a point 10 m ahead and 1 m left lands left of centre', () => {
    const p = projectCloud(Float32Array.from([10, 1, 0]), LIDAR_TO_OPTICAL, K);
    expect(p.u[0]).toBeCloseTo(320 - 50, 4);
    expect(p.v[0]).toBeCloseTo(240, 4);
    expect(p.depth[0]).toBeCloseTo(10, 4);
  });

  it('applies a translation: a camera mounted 0.5 m above the lidar sees the point lower in the image', () => {
    // optical = R * lidar + t, with the camera 0.5 m up in the lidar frame: t_y(optical, down) = +0.5.
    const m = [...LIDAR_TO_OPTICAL];
    m[13] = 0.5;
    const p = projectCloud(Float32Array.from([10, 0, 0]), m, K);
    expect(p.v[0]).toBeCloseTo(240 + (500 * 0.5) / 10, 4);
  });

  it('applies lens distortion in the forward direction and skips it for a rectified view', () => {
    const k1 = -0.2;
    const ci = { ...K, distortionCoefficients: [k1, 0, 0, 0, 0] };
    const pt = Float32Array.from([2, 0, 4]); // normalised x = 0.5, r2 = 0.25
    const distorted = projectCloud(pt, IDENTITY, ci);
    expect(distorted.u[0]).toBeCloseTo(320 + 500 * 0.5 * (1 + k1 * 0.25), 4);
    const rectified = projectCloud(pt, IDENTITY, ci, { rectified: true });
    expect(rectified.u[0]).toBeCloseTo(320 + 250, 4);
  });

  it('includes the tangential terms', () => {
    const ci = { ...K, distortionCoefficients: [0, 0, 0.01, 0.02, 0] };
    const pt = Float32Array.from([2, 1, 4]); // nx 0.5, ny 0.25
    const r2 = 0.25 + 0.0625;
    const dx = 2 * 0.01 * 0.5 * 0.25 + 0.02 * (r2 + 2 * 0.25);
    const dy = 0.01 * (r2 + 2 * 0.0625) + 2 * 0.02 * 0.5 * 0.25;
    const p = projectCloud(pt, IDENTITY, ci);
    expect(p.u[0]).toBeCloseTo(320 + 500 * (0.5 + dx), 4);
    expect(p.v[0]).toBeCloseTo(240 + 500 * (0.25 + dy), 4);
  });

  it('ignores a distortion model it cannot evaluate rather than guessing', () => {
    const ci = { ...K, distortionModel: 'equidistant', distortionCoefficients: [0.5, 0.5, 0, 0, 0] };
    expect(projectCloud(Float32Array.from([2, 0, 4]), IDENTITY, ci).u[0]).toBeCloseTo(570, 4);
  });

  it('scales pixel coordinates when the stream is a uniform resize of the calibrated size', () => {
    const p = projectCloud(Float32Array.from([1, 0, 5]), IDENTITY, K, { imageWidth: 320, imageHeight: 240 });
    expect(p.u[0]).toBeCloseTo((320 + 100) / 2, 4);
    expect(p.v[0]).toBeCloseTo(120, 4);
  });

  it('handles an empty cloud', () => {
    const p = projectCloud(new Float32Array(0), IDENTITY, K);
    expect([p.count, p.total, p.inFront]).toEqual([0, 0, 0]);
  });
});

describe('paintProjection', () => {
  it('draws far points first so near points end up on top', () => {
    const calls: Array<{ fill: string; x: number }> = [];
    let fill = '';
    const ctx = {
      set fillStyle(v: string) { fill = v; },
      fillRect: (x: number) => calls.push({ fill, x }),
    } as unknown as CanvasRenderingContext2D;
    const pts = projectCloud(Float32Array.from([0, 0, 20, 1, 0, 2, 2, 0, 11]), IDENTITY, K);
    paintProjection(ctx, pts, 2);
    expect(calls).toHaveLength(3);
    // x offset grows with 1/depth: the 2 m point (largest x) must be drawn last.
    const xs = calls.map((c) => c.x);
    expect(xs[xs.length - 1]).toBe(Math.max(...xs));
  });
});
