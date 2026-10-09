/**
 * Wireframe boxes for `vision_msgs/Detection3DArray`.
 *
 * `extractBoxes` is pure (message in, packed floats out) and tested on its
 * own; the THREE layer below only uploads what it is given. Every box of a
 * message goes into ONE LineSegments, 12 edges each, so a busy detector
 * costs one draw call.
 */

import * as THREE from 'three';
import { bestHypothesis, classColor } from '../../../utils/detections';

/** Upper bound on boxes drawn from one message. */
export const MAX_BOXES = 2_000;

type Obj = Record<string, unknown>;

export interface BoxExtract {
  /** 24 vertices (12 edges) per box, xyz each. */
  positions: Float32Array;
  /** One colour per box as `#rrggbb`, from its best class. */
  colors: string[];
}

function num(v: unknown): number | null {
  const n = typeof v === 'bigint' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** The 12 edges of a unit cube as pairs of corner indices (corner bit order: x, y, z). */
const EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along x
  [0, 2], [1, 3], [4, 6], [5, 7], // along y
  [0, 4], [1, 5], [2, 6], [3, 7], // along z
];

/**
 * Boxes of a Detection3DArray, in the message's frame. Accepts `bbox.center`
 * as a Pose (every released vision_msgs); a box with a missing, non-finite or
 * non-positive size is skipped. An all-zero orientation (a producer that never
 * filled it in) is treated as no rotation rather than producing NaNs.
 */
export function extractBoxes(msg: Obj | null | undefined): BoxExtract {
  const dets = Array.isArray(msg?.detections) ? (msg!.detections as unknown[]) : [];
  const out: number[] = [];
  const colors: string[] = [];
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  for (const raw of dets) {
    if (colors.length >= MAX_BOXES) break;
    const det = raw as Obj | null;
    const bbox = det?.bbox as Obj | undefined;
    const center = bbox?.center as Obj | undefined;
    const pos = (center?.position ?? center) as Obj | undefined;
    const size = bbox?.size as Obj | undefined;
    const sx = num(size?.x);
    const sy = num(size?.y);
    const sz = num(size?.z);
    const px = num(pos?.x);
    const py = num(pos?.y);
    const pz = num(pos?.z);
    if (sx === null || sy === null || sz === null || px === null || py === null || pz === null) continue;
    if (sx <= 0 || sy <= 0 || sz <= 0) continue;
    const o = center?.orientation as Obj | undefined;
    const qx = num(o?.x) ?? 0;
    const qy = num(o?.y) ?? 0;
    const qz = num(o?.z) ?? 0;
    const qw = num(o?.w) ?? 1;
    if (qx === 0 && qy === 0 && qz === 0 && qw === 0) q.identity();
    else q.set(qx, qy, qz, qw).normalize();
    const corner = (i: number): [number, number, number] => {
      v.set((i & 1 ? 0.5 : -0.5) * sx, (i & 2 ? 0.5 : -0.5) * sy, (i & 4 ? 0.5 : -0.5) * sz)
        .applyQuaternion(q);
      return [v.x + px, v.y + py, v.z + pz];
    };
    const cs = [0, 1, 2, 3, 4, 5, 6, 7].map(corner);
    for (const [a, b] of EDGES) out.push(...cs[a]!, ...cs[b]!);
    colors.push(classColor(bestHypothesis(det?.results).classKey));
  }
  return { positions: Float32Array.from(out), colors };
}

export interface BoxLayer {
  object: THREE.Group;
  lines: THREE.LineSegments;
  /** Per-box colours from the last update, kept so an override can be undone. */
  boxColors: string[];
  /** A single colour forced on every box, or null to colour by class. */
  override: string | null;
}

export function createBoxLayer(override: string | null): BoxLayer {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true }));
  lines.frustumCulled = false;
  const object = new THREE.Group();
  object.add(lines);
  return { object, lines, boxColors: [], override };
}

function paint(layer: BoxLayer): void {
  const geometry = layer.lines.geometry;
  const verts = layer.boxColors.length * 24;
  const colors = new Float32Array(verts * 3);
  const c = new THREE.Color();
  layer.boxColors.forEach((hex, box) => {
    c.set(layer.override ?? hex);
    for (let i = 0; i < 24; i++) c.toArray(colors, (box * 24 + i) * 3);
  });
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

export function updateBoxLayer(layer: BoxLayer, boxes: BoxExtract): void {
  const geometry = layer.lines.geometry;
  geometry.setAttribute('position', new THREE.BufferAttribute(boxes.positions, 3));
  layer.boxColors = boxes.colors;
  paint(layer);
  geometry.setDrawRange(0, boxes.positions.length / 3);
}

export function setBoxLayerColor(layer: BoxLayer, override: string | null): void {
  layer.override = override;
  paint(layer);
}
