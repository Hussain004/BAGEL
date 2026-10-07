/**
 * Tests for the sidebar namespace tree.
 *
 * The two cases that matter are the ones that look like edge cases until you
 * meet a real bag: `/odom` and `/odom/filtered` (a topic that is both a leaf
 * and a namespace prefix), and `/robot1/sensors/lidar/points` (a single-child
 * chain four levels deep that should render as one group row, not four).
 */

import { describe, it, expect } from 'vitest';
import { buildTopicTree, flattenTopicTree, type TopicTreeNode } from '../../src/utils/topicTree';
import type { TopicInfo } from '../../src/types/bag';

function t(name: string, count = 1, frequency?: number): TopicInfo {
  return { name, type: 'sensor_msgs/msg/Image', messageCount: count, serializationFormat: 'cdr', frequency };
}

/** All leaf topic names, in flattened order, for a fully-expanded tree. */
function leafNames(nodes: TopicTreeNode[]): string[] {
  const expanded = new Set<string>();
  const collect = (list: TopicTreeNode[]): void => {
    for (const n of list) {
      if (n.children) {
        expanded.add(n.path);
        collect(n.children);
      }
    }
  };
  collect(nodes);
  return flattenTopicTree(nodes, expanded)
    .filter((row) => !row.isGroup)
    .map((row) => row.node.topic!.name);
}

describe('buildTopicTree', () => {
  it('puts a root-level topic at depth 0 with no parent group', () => {
    const nodes = buildTopicTree([t('/tf')]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].path).toBe('/tf');
    expect(nodes[0].topic?.name).toBe('/tf');
    expect(nodes[0].children).toBeUndefined();
    expect(nodes[0].depth).toBe(0);
  });

  it('groups topics by namespace', () => {
    const nodes = buildTopicTree([
      t('/camera/front/image'),
      t('/camera/rear/image'),
      t('/odom'),
    ]);
    const names = nodes.map((n) => n.path).sort();
    expect(names).toEqual(['/camera', '/odom']);
    const camera = nodes.find((n) => n.path === '/camera')!;
    expect(camera.children!.map((c) => c.path).sort()).toEqual([
      '/camera/front',
      '/camera/rear',
    ]);
  });

  it('collapses a single-child chain into one group with the joined label', () => {
    const nodes = buildTopicTree([t('/robot1/sensors/lidar/points')]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].label).toBe('robot1/sensors/lidar');
    expect(nodes[0].path).toBe('/robot1/sensors/lidar');
    expect(nodes[0].depth).toBe(0);
    // The chain's only leaf hangs directly off the collapsed group.
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children![0].topic?.name).toBe('/robot1/sensors/lidar/points');
    expect(nodes[0].children![0].depth).toBe(1);
  });

  it('does not collapse a group whose only child is a topic (the parent stays a group)', () => {
    // /camera/front/image_raw has one group (/camera) with one group child
    // (/front) whose only child is the topic. /camera/front must NOT swallow
    // /front, or /front/image_raw would hang off a single display node with no
    // group between them, which is fine; but the reverse - a lone group node
    // wrapping one topic with nothing beside it - is noise.
    const nodes = buildTopicTree([t('/camera/front/image_raw')]);
    expect(nodes[0].label).toBe('camera/front');
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children![0].topic?.name).toBe('/camera/front/image_raw');
  });

  it('handles a topic that is both a leaf and a namespace prefix', () => {
    const nodes = buildTopicTree([t('/odom'), t('/odom/filtered')]);
    expect(nodes).toHaveLength(1);
    const odom = nodes[0];
    expect(odom.path).toBe('/odom');
    expect(odom.topic?.name).toBe('/odom');
    expect(odom.children).toHaveLength(1);
    expect(odom.children![0].topic?.name).toBe('/odom/filtered');
  });

  it('rolls message counts and Hz up the tree', () => {
    const nodes = buildTopicTree([
      t('/camera/front/image', 100, 30),
      t('/camera/rear/image', 50, 30),
      t('/camera/rear/depth', 200, 5),
      t('/odom', 10, 100),
    ]);
    const camera = nodes.find((n) => n.path === '/camera')!;
    expect(camera.totalCount).toBe(350);
    expect(camera.maxHz).toBe(30);
    const rear = camera.children!.find((c) => c.path === '/camera/rear')!;
    expect(rear.totalCount).toBe(250);
    expect(rear.maxHz).toBe(30);
  });

  it('counts a topic that is also a prefix only once', () => {
    const nodes = buildTopicTree([t('/odom', 10, 50), t('/odom/filtered', 5, 20)]);
    expect(nodes[0].totalCount).toBe(15);
    expect(nodes[0].maxHz).toBe(50);
  });

  it('survives malformed names without creating garbage groups', () => {
    // Empty segments are dropped, so //double/slash// is treated as the topic
    // named '//double/slash//' at namespace /double/slash. None of that should
    // produce a group with an empty path.
    const nodes = buildTopicTree([t('//double/slash//'), t('/'), t('/trailing/')]);
    const allPaths: string[] = [];
    const walk = (list: TopicTreeNode[]): void => {
      for (const n of list) {
        allPaths.push(n.path);
        if (n.children) walk(n.children);
      }
    };
    walk(nodes);
    expect(allPaths).not.toContain('');
    // The topic itself is still reachable, under its cleaned-up namespace.
    expect(nodes.map((n) => n.path)).toContain('/double');
    expect(nodes.find((n) => n.path === '/double')!.children![0].topic?.name).toBe('//double/slash//');
  });

  it('sorts children at every level', () => {
    const nodes = buildTopicTree([
      t('/zeta/a'), t('/alpha/a'), t('/alpha/z'), t('/alpha/b'),
    ]);
    expect(nodes.map((n) => n.path)).toEqual(['/alpha', '/zeta']);
    expect(nodes[0].children!.map((c) => c.path)).toEqual(['/alpha/a', '/alpha/b', '/alpha/z']);
  });

  it('builds 1000-topic trees fast enough to run per render', () => {
    const topics: TopicInfo[] = [];
    for (let i = 0; i < 1000; i++) {
      topics.push(t(`/robot${i % 8}/sensors/cam${i % 12}/image_${i}`, i, i % 30));
    }
    const started = performance.now();
    buildTopicTree(topics);
    const elapsed = performance.now() - started;
    expect(elapsed).toBeLessThan(50);
  });
});

