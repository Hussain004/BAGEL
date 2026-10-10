import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
import type { Goal2D } from '../../../live/controlCodec';
import type { LiveConnection } from '../../../live/liveConnection';
import type { SceneRefs } from './useScene';
import { createGoalMarker, dragToGoal, pickGroundLocal, type GoalMarker, type XY } from './goalTool';

/** A drag shorter than this many pixels is a click, which carries no heading. */
const MIN_DRAG_PX = 8;

interface Options {
  sceneRef: RefObject<SceneRefs | null>;
  conn: LiveConnection | null;
  /** The fixed frame the panel is drawing in; the goal is expressed in it. */
  worldFrame: string | null;
  /** Re-run when the camera and controls are replaced. */
  projectionMode: string;
}

/**
 * "2D Goal": drag on the floor to place a goal and aim it, then Send. Nothing
 * is published until the explicit Send, and only while control is enabled.
 */
export function useGoalTool({ sceneRef, conn, worldFrame, projectionMode }: Options) {
  const [goalOn, setGoalOn] = useState(false);
  const frame = worldFrame ?? '';
  // A goal belongs to the frame it was placed in: change the frame and it is gone.
  const [placed, setPlaced] = useState<{ goal: Goal2D; frame: string } | null>(null);
  const pending = placed && placed.frame === frame ? placed.goal : null;
  const setPending = useCallback((goal: Goal2D | null) => setPlaced(goal ? { goal, frame } : null), [frame]);
  const [topic, setTopic] = useState('/goal_pose');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const markerRef = useRef<GoalMarker | null>(null);

  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    const marker = createGoalMarker();
    refs.worldGroup.add(marker.object);
    markerRef.current = marker;
    return () => {
      refs.worldGroup.remove(marker.object);
      marker.dispose();
      markerRef.current = null;
    };
  }, [sceneRef]);

  const show = useCallback(
    (goal: Goal2D | null) => {
      const refs = sceneRef.current;
      if (!refs) return;
      const radius = refs.camera.position.distanceTo(refs.controls.target);
      markerRef.current?.update(goal, Math.max(radius * 0.12, 0.4));
      refs.renderOnce();
    },
    [sceneRef],
  );

  useEffect(() => show(pending), [pending, show]);

  // Drags place the goal instead of moving the camera while the tool is on.
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs || !goalOn) return;
    const canvas = refs.renderer.domElement;
    const controls = refs.controls;
    controls.enabled = false;
    canvas.style.cursor = 'crosshair';
    let start: { world: XY; px: XY } | null = null;

    const toWorld = (e: PointerEvent) => pickGroundLocal(refs.camera, canvas, e.clientX, e.clientY, refs.worldGroup);
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const world = toWorld(e);
      if (!world) return;
      canvas.setPointerCapture(e.pointerId);
      start = { world, px: { x: e.clientX, y: e.clientY } };
      setMessage(null);
    };
    const onMove = (e: PointerEvent) => {
      if (!start) return;
      const here = toWorld(e);
      if (!here) return;
      const goal = dragToGoal(start.world, here, 1e-6);
      show(goal ?? { x: start.world.x, y: start.world.y, yaw: 0 });
    };
    const onUp = (e: PointerEvent) => {
      const s = start;
      start = null;
      if (!s) return;
      const here = toWorld(e);
      const moved = Math.hypot(e.clientX - s.px.x, e.clientY - s.px.y);
      const goal = here && moved >= MIN_DRAG_PX ? dragToGoal(s.world, here, 1e-6) : null;
      if (goal) setPending(goal);
      else {
        setMessage({ ok: false, text: 'Drag from where the robot should go toward the way it should face.' });
        show(null);
      }
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.style.cursor = '';
      controls.enabled = true;
    };
  }, [sceneRef, goalOn, projectionMode, show, setPending]);

  const cancel = useCallback(() => {
    setPending(null);
    setMessage(null);
  }, [setPending]);

  const send = useCallback(() => {
    if (!conn || !pending) return;
    const error = conn.publishGoal(topic.trim(), pending, frame);
    if (error) {
      setMessage({ ok: false, text: error });
      return;
    }
    setMessage({ ok: true, text: `Sent to ${topic.trim()} in frame ${frame}.` });
    setPending(null);
  }, [conn, pending, topic, frame, setPending]);

  const close = useCallback(() => {
    setGoalOn(false);
    setPending(null);
    setMessage(null);
  }, [setPending]);

  // Esc drops a placed goal first, then turns the tool off.
  useEscapeToClose(goalOn, () => (pending ? cancel() : close()));

  return { goalOn, setGoalOn: (on: boolean) => (on ? setGoalOn(true) : close()), pending, topic, setTopic, message, send, cancel };
}
