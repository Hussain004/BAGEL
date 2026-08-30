import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createLaserScan,
  createPoseAxes,
  disposeObject,
  setCloudStyle,
  setPoseAxesColor,
  setPoseAxesStyle,
  updatePoseAxes,
} from '../../src/components/panels/ThreeDScene/sceneObjects';

describe('setCloudStyle', () => {
  it('applies a uniform scan color and per-layer point size', () => {
    const scan = createLaserScan(2);

    setCloudStyle(scan, 5.5, '#ff3366');

    expect(scan.material.size).toBe(5.5);
    expect(scan.material.vertexColors).toBe(false);
    expect(scan.material.color.getHexString()).toBe('ff3366');

    disposeObject(scan.object);
  });

  it('restores decoded per-point colors in automatic mode', () => {
    const scan = createLaserScan(2);
    setCloudStyle(scan, 4, '#ff3366');

    setCloudStyle(scan, 3, null);

    expect(scan.material.size).toBe(3);
    expect(scan.material.vertexColors).toBe(true);
    expect(scan.material.color.getHexString()).toBe('ffffff');

    disposeObject(scan.object);
  });
});

describe('pose axes', () => {
  it('shows the arrow by default and switches to the robot puck', () => {
    const pose = createPoseAxes(1, '#22d3ee');
    expect(pose.arrow.visible).toBe(true);
    expect(pose.robot.visible).toBe(false);
    expect(pose.axes.visible).toBe(false);

    setPoseAxesStyle(pose, 'robot', true);
    expect(pose.arrow.visible).toBe(false);
    expect(pose.robot.visible).toBe(true);
    expect(pose.axes.visible).toBe(true);

    disposeObject(pose.object);
  });

  it('flattens roll/pitch to yaw-only when requested', () => {
    const pose = createPoseAxes(1);
    // 90 degree roll about X, no yaw.
    updatePoseAxes(
      pose,
      { position: { x: 1, y: 2, z: 3 }, orientation: { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 } },
      true,
    );

    expect(pose.object.quaternion.x).toBeCloseTo(0);
    expect(pose.object.quaternion.y).toBeCloseTo(0);
    expect(pose.object.quaternion.z).toBeCloseTo(0);
    expect(pose.object.quaternion.w).toBeCloseTo(1);
    expect(pose.object.position.x).toBe(1);

    disposeObject(pose.object);
  });

  it('recolors the arrow and robot body but leaves the heading nose white', () => {
    const pose = createPoseAxes(1, '#22d3ee');

    setPoseAxesColor(pose, '#ff3366');

    pose.arrow.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        expect((child.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('ff3366');
      }
    });
    const body = pose.robot.getObjectByName('body') as THREE.Mesh;
    const nose = pose.robot.children.find((c) => c !== body) as THREE.Mesh;
    expect((body.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('ff3366');
    expect((nose.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('ffffff');

    disposeObject(pose.object);
  });
});
