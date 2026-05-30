/**
 * Zustand store for the panel layout.
 *
 * The layout is a tree of two node kinds:
 *
 *   - `PanelLeaf`  — an open visualisation panel (kind + topic + ROS type +
 *                    optional bagId for multi-bag — see below).
 *   - `SplitNode`  — a horizontal or vertical container with N children.
 *                    Each child is itself a leaf or another split.
 *
 * Trees stay normalised:
 *   - splits with one child collapse into that child;
 *   - splits with zero children disappear;
 *   - we don't nest same-orientation splits — `openPanel` and `dockPanel`
 *     append to an existing horizontal/vertical container when the dock
 *     direction matches it.
 *
 * v0.9 multi-bag: `PanelLeaf.bagId` records which bag the panel reads from.
 * Panel ids embed the bagId (`kind:bagId:topicName`) so the same topic
 * across two bags maps to two distinct panel ids — you can open `/odom` from
 * bag A and `/odom` from bag B side-by-side. The URL hash carries the bagId
 * via the same scheme. v0.7 / v0.8 hashes (no bagId) are still accepted and
 * resolve to the focused bag at load time.
 */

import { create } from 'zustand';

export type PanelKind = 'plot' | 'image' | 'raw' | 'trajectory' | 'tf' | '3d';

export interface PanelLeaf {
  node: 'panel';
  id: string;
  kind: PanelKind;
  topicName: string;
  type: string;
  /**
   * The bag this panel reads from. Optional for back-compat: leaves restored
   * from v0.7 / v0.8 URL hashes don't carry a bagId and fall back to the
   * focused bag at read time. New panels always have it set.
   */
  bagId?: string;
}

export type SplitOrientation = 'horizontal' | 'vertical';

export interface SplitNode {
  node: 'split';
  id: string;
  orientation: SplitOrientation;
  children: LayoutNode[];
}

export type LayoutNode = PanelLeaf | SplitNode;

/** The four panel edges a drag-source can be docked onto. */
export type DropEdge = 'top' | 'right' | 'bottom' | 'left';

/**
 * Back-compat alias for the v0.5 flat-store name. PanelGrid and a few panel
 * components imported `PanelInstance` directly; the alias means we don't
 * have to rename every site to `PanelLeaf` in a single sweep.
 */
export type PanelInstance = PanelLeaf;

interface LayoutState {
  /** Layout tree, or null when no panels are open. */
  root: LayoutNode | null;
  /**
   * Panel ids in the order they were opened. `closePanel` filters this list;
   * `dockPanel` doesn't touch it (docking is a move, not an open/close).
   */
  openOrder: string[];

  openPanel: (panel: Omit<PanelLeaf, 'id' | 'node'>) => void;
  closePanel: (id: string) => void;
  closeAllPanels: () => void;
  /** Close every panel reading from a specific bag. Used on bag removal. */
  closePanelsForBag: (bagId: string) => void;
  /** Move `sourceId` so that it sits on the given `edge` of `targetId`. */
  dockPanel: (sourceId: string, targetId: string, edge: DropEdge) => void;
  /**
   * Replace the entire layout tree wholesale. Used by `useUrlState` on bag
   * load to restore the saved layout in one shot — going through
   * `openPanel`/`dockPanel` would work but synthesises a less faithful
   * tree and churns the URL hash with intermediate states.
   *
   * `openOrder` is recomputed from a left-to-right traversal of the new
   * tree, since the URL doesn't preserve the original open order.
   */
  restoreLayout: (root: LayoutNode | null) => void;
  hasPanelForTopic: (topicName: string, bagId?: string) => boolean;
}

/**
 * Panel-leaf id format:
 *   - `kind:topicName`            — v0.7 / v0.8 single-bag (back-compat).
 *   - `kind:bagId:topicName`      — v0.9 multi-bag.
 *
 * The bagId is always included when known so two bags with the same topic
 * have distinct ids. Leaves restored from old hashes lack a bagId; those
 * use the back-compat form and the panel renders from the focused bag.
 */
