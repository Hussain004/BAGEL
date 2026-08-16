/**
 * Compose a chain of TF transforms into a single Three.js Matrix4 so a
 * point cloud / pose / scan can be rendered in any chosen world frame.
 *
 * The chain is built by walking parent-of relations from the source frame
 * (the frame the message was published in) up to the target frame, then
 * multiplying the per-edge transforms in order. Each per-edge sample is
 * picked by nearest-time lookup in the existing TFEdge sample list.
 *
 * `lookupTransform` already exists for individual edges in useTFGraph;
 * here we compose the chain and turn it into a single matrix the scene can
 * apply to a Group.
 */
import * as THREE from 'three';
import type { TFGraph } from '../TFTree/useTFGraph';
import { lookupTransform } from '../TFTree/useTFGraph';

/**
 * Try to build a transform that maps points expressed in `sourceFrame` into
 * `targetFrame` at `timeNs`. Returns null if either frame isn't in the
 * graph or no path connects them.
 *
 * Note: ROS TF graphs are trees rooted at one or more world frames; given
 * any two frames there is at most one ancestor-descendant path. To go
 * from source to target we need to traverse up from source until we reach
 * a common ancestor, then down to target. For most use cases we just need
 * source→target where target is an ancestor of source (e.g. velodyne →
 * map), which simplifies to a single upward walk.
 */
export function composeTFChain(
  graph: TFGraph,
  sourceFrame: string,
  targetFrame: string,
  timeNs: bigint,
): THREE.Matrix4 | null {
  if (sourceFrame === targetFrame) return new THREE.Matrix4();

  const edgeMatrix = (parent: string, child: string): THREE.Matrix4 | null => {
    const edge = graph.edges.get(`${parent}>${child}`);
    if (!edge) return null;
    const sample = lookupTransform(edge, timeNs);
    if (!sample) return null;
    return new THREE.Matrix4().compose(
      new THREE.Vector3(
        sample.translation.x,
        sample.translation.y,
        sample.translation.z,
      ),
      new THREE.Quaternion(
        sample.rotation.x,
        sample.rotation.y,
        sample.rotation.z,
        sample.rotation.w,
      ),
      new THREE.Vector3(1, 1, 1),
    );
  };

  // Record source-to-ancestor transforms, including the source itself.
  const sourceToAncestor = new Map<string, THREE.Matrix4>();
  let sourceCurrent = sourceFrame;
  let sourceMatrix = new THREE.Matrix4();
  const sourceSeen = new Set<string>();
  sourceToAncestor.set(sourceCurrent, sourceMatrix.clone());
  while (!sourceSeen.has(sourceCurrent)) {
    sourceSeen.add(sourceCurrent);
    const parent = graph.parentOf.get(sourceCurrent);
    if (!parent) break;
    const step = edgeMatrix(parent, sourceCurrent);
    if (!step) return null;
    sourceMatrix = step.multiply(sourceMatrix);
    sourceCurrent = parent;
    sourceToAncestor.set(sourceCurrent, sourceMatrix.clone());
  }

  // Walk target-to-root until the paths meet. If T maps target to the
  // common ancestor and S maps source there, inv(T) * S maps source to target.
  let targetCurrent = targetFrame;
  let targetMatrix = new THREE.Matrix4();
  const targetSeen = new Set<string>();
  for (;;) {
    const sourceMatrixAtCommon = sourceToAncestor.get(targetCurrent);
    if (sourceMatrixAtCommon) {
      return targetMatrix.clone().invert().multiply(sourceMatrixAtCommon);
    }
    if (targetSeen.has(targetCurrent)) return null;
    targetSeen.add(targetCurrent);
    const parent = graph.parentOf.get(targetCurrent);
    if (!parent) return null;
    const step = edgeMatrix(parent, targetCurrent);
    if (!step) return null;
    targetMatrix = step.multiply(targetMatrix);
    targetCurrent = parent;
  }
}

/**
 * Pick a sensible default "world frame" for a panel.
 *
 * Order of preference:
 *   1. "map" if it exists.
 *   2. "odom" if it exists.
 *   3. The root of the TF tree that contains the sourceFrame (if known).
 *   4. The first listed root, or just the sourceFrame itself.
 */
export function pickWorldFrame(
  graph: TFGraph | null,
  sourceFrame: string | undefined,
): string | null {
  if (!graph) return null;
  if (graph.frames.has('map')) return 'map';
  if (graph.frames.has('odom')) return 'odom';
  if (sourceFrame && graph.frames.has(sourceFrame)) {
    // Walk to the root.
    let cur: string | undefined = sourceFrame;
    const seen = new Set<string>();
    while (cur) {
      if (seen.has(cur)) break;
      seen.add(cur);
      const parent = graph.parentOf.get(cur);
      if (!parent) return cur;
      cur = parent;
    }
  }
  return graph.roots[0] ?? null;
}
