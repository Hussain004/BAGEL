/**
 * Three.js scene-object builders for the 3D panel.
 *
 * One factory per message kind we render:
 *   - PointCloud  (sensor_msgs/PointCloud2)
 *   - LaserScan   (sensor_msgs/LaserScan)
 *   - PoseAxes    (Odometry / PoseStamped / PoseWithCovarianceStamped /
 *                  TransformStamped)
 *
 * Each builder returns a single `THREE.Object3D` that owns its geometry and
 * material so callers can dispose them in one go. Updates re-allocate
 * BufferAttributes only when point counts change, which is the common case
 * for rotating LiDARs and per-frame updates.
 */

import * as THREE from 'three';
import {
  decodePointCloud2,
  turboColor,
  type ColorMode,
  type PointCloud2Message,
} from '../../../utils/pointcloud';
import type { Quat, Vec3 } from '../TFTree/useTFGraph';

export interface PointCloudObject {
  object: THREE.Points;
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  pointCount: number;
  /** Last bounds (in the cloud's local frame), useful for camera autofit. */
  bounds: { min: Vec3; max: Vec3 } | null;
}

export function createPointCloud(pointSize: number): PointCloudObject {
  const geometry = new THREE.BufferGeometry();
  // Pre-allocate empty position + color so the first update doesn't have to
  // construct attributes from scratch.
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));

  const material = new THREE.PointsMaterial({
    size: pointSize,
    sizeAttenuation: false, // size in screen pixels — predictable across zoom levels
    vertexColors: true,
    transparent: false,
    depthWrite: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { object: points, geometry, material, pointCount: 0, bounds: null };
}

export function updatePointCloud(
  obj: PointCloudObject,
  msg: PointCloud2Message,
  colorMode: ColorMode,
): boolean {
  const extraction = decodePointCloud2(msg, colorMode);
  if (!extraction) return false;
  const { positions, colors, pointCount } = extraction;

  // Re-allocate attributes whenever the point count changes. ROS lidars
  // generally hold their count steady across frames so this only fires on
  // mode change / first frame.
  const positionAttr = obj.geometry.getAttribute('position') as THREE.BufferAttribute;
  const colorAttr = obj.geometry.getAttribute('color') as THREE.BufferAttribute;

  if (positionAttr.count !== pointCount) {
    obj.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    obj.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  } else {
    (positionAttr.array as Float32Array).set(positions);
    positionAttr.needsUpdate = true;
    (colorAttr.array as Float32Array).set(colors);
    colorAttr.needsUpdate = true;
  }
  obj.geometry.computeBoundingSphere();
  obj.pointCount = pointCount;
  obj.bounds = extraction.bounds;
  return true;
}

// ---------- LaserScan ----------

export interface LaserScanObject {
  object: THREE.Points;
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  pointCount: number;
  bounds: { min: Vec3; max: Vec3 } | null;
}

export interface LaserScanMessage {
  header?: { frame_id?: string };
  angle_min?: number;
  angle_max?: number;
  angle_increment?: number;
  range_min?: number;
  range_max?: number;
  ranges?: number[] | Float32Array;
  intensities?: number[] | Float32Array;
}

export function createLaserScan(pointSize: number): LaserScanObject {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));

  const material = new THREE.PointsMaterial({
    size: pointSize,
    sizeAttenuation: false,
    vertexColors: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return { object: points, geometry, material, pointCount: 0, bounds: null };
}

export function updateLaserScan(obj: LaserScanObject, msg: LaserScanMessage): boolean {
  if (!msg || !msg.ranges || msg.angle_increment === undefined) return false;
  const ranges = msg.ranges;
  const angleMin = Number(msg.angle_min ?? 0);
  const angleInc = Number(msg.angle_increment);
  const rangeMin = Number(msg.range_min ?? 0);
  const rangeMax = Number(msg.range_max ?? Infinity);

  const positions: number[] = [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i];
    if (!Number.isFinite(r)) continue;
    if (r < rangeMin || r > rangeMax) continue;
    const a = angleMin + i * angleInc;
    const x = r * Math.cos(a);
    const y = r * Math.sin(a);
    positions.push(x, y, 0);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  const pointCount = positions.length / 3;
  const posArr = new Float32Array(positions);
  const colorArr = new Float32Array(pointCount * 3);
  // Color the ring by range (closer = blue, farther = red) so the user can
  // perceive depth around the sensor at a glance.
  let maxR = 0;
  for (let i = 0; i < pointCount; i++) {
    const x = posArr[i * 3];
    const y = posArr[i * 3 + 1];
    const r = Math.hypot(x, y);
    if (r > maxR) maxR = r;
  }
  const inv = maxR > 0 ? 1 / maxR : 0;
  for (let i = 0; i < pointCount; i++) {
    const x = posArr[i * 3];
    const y = posArr[i * 3 + 1];
    const r = Math.hypot(x, y);
    const c = turboColor(r * inv);
    colorArr[i * 3] = c.r;
    colorArr[i * 3 + 1] = c.g;
    colorArr[i * 3 + 2] = c.b;
  }

  obj.geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  obj.geometry.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  obj.geometry.computeBoundingSphere();
  obj.pointCount = pointCount;
  obj.bounds = pointCount
    ? { min: { x: minX, y: minY, z: 0 }, max: { x: maxX, y: maxY, z: 0 } }
    : null;
  return true;
}

// ---------- Pose axes ----------

export interface PoseAxesObject {
  object: THREE.Group;
  /** The axes triad — child 0. */
  axes: THREE.AxesHelper;
  /** The forward-arrow line — child 1. */
  arrow: THREE.ArrowHelper;
}

export function createPoseAxes(size: number): PoseAxesObject {
  const group = new THREE.Group();
  const axes = new THREE.AxesHelper(size);
  // Brighten the axes so they pop against the dark background.
  const colors = (axes.geometry as THREE.BufferGeometry).getAttribute('color');
  if (colors) {
    // Default AxesHelper colors are full saturation, leave them.
  }
  group.add(axes);

  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 0),
    size * 1.1,
    0xffffff,
    size * 0.25,
    size * 0.12,
  );
  group.add(arrow);
  return { object: group, axes, arrow };
}

