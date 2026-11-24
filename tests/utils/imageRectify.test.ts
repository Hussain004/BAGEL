/**
 * Tests for v1.3.4 plumb-bob undistortion utility (imageRectify.ts).
 *
 * Exercises:
 *  - lensModel names the three ROS models (and fisheye aliases), rejects others.
 *  - Equidistant and rational_polynomial forward maps match their formulas,
 *    and undistortPixel inverts every model to within a thousandth of a pixel.
 *  - buildRemapMap produces a map with the correct dimensions.
 *  - An all-zero D vector produces an identity remap (source == output).
 *  - The centre pixel always maps to itself regardless of distortion.
 *  - Non-zero distortion coefficients shift corner pixels outside bounds.
 *  - Cache returns the same object reference on a second call.
 *  - applyRemap with an identity map is a pass-through.
 *  - Out-of-bounds source pixels are filled with transparent black.
 */

import { describe, it, expect } from 'vitest';
import {
  lensModel,
  isSupportedDistortion,
  distortNormalized,
  undistortPixel,
  buildRemapMap,
  applyRemap,
} from '../../src/utils/imageRectify';
import { projectCloud } from '../../src/utils/projectCloud';
import type { CameraIntrinsics } from '../../src/hooks/useCameraInfo';

function makeIntrinsics(overrides: Partial<CameraIntrinsics> = {}): CameraIntrinsics {
  return {
    fx: 500,
    fy: 500,
    cx: 320,
    cy: 240,
    width: 640,
    height: 480,
    distortionCoefficients: [0, 0, 0, 0, 0],
    distortionModel: 'plumb_bob',
    frameId: 'camera_optical',
    timestamp: 0n,
    ...overrides,
  };
}

// ── lensModel ──────────────────────────────────────────────────────────────

describe('lensModel', () => {
  it.each([
    ['plumb_bob', 'plumb_bob'],
    ['', 'plumb_bob'],
    ['rational_polynomial', 'rational_polynomial'],
    ['equidistant', 'equidistant'],
    ['fisheye', 'equidistant'],
    ['Kannala_Brandt', 'equidistant'],
    ['  EQUIDISTANT ', 'equidistant'],
    ['omni', null],
    ['double_sphere', null],
  ])('%j -> %j', (name, want) => {
    expect(lensModel(name)).toBe(want);
    expect(isSupportedDistortion(name)).toBe(want !== null);
  });
});

// ── buildRemapMap ──────────────────────────────────────────────────────────

describe('buildRemapMap', () => {
  it('produces a map with the correct dimensions', () => {
    const ci = makeIntrinsics({ width: 16, height: 12 });
    const map = buildRemapMap(ci);
    expect(map.width).toBe(16);
    expect(map.height).toBe(12);
    expect(map.mapX.length).toBe(16 * 12);
    expect(map.mapY.length).toBe(16 * 12);
  });

  it('all-zero D gives identity remap (src pixel == output pixel)', () => {
    const ci = makeIntrinsics({
      fx: 100, fy: 100, cx: 8, cy: 6, width: 16, height: 12,
      distortionCoefficients: [0, 0, 0, 0, 0],
    });
    const map = buildRemapMap(ci);
    const tol = 1e-4;
    for (let v = 0; v < 12; v++) {
      for (let u = 0; u < 16; u++) {
        const i = v * 16 + u;
        expect(map.mapX[i]).toBeCloseTo(u, 3);
        expect(map.mapY[i]).toBeCloseTo(v, 3);
      }
    }
    // Confirm with explicit tolerance
    expect(Math.abs(map.mapX[0] - 0)).toBeLessThan(tol);
  });

  it('centre pixel maps to itself regardless of distortion', () => {
    const ci = makeIntrinsics({
      fx: 100, fy: 100, cx: 8, cy: 6, width: 16, height: 12,
      distortionCoefficients: [0.1, 0.05, 0.01, 0.01, 0.001],
    });
    const map = buildRemapMap(ci);
    const centreIdx = 6 * 16 + 8;
    expect(map.mapX[centreIdx]).toBeCloseTo(8, 3);
    expect(map.mapY[centreIdx]).toBeCloseTo(6, 3);
  });

  it('barrel distortion shifts corner pixels outside the image', () => {
    const ci = makeIntrinsics({
      fx: 100, fy: 100, cx: 8, cy: 6, width: 16, height: 12,
      distortionCoefficients: [0.5, 0, 0, 0, 0],
    });
    const map = buildRemapMap(ci);
    // Top-left corner (0, 0) should map to a source pixel outside the image.
    const tlX = map.mapX[0];
    const tlY = map.mapY[0];
    const outOfBounds = tlX < 0 || tlY < 0 || tlX >= 15 || tlY >= 11;
    expect(outOfBounds).toBe(true);
  });

  it('returns the same object reference on a repeated call (LRU cache hit)', () => {
    const ci = makeIntrinsics({ width: 8, height: 8 });
    const first = buildRemapMap(ci);
    const second = buildRemapMap(ci);
    expect(first).toBe(second);
  });
});