function panelLeafId(kind: PanelKind, topicName: string, bagId?: string): string {
  if (bagId) return `${kind}:${bagId}:${topicName}`;
  return `${kind}:${topicName}`;
}

// Split-node ids are opaque to consumers — they just need to be unique within
// the lifetime of the page so React's reconciler can tell two splits apart.
let splitIdCounter = 0;
function makeSplitId(): string {
  splitIdCounter++;
  return `split:${splitIdCounter}`;
}

function orientationFromEdge(edge: DropEdge): SplitOrientation {
  return edge === 'top' || edge === 'bottom' ? 'vertical' : 'horizontal';
}

/** Recursively walk the tree, returning every leaf in left-to-right order. */
export function getAllPanels(node: LayoutNode | null): PanelLeaf[] {
  if (!node) return [];
  if (node.node === 'panel') return [node];
  return node.children.flatMap(getAllPanels);
}

/** Find a leaf by id. Returns null if no such leaf exists in the tree. */
export function findPanel(node: LayoutNode | null, id: string): PanelLeaf | null {
  if (!node) return null;
  if (node.node === 'panel') return node.id === id ? node : null;
  for (const c of node.children) {
    const f = findPanel(c, id);
    if (f) return f;
  }
  return null;
}

/**
 * Remove the leaf with the given id from the tree and return a normalised
 * copy: empty splits become null, single-child splits collapse to that child.
 * Returns the original node when the target isn't present (no copy made).
 */
function removeLeafById(tree: LayoutNode, id: string): LayoutNode | null {
  if (tree.node === 'panel') return tree.id === id ? null : tree;
  let changed = false;
  const newChildren: LayoutNode[] = [];
  for (const c of tree.children) {
    const after = removeLeafById(c, id);
    if (after !== c) changed = true;
    if (after !== null) newChildren.push(after);
  }
  if (!changed) return tree;
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  return { ...tree, children: newChildren };
}

/** Remove every leaf matching the predicate. Returns null if nothing remains. */
function removeLeavesWhere(
  tree: LayoutNode,
  predicate: (leaf: PanelLeaf) => boolean,
): LayoutNode | null {
  if (tree.node === 'panel') return predicate(tree) ? null : tree;
  const newChildren: LayoutNode[] = [];
  let changed = false;
  for (const c of tree.children) {
    const after = removeLeavesWhere(c, predicate);
    if (after !== c) changed = true;
    if (after !== null) newChildren.push(after);
  }
  if (!changed) return tree;
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  return { ...tree, children: newChildren };
}

/**
 * Wrap a target leaf in a fresh split with `source` placed on the chosen edge.
 * Used when `insertAt` reaches the target leaf without finding a parent split
 * it can append to.
 */
function wrapLeafWithSource(
  target: PanelLeaf,
  source: LayoutNode,
  edge: DropEdge,
): SplitNode {
  const orientation = orientationFromEdge(edge);
  const sourceFirst = edge === 'top' || edge === 'left';
  return {
    node: 'split',
    id: makeSplitId(),
    orientation,
    children: sourceFirst ? [source, target] : [target, source],
  };
}

/**
 * Find the target leaf in `tree` and place `source` adjacent to it on `edge`.
 *
 * When the target's direct parent split already matches the requested
 * orientation, the source is added as a sibling at the right position — this
 * avoids growing nested same-orientation splits, which would render the same
 * way but bloat the tree.
 */
