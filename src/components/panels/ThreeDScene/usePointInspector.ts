import { useEffect, useRef, useState, type RefObject } from 'react';
import * as THREE from 'three';
import type { DecodedCloud } from './useDecodedPointCloud';
import type { SceneRefs } from './useScene';

export interface HoveredPoint {
  /** Pointer position inside the canvas, in CSS pixels. */
  x: number;
  y: number;
  /** Index of the point within the decoded cloud. */
  index: number;
  /** The decoded frame this point belongs to; a hit on an older frame is not shown. */
  source: DecodedCloud;
  /** Coordinates in the cloud's own frame, as published. */
  position: { x: number; y: number; z: number };
  intensity: number | null;
  ring: number | null;
}

/** Raycasting walks every point, so very large clouds are not hover-inspected. */
const MAX_HOVER_POINTS = 400_000;
/** At most this often: a raycast over a big cloud costs several milliseconds. */
const MIN_INTERVAL_MS = 60;

interface Options {
  sceneRef: RefObject<SceneRefs | null>;
  /** The Three.js points object the decoded cloud is drawn in (read at hover time, so it may change). */
  getCloudObject: () => THREE.Object3D | null;
  cloud: DecodedCloud | null;
  /** Off while another tool owns the pointer (measuring) or the panel has no hover target. */
  enabled: boolean;
}

/**
 * Hover a point to read its coordinates, intensity and ring. Decoded clouds
 * keep those per point (see `decodePointCloud2`), so a hit's index is all it
 * takes; there is no second trip to the worker.
 */
export function usePointInspector({ sceneRef, getCloudObject, cloud, enabled }: Options): HoveredPoint | null {
  const [hovered, setHovered] = useState<HoveredPoint | null>(null);
  const getTargetRef = useRef(getCloudObject);
  useEffect(() => {
    getTargetRef.current = getCloudObject;
  });
  // Where the pointer last rested over the canvas, so a new frame re-picks under it.
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs || !enabled) return;
    const canvas = refs.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let lastRun = 0;
    let pending: { x: number; y: number } | null = pointerRef.current;
    let raf = 0;

    const run = () => {
      raf = 0;
      const at = pending;
      pending = null;
      const target = getTargetRef.current();
      const data = cloud;
      if (!at || !target || !data) return;
      if (data.pointCount > MAX_HOVER_POINTS) return;
      lastRun = performance.now();
      const rect = canvas.getBoundingClientRect();
      ndc.set(((at.x - rect.left) / rect.width) * 2 - 1, -((at.y - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(ndc, refs.camera);
      const radius = refs.camera.position.distanceTo(refs.controls.target);
      raycaster.params.Points = { threshold: Math.max(radius * 0.008, 0.03) };
      const hit = raycaster.intersectObject(target, false)[0];
      const index = hit?.index;
      if (index === undefined || index >= data.pointCount) {
        setHovered(null);
        return;
      }
      const p = data.positions;
      setHovered({
        x: at.x - rect.left,
        y: at.y - rect.top,
        index,
        source: data,
        position: { x: p[index * 3]!, y: p[index * 3 + 1]!, z: p[index * 3 + 2]! },
        intensity: 'intensity' in data && data.intensity ? data.intensity[index]! : null,
        ring: 'ring' in data && data.ring ? data.ring[index]! : null,
      });
    };
    const schedule = () => {
      if (raf) return;
      const wait = Math.max(0, MIN_INTERVAL_MS - (performance.now() - lastRun));
      raf = window.setTimeout(run, wait) as unknown as number;
    };
    const clear = () => {
      pointerRef.current = null;
      pending = null;
      setHovered(null);
    };
    const onMove = (e: PointerEvent) => {
      // Dragging orbits or pans; a tooltip following it would just be in the way.
      if (e.buttons !== 0) {
        clear();
        return;
      }
      pointerRef.current = { x: e.clientX, y: e.clientY };
      pending = pointerRef.current;
      schedule();
    };

    if (pending) schedule();
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', clear);
    canvas.addEventListener('pointerdown', clear);
    canvas.addEventListener('wheel', clear, { passive: true });
    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', clear);
      canvas.removeEventListener('pointerdown', clear);
      canvas.removeEventListener('wheel', clear);
      if (raf) clearTimeout(raf);
    };
  }, [sceneRef, enabled, cloud]);

  // The point under the pointer describes the previous frame once a new one arrives.
  return enabled && hovered && hovered.source === cloud ? hovered : null;
}
