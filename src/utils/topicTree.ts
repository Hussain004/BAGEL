/**
 * Namespace tree for the topic sidebar.
 *
 * Real robot bags have 100 to 400 topics (`/robot1/sensors/lidar/front/points`,
 * ...). A flat list works when you already know the name; it is hostile when
 * you are exploring an unfamiliar bag, which is BAGEL's core use case.
 *
 * Two design notes:
 *
 * **Single-child chains collapse.** A topic like `/robot1/sensors/lidar/points`
 * would otherwise take four rows of indentation before the interesting part,
 * and every level would hold exactly one child. Collapsed, it renders as one
 * group node labeled `robot1/sensors/lidar`, which is what rviz2 and Foxglove
 * both do and what a human reads anyway.
 *
 * **A topic can be a leaf and a prefix.** `/odom` and `/odom/filtered` are both
 * real topics; `/odom` must render as a topic row AND the parent of
 * `/odom/filtered`. It is a *leak*, not a tree: the node carries `topic` for
 * its own row plus `children` for the nested ones.
 */

import type { TopicInfo } from '../types/bag';

export interface TopicTreeNode {
  /**
   * Full namespace path for a group node (`/robot1/sensors/lidar`), or the
   * topic name for a leaf (`/odom`). Unique within the tree, so it works as a
   * React key and as the expansion-state key.
   */
  path: string;
  /**
   * Display text. A collapsed chain shows the joined segments
   * (`robot1/sensors/lidar`); an uncollapsed node shows its single segment;
   * a leaf shows the final segment of the topic name.
   */
  label: string;
  /** Indentation level, 0 at the root. Rendering is a flat list, so the indent is explicit. */
  depth: number;
  /** Set for a group node (namespace). Unset for a pure leaf. */
  children?: TopicTreeNode[];
  /**
   * Set when a topic lives at exactly this path, either as a pure leaf or
   * alongside `children` (the `/odom` + `/odom/filtered` case).
   */
  topic?: TopicInfo;
  /** Total messages under this node, including nested topics. */
  totalCount: number;
  /** Highest Hz of any topic under this node, 0 when nothing reports a rate. */
  maxHz: number;
}

interface BuilderNode {
  /** Full namespace path, '' for the synthetic root. */
  path: string;
  /** Namespace segment(s) this node represents, as read. For collapse math. */
  segments: string[];
  children: Map<string, BuilderNode>;
  /** Topic at exactly this path, if any. */
  topic: TopicInfo | null;
}

/**
 * Split a topic name into namespace segments.
 *
 * `/robot1/sensors/points` -> ['robot1', 'sensors', 'points']. The leading
 * slash is dropped; empty segments (double slashes, trailing slashes, a bare
 * `/`) are dropped rather than creating a garbage group, since a bag with a
 * typo'd topic name should still render sanely.
 */
function splitTopic(name: string): string[] {
  return name.split('/').filter((segment) => segment.length > 0);
}

/** Sorted map iteration, deterministic regardless of insertion order. */
function sortedChildren(map: Map<string, BuilderNode>): BuilderNode[] {
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
}

/**
 * Build the tree from a topic list.
 *
 * `topics` may come from one bag or be the concatenation of several; multi-bag
 * grouping is a render concern and each bag is built separately, so this does
 * not need to know about bags at all.
 */
export function buildTopicTree(topics: TopicInfo[]): TopicTreeNode[] {
  const root: BuilderNode = { path: '', segments: [], children: new Map(), topic: null };

  for (const topic of topics) {
    const segments = splitTopic(topic.name);
    if (segments.length === 0) continue;
    let node = root;
    for (const segment of segments) {
      let child = node.children.get(segment);
      if (!child) {
        child = {
          path: node.path === '' ? `/${segment}` : `${node.path}/${segment}`,
          segments: [...node.segments, segment],
          children: new Map(),
          topic: null,
        };
        node.children.set(segment, child);
      }
      node = child;
    }
    // The final node is the topic itself. It may already exist from another
    // topic that prefixed it (the /odom vs /odom/filtered case).
    node.topic = topic;
  }

  return toTreeNodes(sortedChildren(root.children), 0);
}

