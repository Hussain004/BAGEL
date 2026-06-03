/**
 * useCameraInfo - v1.3.2
 *
 * Read `sensor_msgs/CameraInfo` at the playhead, surface the parsed
 * intrinsics, and auto-pair it with the image topic the panel is showing.
 *
 * Auto-pair rules (in order):
 *   1. Strip the last path segment of the image topic and look for
 *      `<prefix>/camera_info` (the dominant ROS convention:
 *      `/camera/image_raw` -> `/camera/camera_info`).
 *   2. Fall back to any topic in the same parent namespace whose name
 *      ends in `/camera_info`.
 *   3. Fall back to the first `sensor_msgs/CameraInfo` topic anywhere in
 *      the bag, only when exactly one exists.
 *
 * Manual override: the caller may pass `manualOverride` (typically wired
 * to a per-panel setting). When non-empty it wins over the auto-pair so
 * stereo rigs whose left/right pairs follow non-standard naming still
 * line up. The list of candidate topics is returned for the picker UI.
 *
 * Distortion-likely-unfilled heuristic: `D[0..4]` all exactly zero is the
 * RViz convention for "calibration template, not run". Real cameras at
 * least have a few non-zero coefficients; perfect pinhole cameras are
 * effectively never published as `CameraInfo`. Surface this as a chip in
 * the overlay rather than fail the read.
 *
 * The read goes through `useMessageAtTime` for the same single-flight +
 * playhead-coalescing the rest of the bag-local hooks use.
 */

import { useMemo } from 'react';
import { useBagStore, resolveBagEntry } from '../store/bagStore';
import { useMessageAtTime } from './useMessageAtTime';
import { isCameraInfoType } from '../utils/messages';

export interface CameraIntrinsics {
  /** Focal length in pixels (K[0]). */
  fx: number;
  /** Focal length in pixels (K[4]). */
  fy: number;
  /** Principal point in pixels (K[2]). */
  cx: number;
  /** Principal point in pixels (K[5]). */
  cy: number;
  /** Image width / height in pixels. */
  width: number;
  height: number;
  /** Raw `D[]` from the message (typically 5 plumb-bob coefficients). */
  distortionCoefficients: number[];
  /** `distortion_model` string from the message, lower-cased. */
  distortionModel: string;
  /** Source frame for TF resolution (the camera's optical frame). */
  frameId: string;
  /** Timestamp of the CameraInfo message this snapshot came from. */
  timestamp: bigint;
}

export interface UseCameraInfoResult {
  /** Parsed intrinsics at the playhead, or null when none is available. */
  info: CameraIntrinsics | null;
  /** Currently used CameraInfo topic (auto or manually paired). */
  pairedTopic: string | null;
  /** True iff the pair was auto-detected (vs. manually overridden). */
  isAutoPair: boolean;
  /** Every `sensor_msgs/CameraInfo` topic in the bag, sorted. */
  candidates: string[];
  /** True iff the bag has no CameraInfo topics at all. */
  hasNoInfoTopic: boolean;
  /**
   * Heuristic: every coefficient in `D[0..4]` is exactly 0. Real cameras
   * never publish a perfect-pinhole CameraInfo, so this almost always
   * means "calibration template not filled in".
   */
  calibrationLikelyUnfilled: boolean;
}

const EMPTY_RESULT: UseCameraInfoResult = {
  info: null,
  pairedTopic: null,
  isAutoPair: false,
  candidates: [],
  hasNoInfoTopic: true,
  calibrationLikelyUnfilled: false,
};

/**
 * Parse a deserialized CameraInfo message into typed intrinsics. Tolerant
 * about field-name case (ROS1 publishes `K/D/R/P`, ROS2 publishes
 * `k/d/r/p`; the v0.6 normalisation pass only touches time fields).
 */
