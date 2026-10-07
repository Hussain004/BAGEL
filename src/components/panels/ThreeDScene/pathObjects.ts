/**
 * Line and arrow layers for `nav_msgs/Path`, `geometry_msgs/PoseArray` and
 * polygon messages.
 *
 * Extraction functions are pure (message in, packed floats out) and tested on
 * their own; the THREE builders below only upload what they are given. A
 * Nav2 particle cloud routinely publishes thousands of poses, so poses render
 * as ONE instanced mesh rather than one object each.
 */

import * as THREE from 'three';

/** Upper bound on poses drawn from one PoseArray; keeps a runaway message from stalling the frame. */
export const MAX_POSES = 20_000;
/** Upper bound on vertices drawn for a path or polygon. */
export const MAX_PATH_POINTS = 200_000;

type Obj = Record<string, unknown>;

function num(v: unknown): number | null {
  const n = typeof v === 'bigint' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function point(v: unknown): [number, number, number] | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Obj;
  const x = num(p.x);
  const y = num(p.y);
  if (x === null || y === null) return null;
  // 2D polygons (Polygon2D) and some planners leave z unset; treat as 0.
  return [x, y, num(p.z) ?? 0];
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function packPoints(points: Iterable<[number, number, number] | null>, cap: number): Float32Array {
  const out: number[] = [];
  let n = 0;
  for (const p of points) {
    if (!p) continue;
    out.push(p[0], p[1], p[2]);
    if (++n >= cap) break;
  }
  return Float32Array.from(out);
}

/** xyz per vertex of a `nav_msgs/Path` (`poses[].pose.position`). Non-finite poses are skipped. */
export function extractPathPositions(msg: Obj | null | undefined): Float32Array {
  const poses = asArray(msg?.poses);
  return packPoints(
    poses.map((p) => point(((p as Obj | null)?.pose as Obj | undefined)?.position)),
    MAX_PATH_POINTS,
  );
}

/**
 * xyz per vertex of a polygon. Accepts `geometry_msgs/PolygonStamped`
 * (`polygon.points`), a bare `geometry_msgs/Polygon` (`points`), and
 * `Polygon2D`-style vertices with no z.
 */
export function extractPolygonPositions(msg: Obj | null | undefined): Float32Array {
  const inner = (msg?.polygon as Obj | undefined) ?? msg;
  return packPoints(asArray(inner?.points).map(point), MAX_PATH_POINTS);
}

/**
 * Seven floats per pose: x y z qx qy qz qw. A pose whose quaternion is all
 * zeros (an unset orientation) becomes identity so it still draws, pointing
 * along +X, rather than collapsing to a degenerate matrix.
 */
export function extractPoseArray(msg: Obj | null | undefined): Float32Array {
  const poses = asArray(msg?.poses);
  const out: number[] = [];
  let n = 0;
  for (const raw of poses) {
    const pos = point((raw as Obj | null)?.position);
    if (!pos) continue;
    const q = ((raw as Obj).orientation ?? {}) as Obj;
    let qx = num(q.x) ?? 0;
    let qy = num(q.y) ?? 0;
    let qz = num(q.z) ?? 0;
    let qw = num(q.w) ?? 0;
    const len = Math.hypot(qx, qy, qz, qw);
    if (len < 1e-9) {
      qx = qy = qz = 0;
      qw = 1;
    } else {
      qx /= len;
      qy /= len;
      qz /= len;
      qw /= len;
    }
    out.push(pos[0], pos[1], pos[2], qx, qy, qz, qw);
    if (++n >= MAX_POSES) break;
  }
  return Float32Array.from(out);
}

// ── THREE layers ──────────────────────────────────────────────────────────

export interface LineLayer {
  object: THREE.Group;
  line: THREE.Line;
  /** Vertices currently uploaded. */
  count: number;
}

export function createLineLayer(color: THREE.ColorRepresentation, closed: boolean): LineLayer {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  const material = new THREE.LineBasicMaterial({ color });
  const line = closed ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material);
  // Bounds are not maintained as vertices change, and the line is cheap to draw.
  line.frustumCulled = false;
  const object = new THREE.Group();
  object.add(line);
  return { object, line, count: 0 };
}

export function updateLineLayer(layer: LineLayer, positions: Float32Array): void {
  const geometry = layer.line.geometry;
  const current = geometry.getAttribute('position') as THREE.BufferAttribute;
  if (current.array.length < positions.length) {
    // Grow geometrically so a path that lengthens every frame does not
    // reallocate on every update.
    const next = new Float32Array(Math.max(positions.length, current.array.length * 2));
    next.set(positions);
    geometry.setAttribute('position', new THREE.BufferAttribute(next, 3));
  } else {
    (current.array as Float32Array).set(positions);
    current.needsUpdate = true;
  }
  layer.count = positions.length / 3;
  geometry.setDrawRange(0, layer.count);
}

export interface PoseArrayLayer {
  object: THREE.Group;
  mesh: THREE.InstancedMesh | null;
  capacity: number;
  count: number;
  color: THREE.Color;
}

export function createPoseArrayLayer(color: THREE.ColorRepresentation): PoseArrayLayer {
  return { object: new THREE.Group(), mesh: null, capacity: 0, count: 0, color: new THREE.Color(color) };
}

/** A small cone whose tip points along +X, the ROS forward direction. */
function arrowGeometry(): THREE.BufferGeometry {
  const g = new THREE.ConeGeometry(0.04, 0.2, 8);
  g.rotateZ(-Math.PI / 2);
  // Put the base at the pose origin so the arrow starts where the pose is.
  g.translate(0.1, 0, 0);
  return g;
}

const scratchMatrix = new THREE.Matrix4();
const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const UNIT = new THREE.Vector3(1, 1, 1);

export function updatePoseArrayLayer(layer: PoseArrayLayer, poses: Float32Array): void {
  const n = poses.length / 7;
  if (n > layer.capacity) {
    if (layer.mesh) {
      layer.object.remove(layer.mesh);
      layer.mesh.geometry.dispose();
      (layer.mesh.material as THREE.Material).dispose();
      layer.mesh.dispose();
    }
    const capacity = Math.min(MAX_POSES, Math.max(n, layer.capacity * 2, 64));
    const mesh = new THREE.InstancedMesh(
      arrowGeometry(),
      new THREE.MeshBasicMaterial({ color: layer.color }),
      capacity,
    );
    mesh.frustumCulled = false;
    layer.object.add(mesh);
    layer.mesh = mesh;
    layer.capacity = capacity;
  }
  const mesh = layer.mesh;
  if (!mesh) {
    layer.count = 0;
    return;
  }
  for (let i = 0; i < n; i++) {
    const o = i * 7;
    scratchPos.set(poses[o]!, poses[o + 1]!, poses[o + 2]!);
    scratchQuat.set(poses[o + 3]!, poses[o + 4]!, poses[o + 5]!, poses[o + 6]!);
    scratchMatrix.compose(scratchPos, scratchQuat, UNIT);
    mesh.setMatrixAt(i, scratchMatrix);
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  layer.count = n;
}

export function setPoseArrayColor(layer: PoseArrayLayer, color: THREE.ColorRepresentation): void {
  layer.color.set(color);
  if (layer.mesh) (layer.mesh.material as THREE.MeshBasicMaterial).color.copy(layer.color);
}

export function setLineLayerColor(layer: LineLayer, color: THREE.ColorRepresentation): void {
  (layer.line.material as THREE.LineBasicMaterial).color.set(color);
}
