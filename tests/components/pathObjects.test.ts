import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  MAX_POSES,
  createLineLayer,
  createPoseArrayLayer,
  extractPathPositions,
  extractPolygonPositions,
  extractPoseArray,
  setLineLayerColor,
  setPoseArrayColor,
  updateLineLayer,
  updatePoseArrayLayer,
} from '../../src/components/panels/ThreeDScene/pathObjects';
import { detectKind } from '../../src/components/panels/ThreeDScene/sceneKind';
import { getSpatialOverlayCandidates } from '../../src/components/panels/ThreeDScene/spatialOverlayTopics';
import {
  is3DCapableType,
  isPathLikeType,
  isPathType,
  isPolygonType,
  isPoseArrayType,
} from '../../src/utils/messages';
import { panelOptionsFor, suggestPanelKind } from '../../src/utils/panelOptions';
import type { TopicInfo } from '../../src/types/bag';

const pose = (x: number, y: number, z = 0, o: Record<string, number> = { x: 0, y: 0, z: 0, w: 1 }) => ({
  pose: { position: { x, y, z }, orientation: o },
});

describe('type detection', () => {
  it('recognises both ROS spellings', () => {
    for (const t of ['nav_msgs/Path', 'nav_msgs/msg/Path']) expect(isPathType(t)).toBe(true);
    for (const t of ['geometry_msgs/PoseArray', 'geometry_msgs/msg/PoseArray']) expect(isPoseArrayType(t)).toBe(true);
    for (const t of ['geometry_msgs/PolygonStamped', 'geometry_msgs/msg/Polygon']) expect(isPolygonType(t)).toBe(true);
  });
  it('does not claim neighbouring types', () => {
    for (const t of ['geometry_msgs/PoseStamped', 'nav_msgs/Odometry', 'nav_msgs/msg/OccupancyGrid', 'geometry_msgs/Point32']) {
      expect(isPathLikeType(t)).toBe(false);
    }
  });
  it('routes them to the 3D scene as the path kind', () => {
    expect(is3DCapableType('nav_msgs/msg/Path')).toBe(true);
    expect(detectKind('geometry_msgs/msg/PoseArray')).toBe('path');
    expect(detectKind('nav_msgs/msg/Odometry')).toBe('pose');
    const topic = (type: string): TopicInfo => ({ name: '/t', type, messageCount: 1, serializationFormat: 'cdr' });
    expect(panelOptionsFor(topic('nav_msgs/msg/Path'))).toEqual(['3d', 'raw']);
    expect(suggestPanelKind(topic('geometry_msgs/msg/PolygonStamped'))).toBe('3d');
  });
  it('offers them as overlay layers', () => {
    const topics: TopicInfo[] = [
      { name: '/plan', type: 'nav_msgs/msg/Path', messageCount: 5, serializationFormat: 'cdr' },
      { name: '/particles', type: 'geometry_msgs/msg/PoseArray', messageCount: 5, serializationFormat: 'cdr' },
    ];
    expect(getSpatialOverlayCandidates([{ bagId: 'b1', topics }], 'b1', '/map').map((c) => c.name)).toEqual(['/plan', '/particles']);
  });
});

describe('extractPathPositions', () => {
  it('packs xyz per pose in order', () => {
    const out = extractPathPositions({ poses: [pose(1, 2, 3), pose(4, 5, 6)] });
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it('returns empty for an empty path, a missing field, or a null message', () => {
    expect(extractPathPositions({ poses: [] })).toHaveLength(0);
    expect(extractPathPositions({})).toHaveLength(0);
    expect(extractPathPositions(null)).toHaveLength(0);
    expect(extractPathPositions({ poses: 'nope' })).toHaveLength(0);
  });
  it('skips non-finite or malformed poses instead of corrupting the line', () => {
    const out = extractPathPositions({ poses: [pose(1, 1), pose(NaN, 2), { pose: {} }, null, pose(3, 3)] });
    expect(Array.from(out)).toEqual([1, 1, 0, 3, 3, 0]);
  });
  it('handles a long global plan', () => {
    const poses = Array.from({ length: 50_000 }, (_, i) => pose(i, i * 2));
    expect(extractPathPositions({ poses })).toHaveLength(150_000);
  });
});

describe('extractPolygonPositions', () => {
  it('reads PolygonStamped and a bare Polygon', () => {
    const pts = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }];
    expect(extractPolygonPositions({ header: {}, polygon: { points: pts } })).toHaveLength(9);
    expect(extractPolygonPositions({ points: pts })).toHaveLength(9);
  });
  it('treats a missing z as 0 (2D footprints)', () => {
    expect(Array.from(extractPolygonPositions({ points: [{ x: 1, y: 2 }] }))).toEqual([1, 2, 0]);
  });
  it('is empty for a degenerate message', () => {
    expect(extractPolygonPositions({ polygon: {} })).toHaveLength(0);
    expect(extractPolygonPositions(undefined)).toHaveLength(0);
  });
});

