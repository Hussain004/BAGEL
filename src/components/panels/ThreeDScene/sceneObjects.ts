/**
 * Three.js scene-object builders for the 3D panel.
 *
 * One factory per message kind we render:
 *   - PointCloud  (sensor_msgs/PointCloud2)
 *   - LaserScan   (sensor_msgs/LaserScan)
 *   - PoseAxes    (Odometry / PoseStamped / PoseWithCovarianceStamped /
 *                  TransformStamped)
 *
 * Cloud objects accept pre-decoded Float32Array positions + colors so they
 * don't have to walk the message bytes themselves — the worker has already
 * handed them over via transferable buffers.
 */

import * as THREE from 'three';

export interface PointBuffersInput {
  positions: Float32Array;
  colors: Float32Array;
  pointCount: number;
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  } | null;
}

export interface CloudObject {
  object: THREE.Points;
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  pointCount: number;
  bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
}

function makePointsObject(pointSize: number): CloudObject {
  const geometry = new THREE.BufferGeometry();
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

export function createPointCloud(pointSize: number): CloudObject {
  return makePointsObject(pointSize);
}

export function createLaserScan(pointSize: number): CloudObject {
  return makePointsObject(pointSize);
}

/**
 * Swap the BufferAttribute backing arrays in-place. We always set new
 * BufferAttributes (instead of writing into the existing array) because the
 * incoming Float32Arrays come from transferable postMessage — they're owned
 * by us now, and reusing them avoids the cost of copying into an existing
 * geometry. The previous attribute's buffer is dropped on the next
 * Three.js render once nothing references it.
 */
export function updateCloud(obj: CloudObject, input: PointBuffersInput): void {
  obj.geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(input.positions, 3),
  );
  obj.geometry.setAttribute('color', new THREE.BufferAttribute(input.colors, 3));
  obj.geometry.computeBoundingSphere();
  obj.pointCount = input.pointCount;
  obj.bounds = input.bounds;
}

// ---------- Pose axes ----------

export interface PoseAxesObject {
  object: THREE.Group;
  axes: THREE.AxesHelper;
  arrow: THREE.ArrowHelper;
}

export function createPoseAxes(size: number): PoseAxesObject {
  const group = new THREE.Group();
  const axes = new THREE.AxesHelper(size);
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
  position: { x: number; y: number; z: number };
  orientation?: { x: number; y: number; z: number; w: number };
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

export function updatePoseAxes(obj: PoseAxesObject, pose: PoseSample): void {
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
  return new THREE.AxesHelper(size);
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
