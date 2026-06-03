/**
 * Tests for the v1.3.2 camera frustum geometry builder.
 *
 * The Three.js `LineSegments` lifecycle wrapper around `buildFrustumPositions`
 * is exercised through the panel; here we cover the math so a future fx / fy
 * convention slip (say, swapping fx and fy by accident) fails CI with a
 * crisp number-mismatch instead of an "off-axis frustum" bug report.
 */

import { describe, it, expect } from 'vitest';
import { buildFrustumPositions } from '../../src/components/panels/ThreeDScene/cameraFrustum';
import type { CameraIntrinsics } from '../../src/hooks/useCameraInfo';

const baseIntrinsics: CameraIntrinsics = {
  fx: 525,
  fy: 525,
  cx: 320,
  cy: 240,
  width: 640,
  height: 480,
  distortionCoefficients: [0, 0, 0, 0, 0],
  distortionModel: 'plumb_bob',
  frameId: 'cam_optical',
  timestamp: 0n,
};

describe('buildFrustumPositions', () => {
  it('produces 16 vertices (8 line segments x 2 endpoints) at 3 coords each', () => {
    const positions = buildFrustumPositions(baseIntrinsics, 5);
    expect(positions.length).toBe(16 * 3);
  });

  it('places the apex at the camera origin (every 1st endpoint of the first 4 segments)', () => {
    const positions = buildFrustumPositions(baseIntrinsics, 5);
    // Segments 0-3 are apex-to-corner; each starts at (0, 0, 0).
    for (let seg = 0; seg < 4; seg++) {
      const base = seg * 6;
      expect(positions[base]).toBe(0);
      expect(positions[base + 1]).toBe(0);
      expect(positions[base + 2]).toBe(0);
    }
  });

  it('matches (width / fx, height / fy) at z = 1 m for a centred principal point', () => {
    // Symmetric principal point: cx = width/2, cy = height/2 -> the full
    // far-plane width / height equals width/fx and height/fy respectively.
    const positions = buildFrustumPositions(baseIntrinsics, 1);
    // The 4 far corners follow the apex-to-corner segments (second endpoint
    // of each), and re-appear in the connecting edge segments. Pull the
    // x / y extents from the first 4 segments.
    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let seg = 0; seg < 4; seg++) {
      const x = positions[seg * 6 + 3];
      const y = positions[seg * 6 + 4];
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
    const fullWidth = xMax - xMin;
    const fullHeight = yMax - yMin;
    expect(fullWidth).toBeCloseTo(baseIntrinsics.width / baseIntrinsics.fx, 6);
    expect(fullHeight).toBeCloseTo(baseIntrinsics.height / baseIntrinsics.fy, 6);
  });

  it('scales linearly with the far plane distance', () => {
    const pos1 = buildFrustumPositions(baseIntrinsics, 1);
    const pos5 = buildFrustumPositions(baseIntrinsics, 5);
    // The far-plane TL corner is segment 0's second endpoint.
    // pos[3..5] = TL at z=1; pos5[3..5] = TL at z=5.
    expect(pos5[3] / pos1[3]).toBeCloseTo(5, 6);
    expect(pos5[4] / pos1[4]).toBeCloseTo(5, 6);
    expect(pos5[5] / pos1[5]).toBeCloseTo(5, 6);
  });

  it('offsets the frustum when the principal point is not centred', () => {
    // Principal point at (200, 120) on a 640x480 image -> the frustum
    // extends further to the +X side than to the -X side.
    const offset: CameraIntrinsics = { ...baseIntrinsics, cx: 200, cy: 120 };
    const positions = buildFrustumPositions(offset, 1);
    // TL corner at z=1: x = -cx/fx = -200/525, y = -cy/fy = -120/525
    expect(positions[3]).toBeCloseTo(-200 / 525, 6);
    expect(positions[4]).toBeCloseTo(-120 / 525, 6);
    // TR corner at z=1: x = (width-cx)/fx = 440/525
    expect(positions[9]).toBeCloseTo(440 / 525, 6);
    expect(positions[10]).toBeCloseTo(-120 / 525, 6);
  });

  it('clamps a non-positive far plane to a small positive value', () => {
    // The wrapper guards against a zero / negative slider that would
    // collapse the geometry into a degenerate line at the origin.
    const positions = buildFrustumPositions(baseIntrinsics, 0);
    // Far-plane z should be > 0 (we use 0.001 as the floor).
    expect(positions[5]).toBeGreaterThan(0);
    expect(positions[5]).toBeLessThanOrEqual(0.01);
  });
});
