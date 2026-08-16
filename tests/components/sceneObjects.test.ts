import { describe, expect, it } from 'vitest';
import {
  createLaserScan,
  disposeObject,
  setCloudStyle,
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
