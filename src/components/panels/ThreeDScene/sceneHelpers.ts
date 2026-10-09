import * as THREE from 'three';
import type { UpAxis } from '../../../store/threeDPanelStore';
import type { DecodedMessage } from '../../../hooks/useTopicMessages';
import type { HeightAxis } from '../../../utils/pointcloud';
import { extractMarkers } from './markerObjects';
import type { CameraIntrinsics } from '../../../hooks/useCameraInfo';

/**
 * Translate the panel's UpAxis (e.g. `z+`, `x-`) into the decoder's HeightAxis
 * ('+z', '-x'). The two enums use different conventions because the panel's
 * UI strings predate the colormap fix; rather than renaming everywhere this
 * adapter keeps the change local.
 */
export function upAxisToHeightAxis(axis: UpAxis): HeightAxis {
  const sign = axis.endsWith('-') ? '-' : '+';
  const letter = axis[0]; // 'x' | 'y' | 'z'
  return `${sign}${letter}` as HeightAxis;
}

/**
 * Build the source→render rotation matrix that puts the chosen source axis
 * onto render-space +Z. Identity for the default "z+". All other cases are
 * a single 90°/180° rotation around X or Y so the math is exact and the
 * resulting matrix is orthonormal.
 */
export function makeUpFix(axis: UpAxis): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  switch (axis) {
    case 'z+':
      break; // identity
    case 'z-':
      m.makeRotationX(Math.PI);
      break;
    case 'y+':
      m.makeRotationX(Math.PI / 2);
      break;
    case 'y-':
      m.makeRotationX(-Math.PI / 2);
      break;
    case 'x+':
      m.makeRotationY(-Math.PI / 2);
      break;
    case 'x-':
      m.makeRotationY(Math.PI / 2);
      break;
  }
  return m;
}

/**
 * Binary search the largest index `i` such that `messages[i].timestamp` is at
 * or before `targetNs`. Returns -1 when no such message exists (the playhead
 * is before the first marker). Used to find the cutoff for marker replay.
 */
export function findCutoffIndex(messages: DecodedMessage[], targetNs: bigint): number {
  if (messages.length === 0) return -1;
  let lo = 0;
  let hi = messages.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (messages[mid].timestamp <= targetNs) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Pull the first marker's `header.frame_id` out of a MarkerArray message -
 * used only to auto-pick a default world frame. Returns undefined when the
 * message has no markers, or none of them carry a frame_id.
 */
export function pickMarkerFrame(
  messages: DecodedMessage[] | null,
): string | undefined {
  if (!messages) return undefined;
  for (const msg of messages) {
    if (!msg.value) continue;
    const markers = extractMarkers(msg.value, msg.timestamp);
    for (const m of markers) {
      if (m.frameId) return m.frameId;
    }
  }
  return undefined;
}

/**
 * Compute a rough axis-aligned bounding box from every marker pose +
 * every per-point position across messages 0..cutoff. Returned in source
 * frame coordinates (TF chain is applied separately by the panel), so the
 * resulting box is "wherever the markers say they live" - good enough for
 * the once-per-panel auto-fit.
 *
 * Returns null when there are no positions to bound.
 */
export function computeMarkerBounds(
  messages: DecodedMessage[],
  cutoff: number,
): {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
} | null {
  let hasPoint = false;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const consume = (x: number, y: number, z: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    hasPoint = true;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  };
  for (let i = 0; i <= cutoff; i++) {
    const msg = messages[i];
    if (!msg?.value) continue;
    const markers = extractMarkers(msg.value, msg.timestamp);
    for (const m of markers) {
      consume(m.pose.position.x, m.pose.position.y, m.pose.position.z);
      for (const p of m.points) consume(p.x, p.y, p.z);
    }
  }
  if (!hasPoint) return null;
  // Ensure a non-degenerate box so the auto-fit's radius doesn't snap to 0.
  if (minX === maxX) {
    minX -= 0.5;
    maxX += 0.5;
  }
  if (minY === maxY) {
    minY -= 0.5;
    maxY += 0.5;
  }
  if (minZ === maxZ) {
    minZ -= 0.5;
    maxZ += 0.5;
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
}

/** True when two parsed CameraInfo messages describe the same camera, so an identical update can be skipped. */
export function cameraIntrinsicsEqual(a: CameraIntrinsics, b: CameraIntrinsics): boolean {
  if (a.fx !== b.fx || a.fy !== b.fy || a.cx !== b.cx || a.cy !== b.cy) return false;
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.frameId !== b.frameId) return false;
  if (a.distortionModel !== b.distortionModel) return false;
  if (a.distortionCoefficients.length !== b.distortionCoefficients.length) return false;
  for (let i = 0; i < a.distortionCoefficients.length; i++) {
    if (a.distortionCoefficients[i] !== b.distortionCoefficients[i]) return false;
  }
  return true;
}