/**
 * Collapse single-child namespace chains while converting BuilderNodes to the
 * public shape, and compute the rolled-up counts.
 */
function toTreeNodes(nodes: BuilderNode[], depth: number): TopicTreeNode[] {
  return nodes.map((node) => collapse(node, depth));
}

function collapse(node: BuilderNode, depth: number): TopicTreeNode {
  // Collapse: while this node has exactly one child, no topic of its own, and
  // that child also has no topic of its own, merge the child in. The result is
  // one display node whose label is the joined chain (robot1/sensors/lidar).
  // Only this node's own segments are tracked: a caller recursing into the
  // children of an already-collapsed group must not re-label them with the
  // group's chain.
  let merged = node;
  const chainSegments = [node.segments[node.segments.length - 1] ?? ''];
  for (;;) {
    const children = sortedChildren(merged.children);
    const onlyChild = children.length === 1 ? children[0] : null;
    if (!onlyChild || merged.topic || onlyChild.topic) break;
    // Do not collapse past a node whose only child is a pure leaf: the leaf's
    // parent group should exist so the topic has somewhere to hang.
    if (onlyChild.children.size === 0) break;
    merged = onlyChild;
    chainSegments.push(onlyChild.segments[onlyChild.segments.length - 1]);
  }

  const children = sortedChildren(merged.children);
  const hasChildren = children.length > 0;
  const result: TopicTreeNode = {
    path: merged.path,
    label: chainSegments.join('/'),
    depth,
    totalCount: 0,
    maxHz: 0,
  };

  // A node with children is a group; a node without is a leaf. The /odom case
  // is both, so `topic` is set independently of `children`.
  if (merged.topic) {
    result.topic = merged.topic;
    result.totalCount = merged.topic.messageCount;
    result.maxHz = merged.topic.frequency ?? 0;
    // A leaf's label is just its final segment; the full name is the path.
    const topicSegments = splitTopic(merged.topic.name);
    result.label = topicSegments[topicSegments.length - 1] ?? merged.topic.name;
  }
  if (hasChildren) {
    result.children = toTreeNodes(children, depth + 1);
    for (const child of result.children!) {
      result.totalCount += child.totalCount;
      result.maxHz = Math.max(result.maxHz, child.maxHz);
    }
  }
  return result;
}

/** A row in the flattened, expansion-aware rendering list. */
export interface TopicTreeRow {
  node: TopicTreeNode;
  /**
   * True for a group row (renders as an expandable header), false for a leaf
   * row (renders as the existing TopicRow component).
   */
  isGroup: boolean;
}

/**
 * Flatten the tree for rendering, skipping descendants of collapsed groups.
 *
 * The sidebar renders one flat list (the `content-visibility` optimisation on
 * `.topic-row` assumes it), so expansion is applied here rather than as nested
 * components. `expanded` holds group `path`s; anything not in the set is
 * collapsed by default, which keeps a fresh bag small.
 *
 * `compare` reorders the children of each level (groups and leaves alike),
 * letting the sidebar's count / Hz sort buttons work in tree mode. Without it
 * every level is alphabetical by path. Nodes carry `totalCount` and `maxHz`
 * for exactly this: a dead namespace sorts to the bottom when sorting by
 * count, which is the point of surfacing the numbers.
 */
export function flattenTopicTree(
  nodes: TopicTreeNode[],
  expanded: ReadonlySet<string>,
  compare?: (a: TopicTreeNode, b: TopicTreeNode) => number,
): TopicTreeRow[] {
  const rows: TopicTreeRow[] = [];
  const visit = (list: TopicTreeNode[]): void => {
    const ordered = compare ? [...list].sort(compare) : list;
    for (const node of ordered) {
      const isGroup = node.children !== undefined;
      if (isGroup) {
        rows.push({ node, isGroup: true });
        if (node.topic) rows.push({ node, isGroup: false });
        if (expanded.has(node.path)) visit(node.children!);
      } else {
        rows.push({ node, isGroup: false });
      }
    }
  };
  visit(nodes);
  return rows;
}