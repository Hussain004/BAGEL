/**
 * Lens undistortion for sensor_msgs/Image frames, for every distortion model
 * ROS defines (`sensor_msgs/distortion_models.hpp`):
 *   - `plumb_bob` (Brown-Conrady), D = [k1, k2, p1, p2, k3] (v1.3.4, #47);
 *   - `rational_polynomial`, D = [k1, k2, p1, p2, k3, k4, k5, k6];
 *   - `equidistant` (Kannala-Brandt), D = [k1, k2, k3, k4]: OpenCV's fisheye
 *     model and Kalibr's equidistant one are the same, so `fisheye` and
 *     `kannala_brandt` are accepted as names for it (#120).
 * Anything else is rejected rather than silently mangling the image.
 *
 * Strategy: forward distortion remap.
 * For each output pixel (u, v) in the rectified image, compute the source
 * pixel in the distorted image via the forward distortion function, then
 * bilinearly interpolate. This avoids the iterative Newton-Raphson inverse
 * that the strict "undistort pixel" path would require.
 */

import type { CameraIntrinsics } from '../hooks/useCameraInfo';

export interface RemapMap {
  mapX: Float32Array;
  mapY: Float32Array;
  width: number;
  height: number;
}

export type LensModel = 'plumb_bob' | 'rational_polynomial' | 'equidistant';

/** The model a CameraInfo `distortion_model` names, or null if BAGEL cannot undistort it. */
export function lensModel(model: string): LensModel | null {
  const m = model.trim().toLowerCase();
  if (m === 'plumb_bob' || m === '') return 'plumb_bob';
  if (m === 'rational_polynomial') return 'rational_polynomial';
  if (m === 'equidistant' || m === 'fisheye' || m === 'kannala_brandt') return 'equidistant';
  return null;
}

/** True for distortion models BAGEL can undistort. */
export function isSupportedDistortion(model: string): boolean {
  return lensModel(model) !== null;
}

/**
 * Forward distortion: an ideal (undistorted) normalised image point to where
 * the lens puts it. One function for every model, shared by the remap table,
 * the LiDAR projection and the inverse below.
 */
export function distortNormalized(model: LensModel, d: number[], x: number, y: number): [number, number] {
  const c = (i: number) => d[i] ?? 0;
  if (model === 'equidistant') {
    const r = Math.hypot(x, y);
    if (r < 1e-12) return [x, y];
    const t = Math.atan(r);
    const t2 = t * t;
    const td = t * (1 + t2 * (c(0) + t2 * (c(1) + t2 * (c(2) + t2 * c(3)))));
    const s = td / r;
    return [x * s, y * s];
  }
  const r2 = x * x + y * y;
  let radial = 1 + r2 * (c(0) + r2 * (c(1) + r2 * c(4)));
  if (model === 'rational_polynomial') radial /= 1 + r2 * (c(5) + r2 * (c(6) + r2 * c(7)));
  const p1 = c(2);
  const p2 = c(3);
  return [x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x), y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y];
}

// LRU cache keyed by intrinsics fingerprint. Size 4 covers a typical
// multi-camera rig (stereo pair + two wide-angle cameras) without unbounded
// growth. The Float32Array pairs are a few MB each, so we keep it tight.
const CACHE_LIMIT = 4;
const cacheKeys: string[] = [];
const cacheVals: RemapMap[] = [];

function fingerprintIntrinsics(ci: CameraIntrinsics): string {
  return `${lensModel(ci.distortionModel)},${ci.fx},${ci.fy},${ci.cx},${ci.cy},${ci.width},${ci.height},${ci.distortionCoefficients.join(',')}`;
}

/**
 * Build (or fetch from cache) a remap table for the given intrinsics.
 * Each output pixel (u, v) maps to a source pixel (mapX[i], mapY[i])
 * in the distorted image.
 */
export function buildRemapMap(ci: CameraIntrinsics): RemapMap {
  const key = fingerprintIntrinsics(ci);
  const cached = cacheKeys.indexOf(key);
  if (cached !== -1) {
    // Move to front (LRU).
    const map = cacheVals[cached];
    cacheKeys.splice(cached, 1);
    cacheVals.splice(cached, 1);
    cacheKeys.unshift(key);
    cacheVals.unshift(map);
    return map;
  }

  const { fx, fy, cx, cy, width, height, distortionCoefficients: d } = ci;
  const model = lensModel(ci.distortionModel) ?? 'plumb_bob';

  const n = width * height;
  const mapX = new Float32Array(n);
  const mapY = new Float32Array(n);

  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      // Normalised (undistorted) image coords, through the lens.
      const [xd, yd] = distortNormalized(model, d, (u - cx) / fx, (v - cy) / fy);
      mapX[v * width + u] = xd * fx + cx;
      mapY[v * width + u] = yd * fy + cy;
    }
  }

  const map: RemapMap = { mapX, mapY, width, height };

  // Evict the oldest entry when over the limit.
  if (cacheKeys.length >= CACHE_LIMIT) {
    cacheKeys.pop();
    cacheVals.pop();
  }
  cacheKeys.unshift(key);
  cacheVals.unshift(map);
  return map;
}