// ── applyRemap ─────────────────────────────────────────────────────────────

describe('applyRemap', () => {
  it('identity map is a pass-through for interior pixels', () => {
    const w = 8;
    const h = 8;
    // Build a map where every output pixel maps to itself.
    const mapX = new Float32Array(w * h);
    const mapY = new Float32Array(w * h);
    for (let v = 0; v < h; v++) {
      for (let u = 0; u < w; u++) {
        mapX[v * w + u] = u;
        mapY[v * w + u] = v;
      }
    }
    const src = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < src.length; i++) src[i] = (i * 7 + 13) % 256;
    const dst = applyRemap(src, { mapX, mapY, width: w, height: h });
    // Bilinear at integer coords is exact. The +1 neighbours are clamped to
    // the last index, so the final row / column sample correctly too.
    for (let v = 0; v < h; v++) {
      for (let u = 0; u < w; u++) {
        const base = (v * w + u) * 4;
        for (let c = 0; c < 4; c++) {
          expect(dst[base + c]).toBe(src[base + c]);
        }
      }
    }
  });

  it('out-of-bounds source pixels are filled with transparent black', () => {
    const w = 4;
    const h = 4;
    // Map every pixel far outside the image.
    const mapX = new Float32Array(w * h).fill(-999);
    const mapY = new Float32Array(w * h).fill(-999);
    const src = new Uint8ClampedArray(w * h * 4).fill(255);
    const dst = applyRemap(src, { mapX, mapY, width: w, height: h });
    for (let i = 0; i < dst.length; i++) {
      expect(dst[i]).toBe(0);
    }
  });
});

// ── equidistant (Kannala-Brandt) and rational_polynomial (#120) ────────────

// Kalibr equidistant calibration of a 512x512 fisheye, in the style TUM-VI publishes.
const fisheye = makeIntrinsics({
  fx: 190.97847715128717,
  fy: 190.9733070521226,
  cx: 254.93170605935475,
  cy: 256.8974428996504,
  width: 512,
  height: 512,
  distortionModel: 'equidistant',
  distortionCoefficients: [0.0034823894022493434, 0.0007150348452162257, -0.0020532361418706202, 0.00020293673591811182],
});

