/**
 * MarkerSet — lifecycle manager for a `visualization_msgs/MarkerArray`
 * topic's rendered state.
 *
 * Responsibilities:
 *   - Maintain a `(ns, id) → RenderedMarker` map so ADD/MODIFY are
 *     incremental rather than rebuild-from-scratch.
 *   - Apply DELETE / DELETEALL actions.
 *   - Cull markers whose `stamp + lifetime` falls before the playhead.
 *   - Group markers by their `header.frame_id` so per-frame TF chains can
 *     be applied with one matrix-write per frame instead of per marker.
 *   - Expose every namespace ever seen for the panel's filter UI.
 *
 * Scene-graph shape:
 *
 *   root  ─┬─ THREE.Group "base_link"  → matrix = TF(base_link → world)
 *          │     ├─ markerA (pose applied via update())
 *          │     └─ markerB
 *          ├─ THREE.Group "map"
 *          │     └─ markerC
 *          └─ THREE.Group ""          → identity matrix; markers without a
 *                                       frame land here
 *
 *  The panel attaches `root` to its `userGroup` so the up-axis fix /
 *  world-frame composition on `userGroup` applies on top of the per-frame
 *  transforms here.
 *
 * Playhead semantics:
 *   Markers persist after their ADD until DELETE or lifetime expiry. When
 *   the playhead moves *backwards* the caller (`useMarkerStream`) is
 *   expected to `clear()` and replay from the start — see the hook for
 *   why we don't try to "undo" individual ADDs in here.
 */

import * as THREE from 'three';
import {
  MARKER_ACTION,
  createMarkerObject,
  type MarkerData,
  type RenderedMarker,
} from './markerObjects';
import { composeTFChain } from './tfTransform';
import type { TFGraph } from '../TFTree/useTFGraph';

function markerKey(ns: string, id: number): string {
  return `${ns}:${id}`;
}

interface Entry {
  rm: RenderedMarker;
  data: MarkerData;
  /** Absolute time (ns since epoch) when this marker should vanish, or null for
   *  "lives forever." `lifetimeNs === 0n` means infinite per the ROS spec. */
  expiresAt: bigint | null;
  /** Cached frameId so we know whether to reparent on update. */
  frameId: string;
}

export class MarkerSet {
  /** Parent group — add this to the panel's userGroup. */
  readonly root: THREE.Group;

  private rendered = new Map<string, Entry>();
  /** Per-frame subgroups whose matrices carry the source→world TF chain. */
  private frameGroups = new Map<string, THREE.Group>();
  /** Every namespace seen on this topic so the filter UI can list them. */
  private knownNamespaces = new Set<string>();
  private hiddenNamespaces = new Set<string>();
  /**
   * Memoised TF-chain key so identical frame/world/time combinations don't
   * walk the graph twice. We bucket time at 100 ms (same as the cloud path)
   * because /tf rarely publishes faster than 100 Hz and the visual diff is
   * imperceptible.
   */
  private lastRefreshKey: string | null = null;

  constructor() {
    this.root = new THREE.Group();
    this.root.matrixAutoUpdate = true;
    this.root.frustumCulled = false;
  }

  /**
   * Apply a single marker action (ADD/MODIFY/DELETE/DELETEALL).
   *
   * The caller is responsible for feeding markers in chronological order;
   * out-of-order replay would let an earlier MODIFY overwrite a later
   * DELETE.
   */
  applyMarker(m: MarkerData): void {
    if (m.ns) this.knownNamespaces.add(m.ns);

    if (m.action === MARKER_ACTION.DELETE) {
      this.removeMarker(m.ns, m.id);
      return;
    }
    if (m.action === MARKER_ACTION.DELETEALL) {
      this.clear();
      return;
    }
    if (m.action !== MARKER_ACTION.ADD) {
      // ADD and MODIFY both share action=0. Anything else is from a marker
      // dialect we don't recognise — skip rather than crash the scene.
      console.warn(`[MarkerArray] skipping unknown action=${m.action}`);
      return;
    }

    const key = markerKey(m.ns, m.id);
    let entry = this.rendered.get(key);

    // Type changes mid-stream are rare but legal — recreate the underlying
    // object so we don't try to update e.g. a Sprite with a Mesh marker.
    if (entry && entry.data.type !== m.type) {
      this.removeMarker(m.ns, m.id);
      entry = undefined;
    }

    if (!entry) {
      const rm = createMarkerObject(m.type);
      entry = { rm, data: m, expiresAt: null, frameId: m.frameId };
      this.rendered.set(key, entry);
      this.attachToFrame(rm.object, m.frameId);
    } else if (entry.frameId !== m.frameId) {
      // Reparent on frame change.
      entry.rm.object.parent?.remove(entry.rm.object);
      this.attachToFrame(entry.rm.object, m.frameId);
      entry.frameId = m.frameId;
    }

    entry.data = m;
    entry.expiresAt = m.lifetimeNs > 0n ? m.stampNs + m.lifetimeNs : null;
    entry.rm.update(m);

    if (this.hiddenNamespaces.has(m.ns)) {
      entry.rm.object.visible = false;
    }
  }

