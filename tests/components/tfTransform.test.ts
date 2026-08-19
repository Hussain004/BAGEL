import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  applyTransform,
  composeTFChain,
} from '../../src/components/panels/ThreeDScene/tfTransform';
import {
  findTfTopic,
  type TFEdge,
  type TFGraph,
} from '../../src/components/panels/TFTree/useTFGraph';

function edge(
  parent: string,
  child: string,
  translation: { x: number; y: number; z: number },
): TFEdge {
  return {
    parent,
    child,
    isStatic: false,
    samples: [{
      t: 1n,
      translation,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    }],
  };
}

function graph(edges: TFEdge[]): TFGraph {
  const byKey = new Map<string, TFEdge>();
  const children = new Map<string, string[]>();
  const parentOf = new Map<string, string | undefined>();
  const frames = new Set<string>();
  for (const item of edges) {
    byKey.set(`${item.parent}>${item.child}`, item);
    parentOf.set(item.child, item.parent);
    frames.add(item.parent);
    frames.add(item.child);
    children.set(item.parent, [...(children.get(item.parent) ?? []), item.child]);
  }
  return {
    edges: byKey,
    children,
    parentOf,
    frames,
    roots: Array.from(frames).filter((frame) => !parentOf.has(frame)),
  };
}

describe('composeTFChain', () => {
  it('maps a sensor frame through its ancestors into map', () => {
    const tf = graph([
      edge('map', 'odom', { x: 10, y: 20, z: 0 }),
      edge('odom', 'base_link', { x: 2, y: 3, z: 0 }),
      edge('base_link', 'lidar', { x: 0.5, y: 0, z: 0.2 }),
    ]);
    const matrix = composeTFChain(tf, 'lidar', 'map', 1n);
    expect(matrix).not.toBeNull();
    expect(matrix!.elements.slice(12, 15)).toEqual([12.5, 23, 0.2]);
  });

  it('maps between sibling branches through a common ancestor', () => {
    const tf = graph([
      edge('world', 'left', { x: 10, y: 0, z: 0 }),
      edge('left', 'sensor', { x: 2, y: 0, z: 0 }),
      edge('world', 'right', { x: 0, y: 5, z: 0 }),
    ]);
    const matrix = composeTFChain(tf, 'sensor', 'right', 1n);
    expect(matrix).not.toBeNull();
    expect(matrix!.elements.slice(12, 15)).toEqual([12, -5, 0]);
  });

  it('returns null for disconnected trees and cycles', () => {
    const disconnected = graph([
      edge('one', 'source', { x: 1, y: 0, z: 0 }),
      edge('two', 'target', { x: 1, y: 0, z: 0 }),
    ]);
    expect(composeTFChain(disconnected, 'source', 'target', 1n)).toBeNull();

    const cyclic = graph([
      edge('a', 'b', { x: 0, y: 0, z: 0 }),
      edge('b', 'a', { x: 0, y: 0, z: 0 }),
    ]);
    expect(composeTFChain(cyclic, 'a', 'missing', 1n)).toBeNull();
  });
});

