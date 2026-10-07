/**
 * Depth-image colorization for the ImageViewer. Pure and DOM-free so the
 * range and invalid-pixel handling can be unit-tested.
 *
 * Conventions shared by ROS depth cameras: `16UC1` is millimetres and
 * `32FC1` is metres, and in both a value of 0, NaN or Infinity means "no
 * measurement". Invalid pixels are drawn black in every colormap so a hole
 * is never mistaken for a near or far surface.
 */

import { turboColor } from './pointcloud';

export type DepthColormap = 'gray' | 'turbo' | 'turbo-inverted';

export const DEPTH_COLORMAPS: readonly DepthColormap[] = ['gray', 'turbo', 'turbo-inverted'];

/** Cap on samples sorted for the percentile range, so a 4K frame stays cheap. */
const MAX_RANGE_SAMPLES = 16384;

export interface DepthRange {
  min: number;
  max: number;
}

export interface ColorizedDepth extends DepthRange {
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

function isValid(d: number): boolean {
  return Number.isFinite(d) && d > 0;
}

/** Native unit for a raw or compressedDepth image encoding, or null if not depth. */
export function depthUnit(encoding: string): 'mm' | 'm' | null {
  const e = encoding.trim().toLowerCase();
  if (e === '16uc1') return 'mm';
  if (e === '32fc1') return 'm';
  return null;
}

/**
 * Decode a raw `sensor_msgs/Image` depth payload to native-unit samples.
 * Returns null when the encoding is not a depth encoding. Honors
 * `is_bigendian` and tolerates a `data` view that is not 4-byte aligned.
 */
export function decodeRawDepth(
  encoding: string,
  data: Uint8Array,
  width: number,
  height: number,
  bigEndian = false,
): Float32Array | null {
  const e = encoding.trim().toLowerCase();
  const count = width * height;
  const bytes = e === '16uc1' ? 2 : e === '32fc1' ? 4 : 0;
  if (!bytes) return null;
  if (data.byteLength < count * bytes) {
    throw new Error(
      `Depth image data is ${data.byteLength} bytes but ${width}x${height} ${encoding} needs ${count * bytes}.`,
    );
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out = new Float32Array(count);
  const little = !bigEndian;
  if (bytes === 2) {
    for (let i = 0; i < count; i++) out[i] = view.getUint16(i * 2, little);
  } else {
    for (let i = 0; i < count; i++) out[i] = view.getFloat32(i * 4, little);
  }
  return out;
}

/**
 * Auto range: 1st to 99th percentile of the valid samples, so a few stray
 * far returns or near-field speckles do not flatten the whole colormap.
 * Falls back to 0..1 when nothing is valid.
 */
export function autoDepthRange(depth: ArrayLike<number>): DepthRange {
  const stride = Math.max(1, Math.floor(depth.length / MAX_RANGE_SAMPLES));
  const samples: number[] = [];
  for (let i = 0; i < depth.length; i += stride) {
    const d = depth[i]!;
    if (isValid(d)) samples.push(d);
  }
  if (samples.length === 0) return { min: 0, max: 1 };
  samples.sort((a, b) => a - b);
  const at = (p: number) => samples[Math.min(samples.length - 1, Math.floor(p * samples.length))]!;
  const min = at(0.01);
  const max = at(0.99);
  return { min, max: max > min ? max : min + 1 };
}

export interface ColorizeOptions {
  colormap: DepthColormap;
  /** Explicit range ends; null/undefined means "use the auto value". */
  min?: number | null;
  max?: number | null;
}

export function colorizeDepth(depth: ArrayLike<number>, opts: ColorizeOptions): ColorizedDepth {
  const auto = autoDepthRange(depth);
  const min = opts.min != null && Number.isFinite(opts.min) ? opts.min : auto.min;
  let max = opts.max != null && Number.isFinite(opts.max) ? opts.max : auto.max;
  if (max <= min) max = min + 1;
  const span = max - min;

  const rgba = new Uint8ClampedArray(depth.length * 4);
  for (let i = 0; i < depth.length; i++) {
    const o = i * 4;
    rgba[o + 3] = 255;
    const d = depth[i]!;
    if (!isValid(d)) continue;
    let t = (d - min) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (opts.colormap === 'gray') {
      // Near is bright, the usual convention for depth previews.
      const v = Math.round((1 - t) * 255);
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
    } else {
      const c = turboColor(opts.colormap === 'turbo-inverted' ? 1 - t : t);
      rgba[o] = Math.round(c.r * 255);
      rgba[o + 1] = Math.round(c.g * 255);
      rgba[o + 2] = Math.round(c.b * 255);
    }
  }
  return { rgba, min, max };
}

/** CSS linear-gradient for the color bar, near (left) to far (right). */
export function depthColorbarGradient(colormap: DepthColormap): string {
  const stops: string[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    let r: number, g: number, b: number;
    if (colormap === 'gray') {
      r = g = b = (1 - t) * 255;
    } else {
      const c = turboColor(colormap === 'turbo-inverted' ? 1 - t : t);
      r = c.r * 255;
      g = c.g * 255;
      b = c.b * 255;
    }
    stops.push(`rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)}) ${Math.round(t * 100)}%`);
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
