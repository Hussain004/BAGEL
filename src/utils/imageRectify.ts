/**
 * Plumb-bob (Brown-Conrady) lens undistortion for sensor_msgs/Image frames.
 *
 * v1.3.4 - issue #47: per-frame canvas remap using D = [k1, k2, p1, p2, k3].
 * Covers ~95% of real bags. Fisheye / equidistant / rational_polynomial are
 * unsupported (we reject them rather than silently mangle the image).
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

/** True for distortion models we can handle with plumb-bob math. */
export function isPlumbBobModel(model: string): boolean {
  const m = model.trim().toLowerCase();
  return m === 'plumb_bob' || m === '';
}

// LRU cache keyed by intrinsics fingerprint. Size 4 covers a typical
// multi-camera rig (stereo pair + two wide-angle cameras) without unbounded
// growth. The Float32Array pairs are a few MB each, so we keep it tight.
const CACHE_LIMIT = 4;
const cacheKeys: string[] = [];
const cacheVals: RemapMap[] = [];

function fingerprintIntrinsics(ci: CameraIntrinsics): string {
  const d = ci.distortionCoefficients;
  return `${ci.fx},${ci.fy},${ci.cx},${ci.cy},${ci.width},${ci.height},${d[0] ?? 0},${d[1] ?? 0},${d[2] ?? 0},${d[3] ?? 0},${d[4] ?? 0}`;
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
  const k1 = d[0] ?? 0;
  const k2 = d[1] ?? 0;
  const p1 = d[2] ?? 0;
  const p2 = d[3] ?? 0;
  const k3 = d[4] ?? 0;

  const n = width * height;
  const mapX = new Float32Array(n);
  const mapY = new Float32Array(n);

  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      // Normalised (undistorted) image coords.
      const xu = (u - cx) / fx;
      const yu = (v - cy) / fy;
      const r2 = xu * xu + yu * yu;
      const r4 = r2 * r2;
      const r6 = r4 * r2;
      const radial = 1 + k1 * r2 + k2 * r4 + k3 * r6;
      // Forward distortion (plumb-bob / Brown-Conrady).
      const xd = xu * radial + 2 * p1 * xu * yu + p2 * (r2 + 2 * xu * xu);
      const yd = yu * radial + p1 * (r2 + 2 * yu * yu) + 2 * p2 * xu * yu;
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
      const x1 = x0 + 1;
      const y1 = y0 + 1;

      // Boundary check: need all four neighbours to be inside.
      // Use width-1 and height-1 so the bilinear read is always valid.
      if (x0 < 0 || y0 < 0 || x1 >= width || y1 >= height) {
        // Transparent black - dst is already zeroed, so nothing to do.
        continue;
      }

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
