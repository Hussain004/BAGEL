import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type * as THREE from 'three';
import { isCameraInfoType } from '../../../utils/messages';
import type { CameraIntrinsics } from '../../../hooks/useCameraInfo';
import type { BagSummary } from '../../../types/bag';
import type { TFGraph } from '../TFTree/useTFGraph';
import type { SceneRefs } from './useScene';
import { createCameraFrustum, type CameraFrustumObject } from './cameraFrustum';
import { applyTransform } from './tfTransform';
import { cameraIntrinsicsEqual } from './sceneHelpers';

interface Options {
  sceneRef: RefObject<SceneRefs | null>;
  bag: BagSummary | null;
  graph: TFGraph | null;
  worldFrame: string | null;
  playheadNs: bigint;
  upFixMatrix: THREE.Matrix4;
  cameraFrustumsOn: boolean;
  cameraFrustumFar: number;
  hiddenFrustumTopics: string[];
}

/**
 * Camera frustums: a wireframe pyramid per `sensor_msgs/CameraInfo` topic.
 * Returns the topic list and the callback the hidden `CameraInfoFeed`
 * components use to push parsed intrinsics in.
 */
export function useCameraFrustums({
  sceneRef,
  bag,
  graph,
  worldFrame,
  playheadNs,
  upFixMatrix,
  cameraFrustumsOn,
  cameraFrustumFar,
  hiddenFrustumTopics,
}: Options) {
  const cameraInfoTopics = useMemo<string[]>(() => {
    if (!bag) return [];
    return bag.topics
      .filter((t) => isCameraInfoType(t.type))
      .map((t) => t.name)
      .sort();
  }, [bag]);

  const [cameraInfos, setCameraInfos] = useState<Map<string, CameraIntrinsics>>(
    new Map(),
  );
  const handleCameraInfoUpdate = useCallback(
    (topic: string, info: CameraIntrinsics | null) => {
      setCameraInfos((prev) => {
        const existing = prev.get(topic) ?? null;
        // No-op when the underlying intrinsics didn't actually change; this
        // keeps the lifecycle effect from re-running on every playhead tick.
        if (existing && info && cameraIntrinsicsEqual(existing, info)) return prev;
        if (!existing && !info) return prev;
        const next = new Map(prev);
        if (info) next.set(topic, info);
        else next.delete(topic);
        return next;
      });
    },
    [],
  );
  // (Topic deletions on bag swap are handled by the `CameraInfoFeed`'s
  // own unmount cleanup, which calls `onUpdate(topic, null)`. No
  // separate sync-effect is needed here.)

  const cameraFrustumsRef = useRef<Map<string, {
    frustum: CameraFrustumObject;
    cache: { key: string; matrix: THREE.Matrix4 } | null;
  }>>(new Map());

  // Lifecycle: create / dispose frustums to match the active topic set.
  // Lint disable: the `cameraFrustumsRef` map content is the canonical
  // source of truth for the panel's Three.js scene-graph contribution.
  // Mutating it from effects is the same pattern the rest of the panel
  // already uses for `objectsRef` (cloud, accumulator, marker set, etc.)
  // and is the standard idiom for hosting an imperative Three.js scene
  // alongside React state.
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    const owned = cameraFrustumsRef.current;
    const hiddenSet = new Set(hiddenFrustumTopics);
    const desired = cameraFrustumsOn
      ? new Set([...cameraInfos.keys()].filter((t) => !hiddenSet.has(t)))
      : new Set<string>();
    // Drop frustums whose topic is no longer wanted.
    for (const [topic, entry] of [...owned]) {
      if (!desired.has(topic)) {
        refs.worldGroup.remove(entry.frustum.object);
        entry.frustum.dispose();
        owned.delete(topic);
      }
    }
    // Add frustums for new topics. Each gets its own LineSegments material
    // because tinting per-camera (a v1.3.x follow-up) is easier if every
    // frustum already owns its material instance.
    for (const topic of desired) {
      if (owned.has(topic)) continue;
      const f = createCameraFrustum();
      refs.worldGroup.add(f.object);
      owned.set(topic, { frustum: f, cache: null });
    }
    refs.renderOnce();
  }, [cameraInfos, cameraFrustumsOn, hiddenFrustumTopics, sceneRef]);

  // Unmount cleanup: dispose every frustum when the panel itself goes away.
  useEffect(() => {
    // Capture the refs at effect-setup time so the cleanup function reads
    // the same instances even if React has nulled them by teardown.
    const refsAtSetup = sceneRef.current;
    const ownedAtSetup = cameraFrustumsRef.current;
    return () => {
      for (const [, entry] of ownedAtSetup) {
        if (refsAtSetup) refsAtSetup.worldGroup.remove(entry.frustum.object);
        entry.frustum.dispose();
      }
      ownedAtSetup.clear();
    };
    // Run only on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Per-tick: refresh geometry for the current far plane + apply TF chain
  // from each camera's optical frame to the world frame. Cheap enough to
  // run unconditionally; the geometry update reuses the same Float32Array
  // when the vertex count is stable.
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    const owned = cameraFrustumsRef.current;
    for (const [topic, entry] of owned) {
      const intrinsics = cameraInfos.get(topic);
      if (!intrinsics) {
        entry.frustum.object.visible = false;
        continue;
      }
      entry.frustum.object.visible = true;
      entry.frustum.update(intrinsics, cameraFrustumFar);
      // Cache key wraps a per-camera ref so each camera keeps its own
      // TF cache - sharing across cameras would invalidate every tick.
      const cacheHolder = {
        current: entry.cache,
      } as React.MutableRefObject<{ key: string; matrix: THREE.Matrix4 } | null>;
      applyTransform(
        entry.frustum.object,
        graph,
        intrinsics.frameId || null,
        worldFrame,
        playheadNs,
        cacheHolder,
        upFixMatrix,
      );
      entry.cache = cacheHolder.current;
    }
    refs.renderOnce();
  }, [
    cameraInfos,
    cameraFrustumFar,
    graph,
    worldFrame,
    playheadNs,
    upFixMatrix,
    sceneRef,
  ]);
  /* eslint-enable react-hooks/immutability */

  return { cameraInfoTopics, handleCameraInfoUpdate };
}