describe('extractPoseArray', () => {
  it('packs seven floats per pose', () => {
    const out = extractPoseArray({ poses: [{ position: { x: 1, y: 2, z: 3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }] });
    expect(Array.from(out)).toEqual([1, 2, 3, 0, 0, 0, 1]);
  });
  it('turns an all-zero quaternion into identity so the arrow still draws', () => {
    const out = extractPoseArray({ poses: [{ position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 0 } }] });
    expect(Array.from(out.slice(3))).toEqual([0, 0, 0, 1]);
  });
  it('normalises a non-unit quaternion', () => {
    const out = extractPoseArray({ poses: [{ position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 2, w: 0 } }] });
    expect(out[5]).toBeCloseTo(1);
  });
  it('tolerates a missing orientation and drops bad positions', () => {
    const out = extractPoseArray({ poses: [{ position: { x: 1, y: 1, z: 0 } }, { position: { x: Infinity, y: 0, z: 0 } }, null] });
    expect(out).toHaveLength(7);
    expect(out[6]).toBe(1);
  });
  it('caps a runaway message', () => {
    const poses = Array.from({ length: MAX_POSES + 500 }, (_, i) => ({ position: { x: i, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }));
    expect(extractPoseArray({ poses })).toHaveLength(MAX_POSES * 7);
  });
});

describe('line layer', () => {
  const count = (l: ReturnType<typeof createLineLayer>) => l.line.geometry.drawRange.count;

  it('grows, shrinks, and clears without reallocating every update', () => {
    const layer = createLineLayer('#ff0000', false);
    updateLineLayer(layer, new Float32Array(30));
    expect(layer.count).toBe(10);
    expect(count(layer)).toBe(10);
    const attr = layer.line.geometry.getAttribute('position');
    updateLineLayer(layer, new Float32Array(15));
    // Shrinking reuses the buffer.
    expect(layer.line.geometry.getAttribute('position')).toBe(attr);
    expect(count(layer)).toBe(5);
    updateLineLayer(layer, new Float32Array(0));
    expect(count(layer)).toBe(0);
    // Growing past capacity swaps in a larger buffer.
    updateLineLayer(layer, new Float32Array(300));
    expect(layer.line.geometry.getAttribute('position').array.length).toBeGreaterThanOrEqual(300);
    expect(layer.count).toBe(100);
  });

  it('closes polygons and leaves paths open', () => {
    expect(createLineLayer('#fff', true).line).toBeInstanceOf(THREE.LineLoop);
    expect(createLineLayer('#fff', false).line).not.toBeInstanceOf(THREE.LineLoop);
  });

  it('recolors in place', () => {
    const layer = createLineLayer('#ff0000', false);
    setLineLayerColor(layer, '#00ff00');
    expect((layer.line.material as THREE.LineBasicMaterial).color.getHexString()).toBe('00ff00');
  });
});

describe('pose array layer', () => {
  const poses = (n: number) => {
    const a = new Float32Array(n * 7);
    for (let i = 0; i < n; i++) a.set([i, 0, 0, 0, 0, 0, 1], i * 7);
    return a;
  };

  it('draws thousands of poses as one instanced mesh', () => {
    const layer = createPoseArrayLayer('#00ffff');
    updatePoseArrayLayer(layer, poses(5000));
    expect(layer.object.children).toHaveLength(1);
    expect(layer.mesh!.count).toBe(5000);
  });

  it('places each instance at its pose', () => {
    const layer = createPoseArrayLayer('#00ffff');
    updatePoseArrayLayer(layer, poses(3));
    const m = new THREE.Matrix4();
    layer.mesh!.getMatrixAt(2, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).x).toBe(2);
  });

  it('keeps one mesh across shrink and regrow, replacing it only past capacity', () => {
    const layer = createPoseArrayLayer('#00ffff');
    updatePoseArrayLayer(layer, poses(100));
    const first = layer.mesh;
    updatePoseArrayLayer(layer, poses(10));
    expect(layer.mesh).toBe(first);
    expect(layer.mesh!.count).toBe(10);
    updatePoseArrayLayer(layer, poses(100));
    expect(layer.mesh).toBe(first);
    updatePoseArrayLayer(layer, poses(1000));
    expect(layer.mesh).not.toBe(first);
    expect(layer.object.children).toHaveLength(1);
  });

  it('survives an empty array and recolors', () => {
    const layer = createPoseArrayLayer('#00ffff');
    updatePoseArrayLayer(layer, new Float32Array(0));
    expect(layer.count).toBe(0);
    updatePoseArrayLayer(layer, poses(2));
    setPoseArrayColor(layer, '#ff00ff');
    expect((layer.mesh!.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('ff00ff');
    updatePoseArrayLayer(layer, new Float32Array(0));
    expect(layer.mesh!.count).toBe(0);
  });
});
