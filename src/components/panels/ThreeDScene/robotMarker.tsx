/**
 * A small colored marker (puck + heading wedge) standing in for a robot when
 * no URDF is loaded for it. Multi-bag panels (several robots overlaid on one
 * map) benefit from seeing where each robot actually is, but loading a
 * distinct URDF per bag is a bigger feature than that need justifies - this
 * is deliberately simpler and smaller than `public/sample-bags/sample-robot.urdf`
 * (no wheels, no sensor mast), tinted with the bag's own color so it reads
 * at a glance which robot is which, matching the same color already used for
 * that bag's chip in the toolbar and its rows in the overlay picker.
 */
import { useEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useBagLocalPlayhead } from '../../../hooks/useBagLocalPlayhead';
import { createRobotBody, disposeObject } from './sceneObjects';
import { applyTransform } from './tfTransform';
import { useTFGraph, type TFGraph } from '../TFTree/useTFGraph';
import type { SceneRefs } from './useScene';

/** Prefers a `*_base_link` frame; falls back to `*_base_footprint`. Returns null when neither exists. */
function pickRobotBaseFrame(graph: TFGraph): string | null {
  const frames = Array.from(graph.frames);
  const baseLink = frames.filter((f) => /base_link$/i.test(f)).sort((a, b) => a.length - b.length);
  if (baseLink.length > 0) return baseLink[0];
  const baseFootprint = frames
    .filter((f) => /base_footprint$/i.test(f))
    .sort((a, b) => a.length - b.length);
  return baseFootprint[0] ?? null;
}

interface RobotMarkerProps {
  bagId: string;
  color: string;
  sceneRef: RefObject<SceneRefs | null>;
  worldFrame: string | null;
  upFixMatrix: THREE.Matrix4;
}

export function RobotMarker({ bagId, color, sceneRef, worldFrame, upFixMatrix }: RobotMarkerProps) {
  const { graph } = useTFGraph(bagId);
  const playheadNs = useBagLocalPlayhead(bagId);
  const baseFrame = useMemo(() => (graph ? pickRobotBaseFrame(graph) : null), [graph]);
  const ownedRef = useRef<THREE.Group | null>(null);
  const transformCache = useRef<{ key: string; matrix: THREE.Matrix4 } | null>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const marker = createRobotBody(color);
    marker.name = `robot-marker:${bagId}`;
    scene.scene.add(marker);
    ownedRef.current = marker;
    scene.renderOnce();

    return () => {
      scene.scene.remove(marker);
      disposeObject(marker);
      ownedRef.current = null;
      scene.renderOnce();
    };
  }, [sceneRef, bagId, color]);

  useEffect(() => {
    const scene = sceneRef.current;
    const owned = ownedRef.current;
    if (!scene || !owned) return;
    // Hide rather than leave parked at the origin (identity transform) when
    // the graph hasn't loaded yet or this bag has no recognizable base frame.
    if (!baseFrame) {
      owned.visible = false;
      scene.renderOnce();
      return;
    }
    owned.visible = true;
    applyTransform(owned, graph, baseFrame, worldFrame, playheadNs, transformCache, upFixMatrix);
    scene.renderOnce();
  }, [graph, baseFrame, worldFrame, playheadNs, upFixMatrix, sceneRef]);

  return null;
}
