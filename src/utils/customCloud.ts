/**
 * Decode "custom" point cloud messages — types that aren't sensor_msgs/PointCloud2
 * but carry per-point x/y/z in a `points: []` array of structs.
 *
 * Most common case: `livox_ros_driver2/msg/CustomMsg` (Livox MID/HAP/AVIA family),
 * which Livox ships with its own driver because PointCloud2's packed-binary
 * layout doesn't carry their per-point `offset_time` / `line` / `tag` cleanly.
 *
 * Generic enough that any future "list of (x,y,z[,intensity-ish])" message we
 * encounter slots in here without bespoke decoders. The detector below
 * recognizes the structure from the deserialized message itself, so we don't
 * need to hard-code every package name.
 */

import {
  fillColorsByScalar,
  heightAxisToReader,
  heightRangeForAxis,
  type ColorMode,
  type HeightAxis,
  type PointCloudExtraction,
} from './pointcloud';

interface CustomPointLike {
  x?: unknown;
  y?: unknown;
  z?: unknown;
  reflectivity?: unknown;
  intensity?: unknown;
  ring?: unknown;
  line?: unknown;
}

interface CustomCloudMessage {
  header?: { frame_id?: unknown };
  points?: CustomPointLike[];
}

// Type-name predicates live in `messages.ts` (single source of truth);
// re-exported here so existing importers of this module keep resolving.
// The wider "vendor /PointCloud names also match" variant is exported from
// `messages.ts` as `isCustomLidarCapableType`.
export { isCustomLidarType } from './messages';

/**
 * Structural detector: given a deserialized message value, decide whether it
 * looks like a list-of-points cloud. Catches custom variants whose type names
 * we don't recognize a priori.
 */
export function looksLikeCustomCloud(value: Record<string, unknown> | null): boolean {
  if (!value) return false;
  const pts = (value as CustomCloudMessage).points;
  if (!Array.isArray(pts) || pts.length === 0) return false;
  const first = pts[0] as CustomPointLike | undefined;
  if (!first || typeof first !== 'object') return false;
  return (
    typeof first.x === 'number' &&
    typeof first.y === 'number' &&
    typeof first.z === 'number'
  );
}

interface DecodeOptions {
  colorMode?: ColorMode;
  maxPoints?: number;
  /** Distance cap (metres) from sensor origin. Far returns are dropped before
   *  bounds / colormap stats are taken so height coloring stays useful. */
  maxRange?: number;
  /** Source-frame axis (with sign) the height colormap samples. Defaults to `+z`. */
  heightAxis?: HeightAxis;
}

const DEFAULT_POINT_LIMIT = 250_000;

/**
 * Decode a list-of-structs cloud (`points[]` array) into Float32Array
 * positions + colors. Output is shape-compatible with `decodePointCloud2`
 * so the 3D scene panel doesn't need a separate render path.
 */
