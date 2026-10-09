/**
 * The sample bag's sensors share one world. These tests pin the properties that
 * make the demo honest: the camera, the LiDAR and the detector agree.
 */

import { describe, expect, it } from 'vitest';
import type { CameraIntrinsics } from '../../src/hooks/useCameraInfo';
import { projectCloud } from '../../src/utils/projectCloud';
import {
  CAM,
  CAMERA_MOUNT,
  LIDAR_MOUNT,
  OPTICAL_QUAT,
  WORLD,
  detect,
  figureEightPose,
  lidarSweep,
  renderCamera,
} from '../../scripts/sample-world.mjs';

const intrinsics: CameraIntrinsics = {
  fx: CAM.fx, fy: CAM.fy, cx: CAM.cx, cy: CAM.cy, width: CAM.w, height: CAM.h,
  distortionCoefficients: CAM.d, distortionModel: 'plumb_bob', frameId: 'camera_optical_link', timestamp: 0n,
};

/** lidar_link -> camera_optical_link as a column-major 4x4 (what BAGEL's TF chain would compose). */
function lidarToOptical(): number[] {
  const t = { x: LIDAR_MOUNT.x - CAMERA_MOUNT.x, y: LIDAR_MOUNT.y - CAMERA_MOUNT.y, z: LIDAR_MOUNT.z - CAMERA_MOUNT.z };
  // optical = (-y, -z, x) of the base-frame offset
  return [0, 0, 1, 0, -1, 0, 0, 0, 0, -1, 0, 0, -t.y, -t.z, t.x, 1];
}

function rotate(q: { x: number; y: number; z: number; w: number }, v: [number, number, number]): number[] {
  const [x, y, z] = v;
  // v' = v + 2w(q x v) + 2 q x (q x v)
  const cx = q.y * z - q.z * y;
  const cy = q.z * x - q.x * z;
  const cz = q.x * y - q.y * x;
  const dx = q.y * cz - q.z * cy;
  const dy = q.z * cx - q.x * cz;
  const dz = q.x * cy - q.y * cx;
  return [x + 2 * (q.w * cx + dx), y + 2 * (q.w * cy + dy), z + 2 * (q.w * cz + dz)].map((n) => Math.round(n * 1e9) / 1e9);
}

describe('optical frame quaternions', () => {
  it('front: z forward is +x, x right is -y, y down is -z in base_link', () => {
    expect(rotate(OPTICAL_QUAT.front, [0, 0, 1])).toEqual([1, 0, 0]);
    expect(rotate(OPTICAL_QUAT.front, [1, 0, 0])).toEqual([0, -1, 0]);
    expect(rotate(OPTICAL_QUAT.front, [0, 1, 0])).toEqual([0, 0, -1]);
  });
  it('rear: z forward is -x, x right is +y, y down is -z', () => {
    expect(rotate(OPTICAL_QUAT.rear, [0, 0, 1])).toEqual([-1, 0, 0]);
    expect(rotate(OPTICAL_QUAT.rear, [1, 0, 0])).toEqual([0, 1, 0]);
    expect(rotate(OPTICAL_QUAT.rear, [0, 1, 0])).toEqual([0, 0, -1]);
  });
});

describe('the sensors agree', () => {
  it('every detected car has LiDAR returns inside its box, so the two sensors saw the same object', () => {
    let boxesChecked = 0;
    for (const t of [4, 10, 13, 22.5, 26]) {
      const pose = figureEightPose(t);
      const boxes = detect(pose, 1).filter((b) => b.cls === 'car');
      const car = lidarSweep(pose, 1).filter((p) => p[3] === 0.95);
      const proj = projectCloud(Float32Array.from(car.flatMap((p) => [p[0]!, p[1]!, p[2]!])), lidarToOptical(), intrinsics);
      for (const b of boxes) {
        let hits = 0;
        for (let i = 0; i < proj.count; i++) {
          const u = proj.u[i]!;
          const v = proj.v[i]!;
          if (u >= b.cx - b.w / 2 - 3 && u <= b.cx + b.w / 2 + 3 && v >= b.cy - b.h / 2 - 3 && v <= b.cy + b.h / 2 + 3) hits++;
        }
        expect(hits, `t=${t} car box ${b.cx.toFixed(0)},${b.cy.toFixed(0)}`).toBeGreaterThan(0);
        boxesChecked++;
      }
    }
    expect(boxesChecked).toBeGreaterThan(3);
  });

  it('pedestrians stand beside the route, never on it', () => {
    for (const b of WORLD.filter((w: { label: string }) => w.label === 'person')) {
      const cx = (b.min[0] + b.max[0]) / 2;
      const cy = (b.min[1] + b.max[1]) / 2;
      let nearest = Infinity;
      for (let t = 0; t <= 30; t += 0.05) {
        const p = figureEightPose(t);
        nearest = Math.min(nearest, Math.hypot(p.x - cx, p.y - cy));
      }
      expect(nearest, `person at (${cx.toFixed(1)}, ${cy.toFixed(1)})`).toBeGreaterThan(0.95);
    }
  });

  it('is deterministic: the same pose renders the same bytes and the same sweep', () => {
    const pose = figureEightPose(7);
    expect(Buffer.from(renderCamera(pose)).equals(Buffer.from(renderCamera(pose)))).toBe(true);
    expect(lidarSweep(pose, 3)).toEqual(lidarSweep(pose, 3));
    expect(lidarSweep(pose, 3)).not.toEqual(lidarSweep(pose, 4)); // noise differs per sweep
  });
});