export function parseCameraInfo(
  value: Record<string, unknown>,
  fallbackTimestampNs: bigint,
): CameraIntrinsics | null {
  const k = pickArray(value, ['k', 'K']);
  if (!k || k.length < 9) return null;

  const fx = Number(k[0]);
  const fy = Number(k[4]);
  const cx = Number(k[2]);
  const cy = Number(k[5]);
  if (
    !Number.isFinite(fx) ||
    !Number.isFinite(fy) ||
    !Number.isFinite(cx) ||
    !Number.isFinite(cy) ||
    fx <= 0 ||
    fy <= 0
  ) {
    // Zero focal length means the calibration message is meaningless.
    return null;
  }

  const width = Number(value.width ?? 0);
  const height = Number(value.height ?? 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  const dRaw = pickArray(value, ['d', 'D']) ?? [];
  const distortionCoefficients: number[] = [];
  for (const v of dRaw) {
    const n = Number(v);
    distortionCoefficients.push(Number.isFinite(n) ? n : 0);
  }

  const distortionModel =
    typeof value.distortion_model === 'string'
      ? value.distortion_model.toLowerCase()
      : '';

  const header = (value.header ?? {}) as {
    frame_id?: unknown;
    stamp?: { sec?: unknown; nanosec?: unknown; nsec?: unknown };
  };
  const frameId = typeof header.frame_id === 'string' ? header.frame_id : '';
  const timestamp = stampNs(header.stamp, fallbackTimestampNs);

  return {
    fx,
    fy,
    cx,
    cy,
    width,
    height,
    distortionCoefficients,
    distortionModel,
    frameId,
    timestamp,
  };
}

/**
 * Pick the matching CameraInfo topic for an image topic name.
 *
 * Returns `null` when no candidate fits the convention rules. Used by the
 * hook and by tests directly.
 */
export function pickPairedCameraInfo(
  imageTopic: string,
  candidates: string[],
): string | null {
  if (candidates.length === 0) return null;
  const candidateSet = new Set(candidates);

  // 1. Same-prefix + /camera_info.
  const prefix = parentNamespace(imageTopic);
  if (prefix !== null) {
    const direct = `${prefix}/camera_info`;
    if (candidateSet.has(direct)) return direct;
    // 2. Any /camera_info under the same parent namespace.
    for (const cand of candidates) {
      if (cand.startsWith(`${prefix}/`) && cand.endsWith('/camera_info')) {
        return cand;
      }
    }
  }

  // 3. Sole candidate in the bag - safe to assume the user means this one.
  if (candidates.length === 1) return candidates[0];

  return null;
}

export function useCameraInfo(
  imageTopic: string,
  bagId: string | undefined,
  playheadNs: bigint,
  manualOverride?: string | null,
): UseCameraInfoResult {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));

  const candidates = useMemo(() => {
    if (!entry) return [];
    return entry.summary.topics
      .filter((t) => isCameraInfoType(t.type))
      .map((t) => t.name)
      .sort();
  }, [entry]);

  const autoTopic = useMemo(
    () => pickPairedCameraInfo(imageTopic, candidates),
    [imageTopic, candidates],
  );

  const overrideValid =
    manualOverride && candidates.includes(manualOverride) ? manualOverride : null;
  const pairedTopic = overrideValid ?? autoTopic ?? null;
  const isAutoPair = pairedTopic !== null && pairedTopic === autoTopic && !overrideValid;

  const message = useMessageAtTime(pairedTopic ?? '', playheadNs, bagId);

  return useMemo<UseCameraInfoResult>(() => {
    if (!entry) return EMPTY_RESULT;
    if (candidates.length === 0) {
      return { ...EMPTY_RESULT, candidates };
    }
    if (!pairedTopic) {
      return {
        info: null,
        pairedTopic: null,
        isAutoPair: false,
        candidates,
        hasNoInfoTopic: false,
        calibrationLikelyUnfilled: false,
      };
    }

    const raw = message.message?.value;
    if (!raw) {
      return {
        info: null,
        pairedTopic,
        isAutoPair,
        candidates,
        hasNoInfoTopic: false,
        calibrationLikelyUnfilled: false,
      };
    }
    const ts = message.message?.timestamp ?? 0n;
    const info = parseCameraInfo(raw, ts);
    const calibrationLikelyUnfilled = info
      ? distortionLikelyUnfilled(info.distortionCoefficients)
      : false;

    return {
      info,
      pairedTopic,
      isAutoPair,
      candidates,
      hasNoInfoTopic: false,
      calibrationLikelyUnfilled,
    };
  }, [entry, candidates, pairedTopic, isAutoPair, message.message]);
}

// ── internal helpers ─────────────────────────────────────────────────────

function parentNamespace(topicName: string): string | null {
  if (!topicName.startsWith('/')) return null;
  const idx = topicName.lastIndexOf('/');
  if (idx <= 0) return null;
  return topicName.slice(0, idx);
}

function pickArray(value: Record<string, unknown>, keys: string[]): unknown[] | null {
  for (const k of keys) {
    const v = value[k];
    if (Array.isArray(v)) return v;
    // Some serializers surface fixed-length arrays as TypedArrays; copy the
    // numeric prefix to a regular array so callers can index uniformly.
    if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
      const typed = v as unknown as { length: number; [i: number]: number };
      const out: number[] = new Array(typed.length);
      for (let i = 0; i < typed.length; i++) out[i] = typed[i];
      return out;
    }
  }
  return null;
}

function stampNs(
  stamp: { sec?: unknown; nanosec?: unknown; nsec?: unknown } | undefined,
  fallback: bigint,
): bigint {
  if (!stamp) return fallback;
  const ns = stamp.nanosec ?? stamp.nsec;
  if (typeof stamp.sec === 'number' && typeof ns === 'number') {
    return BigInt(stamp.sec) * 1_000_000_000n + BigInt(ns);
  }
  if (typeof stamp.sec === 'bigint' && typeof ns === 'bigint') {
    return stamp.sec * 1_000_000_000n + ns;
  }
  return fallback;
}

function distortionLikelyUnfilled(d: number[]): boolean {
  // Plumb-bob carries 5 coefficients (k1, k2, p1, p2, k3). Some publishers
  // emit 4 or 8 (rational polynomial). All-zero across the first 5 is the
  // RViz convention for "calibration template not filled in".
  if (d.length < 4) return true;
  const span = Math.min(d.length, 5);
  for (let i = 0; i < span; i++) {
    if (d[i] !== 0) return false;
  }
  return true;
}