/**
 * Apply a remap table to a raw RGBA pixel buffer.
 * Returns a new Uint8ClampedArray of the same size.
 * Out-of-bounds source pixels are filled with transparent black.
 */
export function applyRemap(src: Uint8ClampedArray, map: RemapMap): Uint8ClampedArray<ArrayBuffer> {
  const { mapX, mapY, width, height } = map;
  const dst = new Uint8ClampedArray(new ArrayBuffer(src.length));

  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const i = v * width + u;
      const sx = mapX[i];
      const sy = mapY[i];

      // Integer part and fractional part for bilinear interpolation.
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);

      // Boundary check: reject only when the top-left sample itself is
      // outside the source. The +1 neighbours are clamped to the last valid
      // index rather than rejecting, so sx == width-1 (the final column,
      // where the 2x2 neighbourhood still fits after clamping) is sampled
      // instead of dropped.
      if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) {
        // Transparent black - dst is already zeroed, so nothing to do.
        continue;
      }
      const x1 = Math.min(x0 + 1, width - 1);
      const y1 = Math.min(y0 + 1, height - 1);

      const fx = sx - x0;
      const fy = sy - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const p00 = (y0 * width + x0) * 4;
      const p10 = (y0 * width + x1) * 4;
      const p01 = (y1 * width + x0) * 4;
      const p11 = (y1 * width + x1) * 4;

      const di = i * 4;
      dst[di]     = w00 * src[p00]     + w10 * src[p10]     + w01 * src[p01]     + w11 * src[p11];
      dst[di + 1] = w00 * src[p00 + 1] + w10 * src[p10 + 1] + w01 * src[p01 + 1] + w11 * src[p11 + 1];
      dst[di + 2] = w00 * src[p00 + 2] + w10 * src[p10 + 2] + w01 * src[p01 + 2] + w11 * src[p11 + 2];
      dst[di + 3] = w00 * src[p00 + 3] + w10 * src[p10 + 3] + w01 * src[p01 + 3] + w11 * src[p11 + 3];
    }
  }
  return dst;
}

/**
 * Where a pixel of the ORIGINAL (distorted) image lands in the rectified
 * image: the inverse of the remap above, which maps rectified -> original.
 *
 * No model has a closed-form inverse. The equidistant one is radial only, so
 * it solves theta_d = theta * (1 + k1 theta^2 + ...) for theta by Newton's
 * method; the others run the usual fixed-point iteration (the one OpenCV's
 * undistortPoints uses). Used to carry overlay geometry such as detection
 * boxes, which are in raw image pixels, onto an undistorted frame.
 */
export function undistortPixel(ci: CameraIntrinsics, u: number, v: number): { x: number; y: number } {
  const { fx, fy, cx, cy, distortionCoefficients: d } = ci;
  const model = lensModel(ci.distortionModel) ?? 'plumb_bob';
  const xd = (u - cx) / fx;
  const yd = (v - cy) / fy;
  let x = xd;
  let y = yd;
  if (model === 'equidistant') {
    const td = Math.hypot(xd, yd);
    if (td < 1e-12) return { x: u, y: v };
    const c = (i: number) => d[i] ?? 0;
    let t = td;
    for (let i = 0; i < 20; i++) {
      const t2 = t * t;
      const f = t * (1 + t2 * (c(0) + t2 * (c(1) + t2 * (c(2) + t2 * c(3))))) - td;
      const df = 1 + t2 * (3 * c(0) + t2 * (5 * c(1) + t2 * (7 * c(2) + t2 * 9 * c(3))));
      const step = f / df;
      t -= step;
      if (Math.abs(step) < 1e-12) break;
    }
    // Rays at or past 90 degrees have no pinhole image; keep them on the far edge.
    const r = Math.tan(Math.min(t, Math.PI / 2 - 1e-6));
    x = (xd * r) / td;
    y = (yd * r) / td;
  } else {
    const c = (i: number) => d[i] ?? 0;
    const p1 = c(2);
    const p2 = c(3);
    for (let i = 0; i < 10; i++) {
      const r2 = x * x + y * y;
      let radial = 1 + r2 * (c(0) + r2 * (c(1) + r2 * c(4)));
      if (model === 'rational_polynomial') radial /= 1 + r2 * (c(5) + r2 * (c(6) + r2 * c(7)));
      const dx = 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
      const dy = p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
      x = (xd - dx) / radial;
      y = (yd - dy) / radial;
    }
  }
  return { x: x * fx + cx, y: y * fy + cy };
}