function insertAt(
  tree: LayoutNode,
  targetId: string,
  source: LayoutNode,
  edge: DropEdge,
): LayoutNode {
  if (tree.node === 'panel') {
    if (tree.id !== targetId) return tree;
    return wrapLeafWithSource(tree, source, edge);
  }
  // tree is a split — check whether one of its direct children is the target
  // and we can flatten by inserting source as a sibling.
  const desiredOrientation = orientationFromEdge(edge);
  const sourceFirst = edge === 'top' || edge === 'left';
  if (tree.orientation === desiredOrientation) {
    for (let i = 0; i < tree.children.length; i++) {
      const c = tree.children[i];
      if (c.node === 'panel' && c.id === targetId) {
        const newChildren = [...tree.children];
        newChildren.splice(sourceFirst ? i : i + 1, 0, source);
        return { ...tree, children: newChildren };
      }
    }
  }
  // Otherwise recurse — only one child can contain the target.
  let touched = false;
  const newChildren = tree.children.map((c) => {
    if (touched) return c;
    const updated = insertAt(c, targetId, source, edge);
    if (updated !== c) touched = true;
    return updated;
  });
  if (!touched) return tree;
  return { ...tree, children: newChildren };
}

/**
 * Append `leaf` to the right edge of the existing tree.
 *
 * Used by `openPanel` so the first-opened panel lives at the left and each
 * subsequent open appears to its right — matching the v0.5 behaviour and
 * keeping the empty-tree case trivial. Users can drag-dock to reorganise.
 */
function appendLeafRight(root: LayoutNode, leaf: PanelLeaf): LayoutNode {
  if (root.node === 'split' && root.orientation === 'horizontal') {
    return { ...root, children: [...root.children, leaf] };
  }
  return {
    node: 'split',
    id: makeSplitId(),
    orientation: 'horizontal',
    children: [root, leaf],
  };
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  root: null,
  openOrder: [],

  openPanel: ({ kind, topicName, type, bagId }) => {
    const id = panelLeafId(kind, topicName, bagId);
    const state = get();
    if (findPanel(state.root, id)) return;
    const leaf: PanelLeaf = { node: 'panel', id, kind, topicName, type, bagId };
    const newRoot = state.root ? appendLeafRight(state.root, leaf) : leaf;
    set({ root: newRoot, openOrder: [...state.openOrder, id] });
  },

  closePanel: (id) => {
    const state = get();
    if (!state.root) return;
    const newRoot = removeLeafById(state.root, id);
    set({
      root: newRoot,
      openOrder: state.openOrder.filter((x) => x !== id),
    });
  },

  closeAllPanels: () => set({ root: null, openOrder: [] }),

  closePanelsForBag: (bagId) => {
    const state = get();
    if (!state.root) return;
    const newRoot = removeLeavesWhere(state.root, (leaf) => leaf.bagId === bagId);
    if (newRoot === state.root) return;
    // Rebuild openOrder by walking the surviving tree — easier than tracking
    // every dropped id since we just removed an unbounded number of leaves.
    const survivingIds = new Set(getAllPanels(newRoot).map((p) => p.id));
    set({
      root: newRoot,
      openOrder: state.openOrder.filter((id) => survivingIds.has(id)),
    });
  },

  dockPanel: (sourceId, targetId, edge) => {
    if (sourceId === targetId) return;
    const state = get();
    if (!state.root) return;
    const source = findPanel(state.root, sourceId);
    if (!source) return;
    const withoutSource = removeLeafById(state.root, sourceId);
    if (!withoutSource || !findPanel(withoutSource, targetId)) return;
    const newRoot = insertAt(withoutSource, targetId, source, edge);
    // openOrder unchanged — docking is a move, not an open/close.
    set({ root: newRoot });
  },

  restoreLayout: (root) => {
    const openOrder = getAllPanels(root).map((p) => p.id);
    set({ root, openOrder });
  },

  hasPanelForTopic: (topicName, bagId) =>
    getAllPanels(get().root).some(
      (p) =>
        p.topicName === topicName &&
        // bagId match: when caller passes one, it must match. When omitted,
        // any panel for the topic counts (back-compat for the sidebar dot
        // indicator that doesn't know about bagId).
        (bagId === undefined || p.bagId === bagId),
    ),
}));
