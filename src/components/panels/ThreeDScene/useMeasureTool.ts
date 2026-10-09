import { useEffect, useRef, useState, type RefObject } from 'react';
import type * as THREE from 'three';
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
import type { SceneRefs } from './useScene';
import {
  createMeasureOverlay,
  distanceReadout,
  pickScenePoint,
  readoutText,
  type MeasureOverlay,
  type V3,
} from './measureTool';

/** The scene objects a measurement can land on. */
interface Pickable {
  cloud: { object: THREE.Object3D } | null;
  accumulator: { object: THREE.Object3D } | null;
}

/**
 * Click two points (cloud first, ground plane as a fallback) to read the
 * distance between them. Owns the tool's state, its overlay in the scene and
 * its Escape handling; the panel only renders the toggle and the readout.
 */
export function useMeasureTool(
  sceneRef: RefObject<SceneRefs | null>,
  objectsRef: RefObject<Pickable | null>,
) {
  const [measureOn, setMeasureOn] = useState(false);
  const [measurePts, setMeasurePts] = useState<V3[]>([]);
  const measureRef = useRef<MeasureOverlay | null>(null);

  // Click two points (cloud first, ground plane as a fallback) to read the
  // distance between them. A click is a press and release without a drag, so
  // orbiting still works while the tool is on.
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    const overlay = createMeasureOverlay();
    refs.worldGroup.add(overlay.object);
    measureRef.current = overlay;
    return () => {
      refs.worldGroup.remove(overlay.object);
      overlay.dispose();
      measureRef.current = null;
    };
  }, [sceneRef]);

  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs || !measureOn) return;
    const canvas = refs.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 && !e.shiftKey ? { x: e.clientX, y: e.clientY } : null;
    };
    const onUp = (e: PointerEvent) => {
      const start = down;
      down = null;
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) return;
      const targets: THREE.Object3D[] = [];
      const cloudObj = objectsRef.current?.cloud?.object;
      const accumObj = objectsRef.current?.accumulator?.object;
      if (cloudObj) targets.push(cloudObj);
      if (accumObj && accumObj.visible) targets.push(accumObj);
      const viewRadius = refs.camera.position.distanceTo(refs.controls.target);
      const hit = pickScenePoint(refs.camera, viewRadius, canvas, e.clientX, e.clientY, targets);
      if (!hit) return;
      const p = { x: hit.x, y: hit.y, z: hit.z };
      // A third click starts a new measurement.
      setMeasurePts((prev) => (prev.length === 1 ? [prev[0]!, p] : [p]));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointerup', onUp);
    canvas.style.cursor = 'crosshair';
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.style.cursor = '';
    };
  }, [sceneRef, objectsRef, measureOn]);

  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    const viewRadius = refs.camera.position.distanceTo(refs.controls.target);
    measureRef.current?.update(measurePts, Math.max(viewRadius * 0.012, 0.03));
    refs.renderOnce();
  }, [measurePts, sceneRef]);

  // Esc clears a measurement first, then turns the tool off.
  useEscapeToClose(measureOn, () => {
    if (measurePts.length > 0) setMeasurePts([]);
    else setMeasureOn(false);
  });

  const measureReadout =
    measurePts.length === 2 ? readoutText(distanceReadout(measurePts[0]!, measurePts[1]!)) : null;

  return { measureOn, setMeasureOn, measurePts, setMeasurePts, measureReadout };
}