  /**
   * Per-tick maintenance:
   *   1. Cull markers whose lifetime has expired.
   *   2. Refresh per-frame TF matrices.
   *   3. Drop empty frame groups so the scene graph stays tidy.
   *
   * `key` is a stable identifier for (worldFrame, bucketedTime) that lets
   * us skip the whole walk when nothing has actually changed since the
   * last refresh — useful during paused playback when the panel still
   * re-renders for sibling reasons (display toggle, etc.).
   */
  refresh(
    currentTimeNs: bigint,
    graph: TFGraph | null,
    worldFrame: string | null,
  ): void {
    // Bucket the playhead by 100 ms — TF samples are typically <=100 Hz and a
    // 10 ms shift makes no visible difference. The bucket is included in
    // lastRefreshKey so a moving playhead still recomposes once per bucket.
    const bucket = currentTimeNs / 100_000_000n;
    const key = `${worldFrame ?? ''}|${bucket.toString()}|${this.frameGroups.size}`;

    // Lifetime cull — always runs since `currentTimeNs` may move backwards
    // past a marker we already culled, which is fine (we just leave it gone).
    const toRemove: string[] = [];
    for (const [k, entry] of this.rendered) {
      if (entry.expiresAt !== null && entry.expiresAt < currentTimeNs) {
        toRemove.push(k);
      }
    }
    for (const k of toRemove) {
      const entry = this.rendered.get(k);
      if (!entry) continue;
      entry.rm.object.parent?.remove(entry.rm.object);
      entry.rm.dispose();
      this.rendered.delete(k);
    }

    // Skip the TF walk when nothing has changed (and no markers were just
    // removed, since a removal could empty a frame group).
    if (toRemove.length === 0 && this.lastRefreshKey === key) return;
    this.lastRefreshKey = key;

    for (const [frameId, group] of this.frameGroups) {
      let matrix: THREE.Matrix4 | null = null;
      if (graph && worldFrame && frameId) {
        matrix = composeTFChain(graph, frameId, worldFrame, currentTimeNs);
      }
      if (matrix) {
        group.matrix.copy(matrix);
      } else {
        group.matrix.identity();
      }
    }

    // Drop empty frame groups so the scene graph doesn't accumulate them
    // across DELETE storms.
    for (const [frameId, group] of [...this.frameGroups]) {
      if (group.children.length === 0) {
        this.root.remove(group);
        this.frameGroups.delete(frameId);
      }
    }
  }

  setNamespaceVisible(ns: string, visible: boolean): void {
    if (visible) this.hiddenNamespaces.delete(ns);
    else this.hiddenNamespaces.add(ns);
    for (const entry of this.rendered.values()) {
      if (entry.data.ns === ns) entry.rm.object.visible = visible;
    }
  }

  isNamespaceHidden(ns: string): boolean {
    return this.hiddenNamespaces.has(ns);
  }

  /** Every namespace ever seen, sorted alphabetically. */
  namespaces(): string[] {
    return Array.from(this.knownNamespaces).sort();
  }

  /** Drop every marker but keep the root group for reuse. */
  clear(): void {
    for (const entry of this.rendered.values()) {
      entry.rm.object.parent?.remove(entry.rm.object);
      entry.rm.dispose();
    }
    this.rendered.clear();
    for (const g of this.frameGroups.values()) {
      this.root.remove(g);
    }
    this.frameGroups.clear();
    this.lastRefreshKey = null;
  }

  dispose(): void {
    this.clear();
    this.knownNamespaces.clear();
    this.hiddenNamespaces.clear();
  }

  /** Diagnostics: live marker count, for the panel's status footer. */
  size(): number {
    return this.rendered.size;
  }

  // ── internal ────────────────────────────────────────────────────────────

  private attachToFrame(obj: THREE.Object3D, frameId: string): void {
    let g = this.frameGroups.get(frameId);
    if (!g) {
      g = new THREE.Group();
      // We drive the matrix ourselves on each refresh — the children apply
      // their own local poses, this group only carries the TF chain.
      g.matrixAutoUpdate = false;
      g.frustumCulled = false;
      this.frameGroups.set(frameId, g);
      this.root.add(g);
    }
    g.add(obj);
  }

  private removeMarker(ns: string, id: number): void {
    const key = markerKey(ns, id);
    const entry = this.rendered.get(key);
    if (!entry) return;
    entry.rm.object.parent?.remove(entry.rm.object);
    entry.rm.dispose();
    this.rendered.delete(key);
  }
}