export function decodeCustomCloud(
  msg: Record<string, unknown> | null,
  options: DecodeOptions = {},
): PointCloudExtraction | null {
  if (!msg) return null;
  const m = msg as CustomCloudMessage;
  const pts = m.points;
  if (!Array.isArray(pts) || pts.length === 0) return null;

  const colorMode: ColorMode = options.colorMode ?? 'height';
  // maxPoints <= 0 / NaN (bad UI state) would otherwise give stride =
  // Infinity and a zero-length positions/colors buffer to write into; fall
  // back to the default cap. The finite-stride guard keeps the loop bounds
  // valid for any residual non-finite intermediate.
  const requestedCap = options.maxPoints ?? DEFAULT_POINT_LIMIT;
  const cap =
    Number.isFinite(requestedCap) && requestedCap >= 1
      ? Math.floor(requestedCap)
      : DEFAULT_POINT_LIMIT;
  const rawStride = Math.ceil(pts.length / cap);
  const stride = Number.isFinite(rawStride) && rawStride >= 1 ? rawStride : 1;
  const sampleCount = Math.ceil(pts.length / stride);
  const rangeSqCap =
    options.maxRange && options.maxRange > 0
      ? options.maxRange * options.maxRange
      : Infinity;

  const positions = new Float32Array(sampleCount * 3);
  const colors = new Float32Array(sampleCount * 3);

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  let minIntensity = Infinity;
  let maxIntensity = -Infinity;

  // Pick whichever intensity-ish field is present; reflectivity is the
  // common Livox one, intensity is the generic, ring is a fallback.
  const sample = pts[0];
  const intensityKey: keyof CustomPointLike | null =
    sample && typeof sample === 'object'
      ? typeof sample.reflectivity === 'number'
        ? 'reflectivity'
        : typeof sample.intensity === 'number'
          ? 'intensity'
          : typeof sample.ring === 'number'
            ? 'ring'
            : typeof sample.line === 'number'
              ? 'line'
              : null
      : null;

  const intensities =
    colorMode === 'intensity' && intensityKey ? new Float32Array(sampleCount) : null;

  let validCount = 0;
  for (let i = 0; i < pts.length; i += stride) {
    const p = pts[i];
    if (!p || typeof p !== 'object') continue;
    const x = p.x as number;
    const y = p.y as number;
    const z = p.z as number;
    if (
      !(x === x && y === y && z === z) ||
      x > 1e4 ||
      x < -1e4 ||
      y > 1e4 ||
      y < -1e4 ||
      z > 1e4 ||
      z < -1e4
    ) {
      continue;
    }
    if (x * x + y * y + z * z > rangeSqCap) continue;
    const idx = validCount * 3;
    positions[idx] = x;
    positions[idx + 1] = y;
    positions[idx + 2] = z;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;

    if (intensities && intensityKey) {
      const v = Number(p[intensityKey] ?? 0);
      intensities[validCount] = v;
      if (v < minIntensity) minIntensity = v;
      if (v > maxIntensity) maxIntensity = v;
    }

    validCount++;
  }

  if (validCount === 0) return null;

  const finalPositions =
    validCount === sampleCount ? positions : positions.slice(0, validCount * 3);
  const finalColors =
    validCount === sampleCount ? colors : colors.slice(0, validCount * 3);

  if (colorMode === 'height') {
    const heightAxis: HeightAxis = options.heightAxis ?? '+z';
    const { offset: heightOff, sign: heightSign } = heightAxisToReader(heightAxis);
    const heightRange = heightRangeForAxis(heightAxis, {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    });
    fillColorsByScalar(
      finalColors,
      validCount,
      (i) => heightSign * finalPositions[i * 3 + heightOff],
      heightRange.min,
      heightRange.max,
    );
  } else if (
    colorMode === 'intensity' &&
    intensities &&
    Number.isFinite(minIntensity) &&
    maxIntensity > minIntensity
  ) {
    fillColorsByScalar(finalColors, validCount, (i) => intensities[i], minIntensity, maxIntensity);
  } else {
    // 'single' or fallback (no intensity field present): solid colour.
    const r = 0.6,
      g = 0.85,
      b = 1.0;
    for (let i = 0; i < validCount; i++) {
      finalColors[i * 3] = r;
      finalColors[i * 3 + 1] = g;
      finalColors[i * 3 + 2] = b;
    }
  }

  const frameId =
    typeof m.header?.frame_id === 'string' ? m.header.frame_id : undefined;

  return {
    positions: finalPositions,
    colors: finalColors,
    pointCount: validCount,
    fieldNames: Array.from(
      new Set(
        Object.keys(sample ?? {}).filter((k) => typeof (sample as Record<string, unknown>)?.[k] !== 'object'),
      ),
    ),
    bounds: {
      min: { x: minX, y: minY, z: minZ },
      max: { x: maxX, y: maxY, z: maxZ },
    },
    frameId,
  };
}