describe('applyTransform', () => {
  // Shared by the primary ThreeDScene panel and every spatial-overlay layer
  // (mapOverlay/cloudOverlay/poseOverlay) - see tfTransform.ts's applyTransform.
  const upFix = new THREE.Matrix4().makeTranslation(0, 0, 100);

  function newGroup(): THREE.Group {
    const group = new THREE.Group();
    group.matrixAutoUpdate = true;
    return group;
  }

  it('falls back to upFix alone when there is no graph, frame, or the frames match', () => {
    const cache = { current: null as { key: string; matrix: THREE.Matrix4 } | null };
    const tf = graph([edge('map', 'lidar', { x: 1, y: 0, z: 0 })]);

    for (const [g, source, world] of [
      [null, 'lidar', 'map'],
      [tf, null, 'map'],
      [tf, 'lidar', null],
      [tf, 'map', 'map'],
    ] as const) {
      const group = newGroup();
      applyTransform(group, g, source, world, 1n, cache, upFix);
      expect(group.matrixAutoUpdate).toBe(false);
      expect(group.matrix.elements).toEqual(upFix.elements);
      expect(cache.current).toBeNull();
    }
  });

  it('falls back to upFix alone when no path connects the frames', () => {
    const cache = { current: null as { key: string; matrix: THREE.Matrix4 } | null };
    const tf = graph([
      edge('one', 'source', { x: 1, y: 0, z: 0 }),
      edge('two', 'target', { x: 1, y: 0, z: 0 }),
    ]);
    const group = newGroup();
    applyTransform(group, tf, 'source', 'target', 1n, cache, upFix);
    expect(group.matrix.elements).toEqual(upFix.elements);
    expect(cache.current).toBeNull();
  });

  it('post-multiplies the composed TF chain by upFix and populates the cache', () => {
    const cache = { current: null as { key: string; matrix: THREE.Matrix4 } | null };
    const tf = graph([edge('map', 'lidar', { x: 5, y: 0, z: 0 })]);
    const group = newGroup();
    applyTransform(group, tf, 'lidar', 'map', 1n, cache, upFix);

    const expected = new THREE.Matrix4().multiplyMatrices(
      upFix,
      composeTFChain(tf, 'lidar', 'map', 1n)!,
    );
    expect(group.matrix.elements).toEqual(expected.elements);
    expect(cache.current?.key).toBe('lidar>map@0');
  });

  it('reuses the cached matrix for timestamps in the same ~100ms bucket', () => {
    const cache = { current: null as { key: string; matrix: THREE.Matrix4 } | null };
    const tf = graph([edge('map', 'lidar', { x: 5, y: 0, z: 0 })]);
    const first = newGroup();
    applyTransform(first, tf, 'lidar', 'map', 1n, cache, upFix);

    // Mutate the graph in place - a cache hit must NOT re-walk the chain,
    // so this change should be invisible to a call in the same time bucket.
    tf.edges.set('map>lidar', edge('map', 'lidar', { x: 999, y: 0, z: 0 }));

    const second = newGroup();
    applyTransform(second, tf, 'lidar', 'map', 50_000_000n, cache, upFix);
    expect(second.matrix.elements).toEqual(first.matrix.elements);

    // A new 100ms bucket recomputes and picks up the mutated edge.
    const third = newGroup();
    applyTransform(third, tf, 'lidar', 'map', 150_000_000n, cache, upFix);
    expect(third.matrix.elements).not.toEqual(first.matrix.elements);
  });
});

describe('findTfTopic', () => {
  const topics = [
    { name: '/robot2/tf', type: 'tf2_msgs/msg/TFMessage' },
    { name: '/robot1/tf', type: 'tf2_msgs/msg/TFMessage' },
    { name: '/robot1/tf_static', type: 'tf2_msgs/msg/TFMessage' },
    { name: '/tf_debug', type: 'tf2_msgs/msg/TFMessage' },
  ];

  it('selects TF from the spatial topic namespace', () => {
    expect(findTfTopic(topics, ['/tf'], '/robot1/scan')?.name).toBe('/robot1/tf');
    expect(findTfTopic(topics, ['/tf'], '/robot2/map')?.name).toBe('/robot2/tf');
  });

  it('matches namespaced static TF without accepting similar suffixes', () => {
    expect(
      findTfTopic(topics, ['/tf_static'], '/robot1/scan')?.name,
    ).toBe('/robot1/tf_static');
    expect(findTfTopic(
      [{ name: '/robot1/tf_debug', type: 'tf2_msgs/msg/TFMessage' }],
      ['/tf'],
      '/robot1/scan',
    )).toBeNull();
  });

  it('prefers the exact global topic when no namespace is requested', () => {
    const withGlobal = [
      ...topics,
      { name: '/tf', type: 'tf2_msgs/msg/TFMessage' },
    ];
    expect(findTfTopic(withGlobal, ['/tf'])?.name).toBe('/tf');
  });
});
