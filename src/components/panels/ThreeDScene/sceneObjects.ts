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
import type { PoseDisplayStyle } from '../../../store/threeDPanelStore';

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

/** Apply point size and an optional uniform color without rebuilding geometry. */
export function setCloudStyle(
  obj: CloudObject,
  pointSize: number,
  color?: string | null,
): void {
  obj.material.size = pointSize;
  obj.material.vertexColors = !color;
  obj.material.color.set(color ?? 0xffffff);
  obj.material.needsUpdate = true;
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

// ---------- Robot body (shared by the TF-driven RobotMarker and the
// pose-message-driven "robot" pose style) ----------

const ROBOT_BODY_RADIUS = 0.14;
const ROBOT_BODY_HEIGHT = 0.05;

/** Small puck with a flat heading wedge on top, in the object's own frame (ROS X-forward, Z-up). */
export function createRobotBody(
  colorHex: THREE.ColorRepresentation,
  radius = ROBOT_BODY_RADIUS,
  height = ROBOT_BODY_HEIGHT,
): THREE.Group {
  const color = new THREE.Color(colorHex);

  const bodyGeometry = new THREE.CylinderGeometry(radius, radius, height, 24);
  bodyGeometry.rotateX(Math.PI / 2); // cylinder axis Y -> Z, so it sits flat on the ground plane
  const body = new THREE.Mesh(bodyGeometry, new THREE.MeshBasicMaterial({ color }));
  body.position.z = height / 2;

  const noseShape = new THREE.Shape();
  noseShape.moveTo(0, radius * 0.55);
  noseShape.lineTo(radius * 1.35, 0);
  noseShape.lineTo(0, -radius * 0.55);
  noseShape.closePath();
  const nose = new THREE.Mesh(
    new THREE.ShapeGeometry(noseShape),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  nose.position.z = height + 0.001; // just above the puck top face

  const group = new THREE.Group();
  group.add(body, nose);
  return group;
}

// ---------- Pose axes ----------

/**
 * Solid mesh arrow (cylinder shaft + cone head) instead of `THREE.ArrowHelper`
 * - the helper's shaft is a `THREE.Line`, whose width WebGL clamps to ~1px on
 * most platforms regardless of `linewidth`, so it can't be made thicker.
 */
function createThickArrow(size: number, colorHex: THREE.ColorRepresentation): THREE.Group {
  const headLength = size * 0.35;
  const shaftLength = size - headLength;
  const shaftRadius = size * 0.06;
  const headRadius = size * 0.16;
  const material = new THREE.MeshBasicMaterial({ color: colorHex });

  const shaftGeometry = new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 12);
  shaftGeometry.rotateZ(-Math.PI / 2); // cylinder axis Y -> X (ROS forward)
  shaftGeometry.translate(shaftLength / 2, 0, 0);
  const shaft = new THREE.Mesh(shaftGeometry, material);

  const headGeometry = new THREE.ConeGeometry(headRadius, headLength, 12);
  headGeometry.rotateZ(-Math.PI / 2);
  headGeometry.translate(shaftLength + headLength / 2, 0, 0);
  const head = new THREE.Mesh(headGeometry, material);

  const group = new THREE.Group();
  group.add(shaft, head);
  return group;
}

export interface PoseAxesObject {
  object: THREE.Group;
  axes: THREE.AxesHelper;
  arrow: THREE.Group;
  robot: THREE.Group;
}

export function createPoseAxes(
  size: number,
  colorHex: THREE.ColorRepresentation = 0xffffff,
): PoseAxesObject {
  const group = new THREE.Group();
  const axes = new THREE.AxesHelper(size);
  axes.visible = false;
  group.add(axes);

  const arrow = createThickArrow(size * 1.1, colorHex);
  group.add(arrow);

  const robot = createRobotBody(colorHex);
  robot.visible = false;
  group.add(robot);

  return { object: group, axes, arrow, robot };
}

/** Switch between the arrow/robot representations and the XYZ tripod, without rebuilding geometry. */
export function setPoseAxesStyle(
  obj: PoseAxesObject,
  style: PoseDisplayStyle,
  showAxesTripod: boolean,
): void {
  obj.arrow.visible = style === 'arrow';
  obj.robot.visible = style === 'robot';
  obj.axes.visible = showAxesTripod;
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

/** Project a quaternion onto a yaw-only rotation about Z, discarding roll/pitch. */
function yawOnlyQuaternion(q: { x: number; y: number; z: number; w: number }) {
  const yaw = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
  return { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
}

export function updatePoseAxes(
  obj: PoseAxesObject,
  pose: PoseSample,
  flattenOrientation = false,
): void {
  obj.object.position.set(pose.position.x, pose.position.y, pose.position.z);
  if (pose.orientation) {
    const q = flattenOrientation ? yawOnlyQuaternion(pose.orientation) : pose.orientation;
    obj.object.quaternion.set(q.x, q.y, q.z, q.w);
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
