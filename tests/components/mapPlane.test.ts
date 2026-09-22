import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createMapPlane,
  disposeMapPlane,
  updateMapPlane,
} from '../../src/components/panels/ThreeDScene/mapPlane';
import type { OccupancyGridDecoded } from '../../src/utils/occupancyGrid';

function decodedMap(): OccupancyGridDecoded {
  return {
    width: 4,
    height: 2,
    resolution: 0.5,
    origin: {
      position: { x: 10, y: 20, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    rgba: new Uint8Array(4 * 2 * 4),
    contentKey: 'map-plane-test',
  };
}

describe('updateMapPlane', () => {
  it('places the bottom-left cell at the OccupancyGrid origin', () => {
    const map = createMapPlane();
    updateMapPlane(map, decodedMap(), 'map');
    map.object.updateMatrixWorld(true);

    expect(map.mesh.scale.toArray()).toEqual([2, 1, 1]);
    expect(map.mesh.position.toArray()).toEqual([1, 0.5, 0]);

    const bounds = new THREE.Box3().setFromObject(map.object);
    expect(bounds.min.x).toBeCloseTo(10);
    expect(bounds.min.y).toBeCloseTo(20);
    expect(bounds.max.x).toBeCloseTo(12);
    expect(bounds.max.y).toBeCloseTo(21);

    disposeMapPlane(map);
  });

  it('short-circuits identical data rendered with the same scheme', () => {
    const map = createMapPlane();
    updateMapPlane(map, decodedMap(), 'map');
    const firstTexture = map.texture;
    expect(firstTexture).not.toBeNull();
    expect(map.lastScheme).toBe('map');

    updateMapPlane(map, decodedMap(), 'map');

    expect(map.texture).toBe(firstTexture);
    expect(map.lastScheme).toBe('map');

    disposeMapPlane(map);
  });

  it('rebuilds the texture when only the color scheme changes', () => {
    const map = createMapPlane();
    updateMapPlane(map, decodedMap(), 'map');
    const firstTexture = map.texture;
    expect(firstTexture).not.toBeNull();

    // Same cells (same contentKey), different palette - the scheme buttons
    // must recolor a static map without waiting for the publisher to tick.
    updateMapPlane(map, decodedMap(), 'costmap');

    expect(map.texture).not.toBe(firstTexture);
    expect(map.material.map).toBe(map.texture);
    expect(map.lastScheme).toBe('costmap');
    expect(map.lastContentKey).toBe('map-plane-test');

    // And the next tick with the settled scheme short-circuits again.
    const secondTexture = map.texture;
    updateMapPlane(map, decodedMap(), 'costmap');
    expect(map.texture).toBe(secondTexture);

    disposeMapPlane(map);
  });
});