describe('flattenTopicTree', () => {
  it('emits only top-level groups and leaves when everything is collapsed', () => {
    const nodes = buildTopicTree([
      t('/camera/front/image'),
      t('/camera/rear/image'),
      t('/odom'),
    ]);
    const rows = flattenTopicTree(nodes, new Set());
    expect(rows.map((r) => [r.node.path, r.isGroup])).toEqual([
      ['/camera', true],
      ['/odom', false],
    ]);
  });

  it('reveals children of expanded groups only', () => {
    const nodes = buildTopicTree([
      t('/camera/front/image'),
      t('/camera/rear/image'),
      t('/odom'),
    ]);
    const rows = flattenTopicTree(nodes, new Set(['/camera']));
    expect(rows.map((r) => [r.node.path, r.isGroup])).toEqual([
      ['/camera', true],
      ['/camera/front', true],
      ['/camera/rear', true],
      ['/odom', false],
    ]);
  });

  it('reveals a leaf and its prefix children independently', () => {
    const nodes = buildTopicTree([t('/odom'), t('/odom/filtered')]);
    const rows = flattenTopicTree(nodes, new Set(['/odom']));
    expect(rows.map((r) => [r.node.path, r.isGroup])).toEqual([
      ['/odom', true],
      ['/odom', false],
      ['/odom/filtered', false],
    ]);
  });

  it('emits leaves in alphabetical order within expanded groups', () => {
    const nodes = buildTopicTree([t('/c/z'), t('/c/a'), t('/c/m')]);
    const rows = flattenTopicTree(nodes, new Set(['/c']));
    expect(rows.filter((r) => !r.isGroup).map((r) => r.node.topic!.name)).toEqual([
      '/c/a', '/c/m', '/c/z',
    ]);
  });

  it('leafNames helper still works for its own use', () => {
    const nodes = buildTopicTree([t('/c/z'), t('/c/a')]);
    expect(leafNames(nodes)).toEqual(['/c/a', '/c/z']);
  });
});