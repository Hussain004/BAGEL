/**
 * Tests for the v1.3.1 marker factories: MESH_RESOURCE and TRIANGLE_LIST.
 *
 * The CUBE / SPHERE / ARROW / LINE_* / POINTS / TEXT_VIEW_FACING factories
 * have shipped since v0.8 and aren't re-covered here; the surface that
 * needs gating is the lazy mesh-loader swap-in and the new triangle-soup
 * geometry path.
 *
 * `loadMesh` is mocked at the module boundary so these tests stay
 * dependency-free (no real STL / Collada fixtures, no network).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';

const { mockedLoadMesh, MockMeshLoadError } = vi.hoisted(() => {
  class MockMeshLoadError extends Error {
    readonly uri: string;
    readonly kind: 'stl' | 'dae' | 'obj' | null;
    constructor(uri: string, kind: 'stl' | 'dae' | 'obj' | null, message: string) {
      super(`Failed to load mesh "${uri}": ${message}`);
      this.name = 'MeshLoadError';
      this.uri = uri;
      this.kind = kind;
    }
  }
  return { mockedLoadMesh: vi.fn(), MockMeshLoadError };
});

vi.mock('../../src/utils/meshLoader', () => ({
  loadMesh: mockedLoadMesh,
  MeshLoadError: MockMeshLoadError,
}));

// Imported after vi.mock so the marker factory picks up the mocked module.
import {
  createMarkerObject,
  normaliseMarker,
  MARKER_TYPE,
  MARKER_ACTION,
  type MarkerData,
} from '../../src/components/panels/ThreeDScene/markerObjects';

function baseMarker(overrides: Partial<MarkerData> = {}): MarkerData {
  return {
    ns: 'test',
    id: 1,
    type: MARKER_TYPE.MESH_RESOURCE,
    action: MARKER_ACTION.ADD,
    pose: {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    scale: { x: 1, y: 1, z: 1 },
    color: { r: 1, g: 0, b: 0, a: 1 },
    lifetimeNs: 0n,
    stampNs: 0n,
    frameLocked: false,
    frameId: 'base_link',
    points: [],
    colors: [],
    text: '',
    meshResource: '',
    meshUseEmbeddedMaterials: false,
    ...overrides,
  };
}

// Drain enough microtasks for a chained .then() callback to finish.
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  mockedLoadMesh.mockReset();
});

describe('MESH_RESOURCE marker', () => {
  it('shows the wireframe placeholder while the load is in flight', () => {
    // A promise that never resolves keeps the loader in-flight forever.
    mockedLoadMesh.mockReturnValue(new Promise<THREE.Object3D>(() => {}));
    const rm = createMarkerObject(MARKER_TYPE.MESH_RESOURCE);
    rm.update(baseMarker({ meshResource: 'package://my_pkg/m.stl' }));

    const group = rm.object as THREE.Group;
    expect(group.type).toBe('Group');
    const visible = group.children.filter((c) => c.visible !== false);
    expect(visible).toHaveLength(1);
    const placeholder = visible[0] as THREE.Mesh;
    expect((placeholder.material as THREE.MeshBasicMaterial).wireframe).toBe(true);
    expect(mockedLoadMesh).toHaveBeenCalledTimes(1);
    expect(mockedLoadMesh).toHaveBeenCalledWith('package://my_pkg/m.stl');
    rm.dispose();
  });

  it('swaps the placeholder for the loaded mesh on resolve and tints by marker.color', async () => {
    const original = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const loadedMesh = new THREE.Mesh(new THREE.BoxGeometry(), original);
    const loadedRoot = new THREE.Group();
    loadedRoot.add(loadedMesh);
    mockedLoadMesh.mockResolvedValue(loadedRoot);

    const rm = createMarkerObject(MARKER_TYPE.MESH_RESOURCE);
    rm.update(
      baseMarker({
        meshResource: 'package://my_pkg/m.stl',
        color: { r: 1, g: 0, b: 0, a: 1 },
        meshUseEmbeddedMaterials: false,
      }),
    );
    await flush();

    const group = rm.object as THREE.Group;
    expect(group.children).toContain(loadedRoot);
    // Placeholder is hidden but still parented (cheap to keep around).
    const placeholder = group.children.find((c) => c !== loadedRoot) as THREE.Mesh;
    expect(placeholder.visible).toBe(false);

    // Tint applied: the on-scene material is a clone tinted red.
    const sceneMat = loadedMesh.material as THREE.MeshLambertMaterial;
    expect(sceneMat.color.r).toBeCloseTo(1, 3);
    expect(sceneMat.color.g).toBeCloseTo(0, 3);
    expect(sceneMat.color.b).toBeCloseTo(0, 3);
    // The original material is untouched because we clone before mutating.
    expect(original.color.getHex()).toBe(0xffffff);

    rm.dispose();
  });

  it('keeps the placeholder and warns once when the loader rejects', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockedLoadMesh.mockRejectedValue(
      new MockMeshLoadError('package://x/y.stl', null, 'No mapping for package "x".'),
    );

    const rm = createMarkerObject(MARKER_TYPE.MESH_RESOURCE);
    rm.update(baseMarker({ meshResource: 'package://x/y.stl' }));
    await flush();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toMatch(/MESH_RESOURCE failed/);
    expect(String(warnSpy.mock.calls[0][0])).toMatch(/No mapping for package/);
    // Placeholder still visible.
    const placeholder = (rm.object as THREE.Group).children[0] as THREE.Mesh;
    expect(placeholder.visible).toBe(true);

    warnSpy.mockRestore();
    rm.dispose();
  });

  it('keeps embedded materials intact when mesh_use_embedded_materials is true', async () => {
    const original = new THREE.MeshLambertMaterial({ color: 0x00ffff });
    const loadedMesh = new THREE.Mesh(new THREE.BoxGeometry(), original);
    const loadedRoot = new THREE.Group();
    loadedRoot.add(loadedMesh);
    mockedLoadMesh.mockResolvedValue(loadedRoot);

    const rm = createMarkerObject(MARKER_TYPE.MESH_RESOURCE);
    rm.update(
      baseMarker({
        meshResource: 'package://my_pkg/m.dae',
        color: { r: 1, g: 0, b: 0, a: 1 },
        meshUseEmbeddedMaterials: true,
      }),
    );
    await flush();

    // Embedded materials path: the loaded mesh keeps its original colour
    // exactly, not the marker's red.
    expect((loadedMesh.material as THREE.MeshLambertMaterial).color.getHex()).toBe(0x00ffff);
    rm.dispose();
  });

  it('discards a stale load when the URI changes between updates', async () => {
    let resolveFirst: (value: THREE.Object3D) => void = () => {};
    const firstLoad = new Promise<THREE.Object3D>((res) => {
      resolveFirst = res;
    });
    mockedLoadMesh.mockReturnValueOnce(firstLoad);

    const secondMesh = new THREE.Mesh(
      new THREE.SphereGeometry(),
      new THREE.MeshLambertMaterial(),
    );
    const secondRoot = new THREE.Group();
    secondRoot.add(secondMesh);
    mockedLoadMesh.mockResolvedValueOnce(secondRoot);

    const rm = createMarkerObject(MARKER_TYPE.MESH_RESOURCE);
    rm.update(baseMarker({ meshResource: 'package://a/x.stl' }));
    rm.update(baseMarker({ meshResource: 'package://a/y.stl' }));
    // Late resolve of the first URI — the marker should ignore it.
    const staleRoot = new THREE.Group();
    staleRoot.add(new THREE.Mesh(new THREE.BoxGeometry()));
    resolveFirst(staleRoot);
    await flush();

    const group = rm.object as THREE.Group;
    expect(group.children).toContain(secondRoot);
    expect(group.children).not.toContain(staleRoot);
    rm.dispose();
  });
});

describe('TRIANGLE_LIST marker', () => {
  function p(x: number, y: number, z: number) {
    return { x, y, z };
  }

  it('builds vertex-coloured triangles when colors[] matches the vertex count', () => {
    const rm = createMarkerObject(MARKER_TYPE.TRIANGLE_LIST);
    rm.update(
      baseMarker({
        type: MARKER_TYPE.TRIANGLE_LIST,
        points: [
          p(0, 0, 0), p(1, 0, 0), p(0, 1, 0),
          p(1, 1, 0), p(2, 1, 0), p(1, 2, 0),
        ],
        colors: [
          { r: 1, g: 0, b: 0, a: 1 },
          { r: 0, g: 1, b: 0, a: 1 },
          { r: 0, g: 0, b: 1, a: 1 },
          { r: 1, g: 1, b: 0, a: 1 },
          { r: 0, g: 1, b: 1, a: 1 },
          { r: 1, g: 0, b: 1, a: 1 },
        ],
        color: { r: 1, g: 1, b: 1, a: 1 },
      }),
    );
    const mesh = rm.object as THREE.Mesh;
    const geo = mesh.geometry as THREE.BufferGeometry;
    expect(geo.getAttribute('position').count).toBe(6);
    const colorAttr = geo.getAttribute('color') as THREE.BufferAttribute;
    expect(colorAttr.count).toBe(6);
    expect(colorAttr.getX(0)).toBeCloseTo(1, 3);
    expect(colorAttr.getY(0)).toBeCloseTo(0, 3);
    expect(colorAttr.getZ(0)).toBeCloseTo(0, 3);
    expect(colorAttr.getX(1)).toBeCloseTo(0, 3);
    expect(colorAttr.getY(1)).toBeCloseTo(1, 3);
    // Material keeps the white base colour so vertex tints aren't modulated.
    const mat = mesh.material as THREE.MeshLambertMaterial;
    expect(mat.color.getHex()).toBe(0xffffff);
    expect(mat.vertexColors).toBe(true);
    rm.dispose();
  });

  it('falls back to the solid marker colour when colors[] is empty', () => {
    const rm = createMarkerObject(MARKER_TYPE.TRIANGLE_LIST);
    rm.update(
      baseMarker({
        type: MARKER_TYPE.TRIANGLE_LIST,
        points: [p(0, 0, 0), p(1, 0, 0), p(0, 1, 0)],
        colors: [],
        color: { r: 0.2, g: 0.4, b: 0.8, a: 1 },
      }),
    );
    const geo = (rm.object as THREE.Mesh).geometry as THREE.BufferGeometry;
    const colorAttr = geo.getAttribute('color') as THREE.BufferAttribute;
    expect(colorAttr.count).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(colorAttr.getX(i)).toBeCloseTo(0.2, 3);
      expect(colorAttr.getY(i)).toBeCloseTo(0.4, 3);
      expect(colorAttr.getZ(i)).toBeCloseTo(0.8, 3);
    }
    rm.dispose();
  });

  it('drops an orphaned trailing vertex pair', () => {
    const rm = createMarkerObject(MARKER_TYPE.TRIANGLE_LIST);
    rm.update(
      baseMarker({
        type: MARKER_TYPE.TRIANGLE_LIST,
        points: [p(0, 0, 0), p(1, 0, 0), p(0, 1, 0), p(2, 0, 0), p(3, 0, 0)],
      }),
    );
    const geo = (rm.object as THREE.Mesh).geometry as THREE.BufferGeometry;
    expect(geo.getAttribute('position').count).toBe(3);
    rm.dispose();
  });

  it('hides the mesh when fewer than three points are supplied', () => {
    const rm = createMarkerObject(MARKER_TYPE.TRIANGLE_LIST);
    rm.update(
      baseMarker({
        type: MARKER_TYPE.TRIANGLE_LIST,
        points: [p(0, 0, 0), p(1, 0, 0)],
      }),
    );
    expect((rm.object as THREE.Mesh).visible).toBe(false);
    rm.dispose();
  });

  it('applies marker.scale as a geometry multiplier (matches RViz)', () => {
    const rm = createMarkerObject(MARKER_TYPE.TRIANGLE_LIST);
    rm.update(
      baseMarker({
        type: MARKER_TYPE.TRIANGLE_LIST,
        scale: { x: 2, y: 3, z: 4 },
        points: [p(1, 0, 0), p(0, 1, 0), p(0, 0, 1)],
      }),
    );
    const mesh = rm.object as THREE.Mesh;
    expect(mesh.scale.x).toBe(2);
    expect(mesh.scale.y).toBe(3);
    expect(mesh.scale.z).toBe(4);
    rm.dispose();
  });
});

describe('mixed MarkerArray', () => {
  it('produces independent geometry and material instances per marker type', async () => {
    mockedLoadMesh.mockImplementation((uri: string) => {
      const root = new THREE.Group();
      const child = new THREE.Mesh(
        uri.endsWith('.stl') ? new THREE.BoxGeometry() : new THREE.SphereGeometry(),
        new THREE.MeshLambertMaterial({ color: 0xffffff }),
      );
      root.add(child);
      return Promise.resolve(root);
    });

    const cube = createMarkerObject(MARKER_TYPE.CUBE);
    const mesh = createMarkerObject(MARKER_TYPE.MESH_RESOURCE);
    const triangle = createMarkerObject(MARKER_TYPE.TRIANGLE_LIST);

    cube.update(baseMarker({ type: MARKER_TYPE.CUBE }));
    mesh.update(
      baseMarker({
        type: MARKER_TYPE.MESH_RESOURCE,
        meshResource: 'package://x/a.stl',
      }),
    );
    triangle.update(
      baseMarker({
        type: MARKER_TYPE.TRIANGLE_LIST,
        points: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
      }),
    );
    await flush();

    expect((cube.object as THREE.Mesh).type).toBe('Mesh');
    expect((mesh.object as THREE.Group).type).toBe('Group');
    expect((triangle.object as THREE.Mesh).type).toBe('Mesh');

    // The triangle mesh's geometry is its own BufferGeometry, independent of
    // the cube primitive's geometry (no shared references across markers).
    const cubeGeo = (cube.object as THREE.Mesh).geometry;
    const triGeo = (triangle.object as THREE.Mesh).geometry;
    expect(cubeGeo).not.toBe(triGeo);
    expect((triGeo as THREE.BufferGeometry).getAttribute('position').count).toBe(3);

    cube.dispose();
    mesh.dispose();
    triangle.dispose();
  });
});

describe('normaliseMarker', () => {
  it('reads mesh_use_embedded_materials with a default of false', () => {
    const defaulted = normaliseMarker(
      {
        ns: 'a',
        id: 1,
        type: 10,
        action: 0,
        pose: {
          position: { x: 0, y: 0, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 },
        },
        scale: { x: 1, y: 1, z: 1 },
        color: { r: 1, g: 0, b: 0, a: 1 },
      },
      0n,
    );
    expect(defaulted.meshUseEmbeddedMaterials).toBe(false);

    const truthy = normaliseMarker(
      {
        ns: 'a',
        id: 1,
        type: 10,
        action: 0,
        mesh_use_embedded_materials: true,
      },
      0n,
    );
    expect(truthy.meshUseEmbeddedMaterials).toBe(true);
  });
});