describe('equidistant model', () => {
  it('maps a ray to theta_d along its own direction', () => {
    const k = [0.1, -0.02, 0.003, -0.0004];
    for (const [x, y] of [[1, 0], [0.3, -0.4], [-2, 1.5]]) {
      const r = Math.hypot(x, y);
      const t = Math.atan(r);
      const td = t * (1 + k[0] * t ** 2 + k[1] * t ** 4 + k[2] * t ** 6 + k[3] * t ** 8);
      const [xd, yd] = distortNormalized('equidistant', k, x, y);
      expect(xd).toBeCloseTo((x / r) * td, 12);
      expect(yd).toBeCloseTo((y / r) * td, 12);
    }
  });

  it('bends even with all-zero coefficients (f-theta is not a pinhole)', () => {
    const [xd] = distortNormalized('equidistant', [0, 0, 0, 0], 1, 0);
    expect(xd).toBeCloseTo(Math.PI / 4, 12);
    const map = buildRemapMap({ ...fisheye, distortionCoefficients: [0, 0, 0, 0] });
    const corner = map.mapX[0];
    expect(Math.abs(corner - 0)).toBeGreaterThan(1);
  });

  it('undistortPixel inverts the remap across the whole frame', () => {
    const map = buildRemapMap(fisheye);
    let worst = 0;
    for (let v = 0; v < 512; v += 17) {
      for (let u = 0; u < 512; u += 13) {
        const i = v * 512 + u;
        const back = undistortPixel(fisheye, map.mapX[i], map.mapY[i]);
        worst = Math.max(worst, Math.hypot(back.x - u, back.y - v));
      }
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it('LiDAR projection lands where the remap says that pixel comes from', () => {
    // A point straight down a ray (u, v) of the rectified image lands on mapX/mapY in the raw one.
    const map = buildRemapMap(fisheye);
    const [u, v] = [40, 450];
    const x = (u - fisheye.cx) / fisheye.fx;
    const y = (v - fisheye.cy) / fisheye.fy;
    const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const out = projectCloud(new Float32Array([x * 3, y * 3, 3]), identity, fisheye, {});
    expect(out.count).toBe(1);
    expect(out.u[0]).toBeCloseTo(map.mapX[v * 512 + u], 2);
    expect(out.v[0]).toBeCloseTo(map.mapY[v * 512 + u], 2);
  });
});

describe('rational_polynomial model', () => {
  it('equals plumb_bob when k4..k6 are zero, and divides by the second polynomial otherwise', () => {
    const d = [-0.3, 0.1, 0.001, -0.0005, 0.02];
    expect(distortNormalized('rational_polynomial', [...d, 0, 0, 0], 0.4, -0.2)).toEqual(distortNormalized('plumb_bob', d, 0.4, -0.2));
    const [x, y] = [0.4, -0.2];
    const r2 = x * x + y * y;
    const k = [0.5, 0.05, 0, 0, 0.001, 0.6, 0.06, 0.002];
    const radial = (1 + k[0] * r2 + k[1] * r2 ** 2 + k[4] * r2 ** 3) / (1 + k[5] * r2 + k[6] * r2 ** 2 + k[7] * r2 ** 3);
    expect(distortNormalized('rational_polynomial', k, x, y)[0]).toBeCloseTo(x * radial, 12);
  });

  it('undistortPixel inverts it', () => {
    const ci = makeIntrinsics({ distortionModel: 'rational_polynomial', distortionCoefficients: [0.5, 0.05, 0.0005, -0.0003, 0.001, 0.6, 0.06, 0.002] });
    const map = buildRemapMap(ci);
    for (const [u, v] of [[10, 10], [320, 240], [600, 30], [5, 470]]) {
      const i = v * 640 + u;
      const back = undistortPixel(ci, map.mapX[i], map.mapY[i]);
      expect(Math.hypot(back.x - u, back.y - v)).toBeLessThan(1e-3);
    }
  });

  it('caches per model, so the same numbers under two models get two maps', () => {
    const d = [0.01, 0.002, 0.0003, 0.00004, 0, 0, 0, 0];
    const a = buildRemapMap(makeIntrinsics({ distortionModel: 'rational_polynomial', distortionCoefficients: d }));
    const b = buildRemapMap(makeIntrinsics({ distortionModel: 'equidistant', distortionCoefficients: d }));
    expect(a).not.toBe(b);
  });
});