export interface PoseSample {
  position: Vec3;
  orientation?: Quat;
}

type Vec3Like = { x?: unknown; y?: unknown; z?: unknown };
type QuatLike = { x?: unknown; y?: unknown; z?: unknown; w?: unknown };

/** Pull the pose out of an Odometry / PoseStamped / TransformStamped message. */
export function extractPose(value: Record<string, unknown> | null, type: string): PoseSample | null {
  if (!value) return null;
  const v = value as Record<string, unknown>;
  let pos: Vec3Like | undefined;
  let quat: QuatLike | undefined;

  if (type.endsWith('/Odometry') || type.endsWith('/PoseWithCovarianceStamped')) {
    const outer = v.pose as { pose?: { position?: Vec3Like; orientation?: QuatLike } } | undefined;
    pos = outer?.pose?.position;
    quat = outer?.pose?.orientation;
  } else if (type.endsWith('/PoseStamped')) {
    const pose = v.pose as { position?: Vec3Like; orientation?: QuatLike } | undefined;
    pos = pose?.position;
    quat = pose?.orientation;
  } else if (type.endsWith('/TransformStamped')) {
    const t = v.transform as { translation?: Vec3Like; rotation?: QuatLike } | undefined;
    pos = t?.translation;
    quat = t?.rotation;
  }
  if (!pos) return null;
  const x = Number(pos.x);
  const y = Number(pos.y);
  const z = Number(pos.z);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const out: PoseSample = { position: { x, y, z } };
  if (quat) {
    const qx = Number(quat.x);
    const qy = Number(quat.y);
    const qz = Number(quat.z);
    const qw = Number(quat.w);
    if (![qx, qy, qz, qw].some((n) => !Number.isFinite(n))) {
      out.orientation = { x: qx, y: qy, z: qz, w: Number.isFinite(qw) ? qw : 1 };
    }
  }
  return out;
}

export function updatePoseAxes(
  obj: PoseAxesObject,
  pose: PoseSample,
): void {
  obj.object.position.set(pose.position.x, pose.position.y, pose.position.z);
  if (pose.orientation) {
    obj.object.quaternion.set(
      pose.orientation.x,
      pose.orientation.y,
      pose.orientation.z,
      pose.orientation.w,
    );
  } else {
    obj.object.quaternion.identity();
  }
}

/** Build a faint grid in the XY plane so the user has a sense of scale. */
export function createGroundGrid(size: number, divisions: number): THREE.GridHelper {
  const grid = new THREE.GridHelper(size, divisions, 0x444c5e, 0x222530);
  // GridHelper draws on the XZ plane by default. Rotate it to XY so it
  // sits flat under ROS Z-up content.
  grid.rotation.x = Math.PI / 2;
  const mat = grid.material as THREE.LineBasicMaterial | THREE.LineBasicMaterial[];
  if (Array.isArray(mat)) {
    mat.forEach((m) => {
      m.transparent = true;
      m.opacity = 0.45;
    });
  } else {
    mat.transparent = true;
    mat.opacity = 0.45;
  }
  return grid;
}

/** Big world-frame axis triad so the user can tell which way "X" points. */
export function createWorldAxes(size: number): THREE.AxesHelper {
  const axes = new THREE.AxesHelper(size);
  return axes;
}

/** Dispose a Three.js object's GPU resources recursively. */
export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((node) => {
    const mesh = node as THREE.Mesh & { geometry?: THREE.BufferGeometry; material?: unknown };
    if (mesh.geometry) mesh.geometry.dispose();
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
    else if (m) m.dispose();
  });
}
