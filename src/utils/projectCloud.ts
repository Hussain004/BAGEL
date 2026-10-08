/**
 * Project a LiDAR point cloud onto a camera image.
 *
 * The standard extrinsic-calibration sanity check: if the calibration and the
 * TF tree are right, depth-coloured points line up with the edges in the
 * picture. Pure and DOM-free so the geometry can be tested against hand-worked
 * numbers; the panel only supplies the transform, the intrinsics and a canvas.
 */

import type { CameraIntrinsics } from '../hooks/useCameraInfo';
import { autoDepthRange } from './depthColor';
import { isPlumbBobModel } from './imageRectify';
import { turboColor } from './pointcloud';

export interface ProjectedPoints {
  /** Pixel coordinates in the displayed image. */
  u: Float32Array;
  v: Float32Array;
  /** Distance along the optical axis, in metres. */
  depth: Float32Array;
  /** Points that landed inside the image. */
  count: number;
  /** Input points considered (after the in-front-of-camera test is not yet applied). */
  total: number;
  /** In front of the camera, whether or not inside the frame. */
  inFront: number;
}

export interface ProjectOptions {
  /** The displayed image is undistorted, so skip the lens model. */
  rectified?: boolean;
  /** Displayed image size; CameraInfo of a resized stream is scaled to it. */
  imageWidth?: number;
  imageHeight?: number;
  /** Points closer than this along the optical axis are dropped. Default 0.1 m. */
  minDepth?: number;
}

/**
 * `matrix` is a column-major 4x4 (THREE.Matrix4.elements) taking points in the
 * cloud's frame to the camera's optical frame (x right, y down, z forward).
 */
export function projectCloud(
  positions: Float32Array,
  matrix: ArrayLike<number>,
  ci: CameraIntrinsics,
  opts: ProjectOptions = {},
): ProjectedPoints {
  const total = Math.floor(positions.length / 3);
  const u = new Float32Array(total);
  const v = new Float32Array(total);
  const depth = new Float32Array(total);
  const m = matrix;
  const minDepth = opts.minDepth ?? 0.1;
  const w = opts.imageWidth ?? ci.width;
  const h = opts.imageHeight ?? ci.height;
  // A CameraInfo for the full-size sensor still describes a half-size stream
  // if the stream was resized uniformly: scale pixel coordinates to match.
  const sx = ci.width > 0 ? w / ci.width : 1;
  const sy = ci.height > 0 ? h / ci.height : 1;
  const distort = !opts.rectified && isPlumbBobModel(ci.distortionModel);
  const d = ci.distortionCoefficients;
  const k1 = d[0] ?? 0;
  const k2 = d[1] ?? 0;
  const p1 = d[2] ?? 0;
  const p2 = d[3] ?? 0;
  const k3 = d[4] ?? 0;

  let count = 0;
  let inFront = 0;
  for (let i = 0; i < total; i++) {
    const x = positions[i * 3]!;
    const y = positions[i * 3 + 1]!;
    const z = positions[i * 3 + 2]!;
    const cz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
    if (!(cz > minDepth)) continue; // also rejects NaN
    inFront++;
    const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    let nx = cx / cz;
    let ny = cy / cz;
    if (distort) {
      const r2 = nx * nx + ny * ny;
      const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
      const dx = 2 * p1 * nx * ny + p2 * (r2 + 2 * nx * nx);
      const dy = p1 * (r2 + 2 * ny * ny) + 2 * p2 * nx * ny;
      nx = nx * radial + dx;
      ny = ny * radial + dy;
    }
    const pu = (ci.fx * nx + ci.cx) * sx;
    const pv = (ci.fy * ny + ci.cy) * sy;
    if (!(pu >= 0 && pu < w && pv >= 0 && pv < h)) continue;
    u[count] = pu;
    v[count] = pv;
    depth[count] = cz;
    count++;
  }
  return { u: u.subarray(0, count), v: v.subarray(0, count), depth: depth.subarray(0, count), count, total, inFront };
}

const BUCKETS = 64;

/**
 * Draw projected points as small squares coloured by depth, near to far.
 * The colour range ignores the nearest and farthest 1% so a few stray returns
 * do not flatten the gradient. Points are grouped into colour buckets so a
 * 200k-point frame costs 64 style changes, not 200k, and the far buckets are
 * drawn first so near points are never hidden behind them.
 */
export function paintProjection(
  ctx: CanvasRenderingContext2D,
  pts: ProjectedPoints,
  dotSize: number,
): void {
  const { min, max } = autoDepthRange(pts.depth);
  const span = max - min || 1;
  const half = dotSize / 2;
  const bucketOf = new Uint8Array(pts.count);
  const sizes = new Uint32Array(BUCKETS);
  for (let i = 0; i < pts.count; i++) {
    const t = Math.min(1, Math.max(0, (pts.depth[i]! - min) / span));
    const b = Math.min(BUCKETS - 1, Math.floor(t * BUCKETS));
    bucketOf[i] = b;
    sizes[b]!++;
  }
  // Counting sort of point indices by bucket.
  const start = new Uint32Array(BUCKETS + 1);
  for (let b = 0; b < BUCKETS; b++) start[b + 1] = start[b]! + sizes[b]!;
  const fill = start.slice(0, BUCKETS);
  const order = new Uint32Array(pts.count);
  for (let i = 0; i < pts.count; i++) order[fill[bucketOf[i]!]!++] = i;
  for (let b = BUCKETS - 1; b >= 0; b--) {
    if (sizes[b] === 0) continue;
    const c = turboColor((b + 0.5) / BUCKETS);
    ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
    for (let k = start[b]!; k < start[b + 1]!; k++) {
      const i = order[k]!;
      ctx.fillRect(pts.u[i]! - half, pts.v[i]! - half, dotSize, dotSize);
    }
  }
}
