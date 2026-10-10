import * as THREE from 'three';
import type { Goal2D } from '../../../live/controlCodec';

export interface XY {
  x: number;
  y: number;
}

/**
 * A drag from where the robot should go to a point in the direction it should
 * face. Null when the drag is too short to mean a direction (a plain click).
 */
export function dragToGoal(start: XY, end: XY, minLength: number): Goal2D | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < minLength) return null;
  return { x: start.x, y: start.y, yaw: Math.atan2(dy, dx) };
}

export function formatGoal(g: Goal2D): string {
  const deg = ((g.yaw * 180) / Math.PI + 360) % 360;
  return `x ${g.x.toFixed(2)} m, y ${g.y.toFixed(2)} m, facing ${deg.toFixed(0)} deg`;
}

/**
 * Where the pointer's ray meets the ground (z = 0) of the world group, in that
 * group's own coordinates, i.e. the fixed frame the panel is drawing, whatever
 * way the group is rotated for the chosen up axis.
 */
export function pickGroundLocal(camera: THREE.Camera, canvas: HTMLCanvasElement, clientX: number, clientY: number, world: THREE.Object3D): XY | null {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  world.updateWorldMatrix(true, false);
  const ray = raycaster.ray.clone().applyMatrix4(new THREE.Matrix4().copy(world.matrixWorld).invert());
  const hit = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), new THREE.Vector3());
  return hit ? { x: hit.x, y: hit.y } : null;
}

export interface GoalMarker {
  object: THREE.Group;
  update(goal: Goal2D | null, size: number): void;
  dispose(): void;
}

/** An arrow lying on the ground at the goal, pointing the way the robot will face. */
export function createGoalMarker(): GoalMarker {
  const object = new THREE.Group();
  object.visible = false;
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xf43f5e, 0.35, 0.25);
  for (const part of [arrow.line, arrow.cone]) {
    (part.material as THREE.Material).depthTest = false;
    part.renderOrder = 1000;
  }
  object.add(arrow);
  return {
    object,
    update(goal, size) {
      object.visible = goal !== null;
      if (!goal) return;
      object.position.set(goal.x, goal.y, 0.02);
      arrow.setDirection(new THREE.Vector3(Math.cos(goal.yaw), Math.sin(goal.yaw), 0));
      arrow.setLength(size, size * 0.35, size * 0.25);
    },
    dispose() {
      arrow.dispose();
    },
  };
}
