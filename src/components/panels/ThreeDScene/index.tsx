import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useBagStore } from '../../../store/bagStore';
import { usePlayheadStore } from '../../../store/playheadStore';
import { PanelShell } from '../PanelShell';
import { getTopicColor } from '../../../utils/color';
import { nsToSeconds } from '../../../utils/time';
import {
  isCloudType,
  isLaserScanType,
} from '../../../utils/messages';
import { useMessageAtTime } from '../../../hooks/useMessageAtTime';
import { useTFGraph, type TFGraph } from '../TFTree/useTFGraph';
import type { ColorMode } from '../../../utils/pointcloud';
import { useScene } from './useScene';
import {
  createGroundGrid,
  createLaserScan,
  createPointCloud,
  createPoseAxes,
  createWorldAxes,
  disposeObject,
  extractPose,
  updateCloud,
  updatePoseAxes,
  type CloudObject,
  type PoseAxesObject,
} from './sceneObjects';
import { composeTFChain, pickWorldFrame } from './tfTransform';
import { useDecodedCloud } from './useDecodedPointCloud';
import { CloudAccumulator } from './accumulator';

interface ThreeDSceneProps {
  panelId: string;
  topicName: string;
  type: string;
}

type SceneKind = 'pointcloud' | 'laserscan' | 'pose';

/**
 * Which source-frame axis points up in the rendered scene. ROS standard is
 * "z+", but bags from Livox, drone NED frames, or camera-aligned LiDAR rigs
 * sometimes emit clouds with X-up, Y-up, or an inverted Z. The selector
 * applies a fixed rotation that maps the chosen axis onto render-space +Z,
 * which is the direction `camera.up` always points.
 */
type UpAxis = 'z+' | 'z-' | 'y+' | 'y-' | 'x+' | 'x-';

const UP_AXIS_OPTIONS: { value: UpAxis; label: string }[] = [
  { value: 'z+', label: '+Z up (ROS default)' },
  { value: 'z-', label: '-Z up (flipped)' },
  { value: 'y+', label: '+Y up' },
  { value: 'y-', label: '-Y up' },
  { value: 'x+', label: '+X up' },
  { value: 'x-', label: '-X up' },
];

/**
 * Build the source→render rotation matrix that puts the chosen source axis
 * onto render-space +Z. Identity for the default "z+". All other cases are
 * a single 90°/180° rotation around X or Y so the math is exact and the
 * resulting matrix is orthonormal.
 */
function makeUpFix(axis: UpAxis): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  switch (axis) {
    case 'z+':
      break; // identity
    case 'z-':
      m.makeRotationX(Math.PI);
      break;
    case 'y+':
      m.makeRotationX(Math.PI / 2);
      break;
    case 'y-':
      m.makeRotationX(-Math.PI / 2);
      break;
    case 'x+':
      m.makeRotationY(-Math.PI / 2);
      break;
    case 'x-':
      m.makeRotationY(Math.PI / 2);
      break;
  }
  return m;
}

function detectKind(type: string): SceneKind {
  // Both sensor_msgs/PointCloud2 and list-of-points clouds (Livox CustomMsg
  // etc.) take the 'pointcloud' branch — they share the same render
  // pipeline once the worker has produced Float32Array positions + colors.
  if (isCloudType(type)) return 'pointcloud';
  if (isLaserScanType(type)) return 'laserscan';
  return 'pose';
}

/**
 * ThreeDScene — Three.js-powered 3D viewer for spatial ROS2 topics.
 *
 * Render-flow split:
 *   - PointCloud2 / LaserScan → worker-decoded buffers (transferable
 *     Float32Arrays) via `useDecodedCloud`. The main thread never walks
 *     the raw `data: Uint8Array` and never copies it across postMessage.
 *   - Pose-bearing topics → `useMessageAtTime` (small messages, decode on
 *     the main thread is cheap).
 *
 * TF: when /tf is present, the message's `header.frame_id` is composed with
 * the user-selected world frame at every playhead update. Heavy graph walks
 * are cheap (a handful of binary searches), but we memoize when nothing
 * changes so the scene update doesn't redo unnecessary work.
 */
export function ThreeDScene({ panelId, topicName, type }: ThreeDSceneProps) {
  const bag = useBagStore((s) => s.bag);
  const playheadNs = usePlayheadStore((s) => s.timeNs);
  const sceneKind = useMemo(() => detectKind(type), [type]);

  const [colorMode, setColorMode] = useState<ColorMode>('height');
  const [pointSize, setPointSize] = useState(2.5);
  const [showGrid, setShowGrid] = useState(true);
  const [showWorldAxes, setShowWorldAxes] = useState(true);
  const [worldFrame, setWorldFrame] = useState<string | null>(null);

  // Range filter — drop returns farther than `maxRange` metres from the
  // sensor origin before bounds + height-colour are computed.
  const [rangeLimitOn, setRangeLimitOn] = useState(false);
  const [maxRange, setMaxRange] = useState(30);

  // Accumulation — keep a ring buffer of world-frame points across frames so
  // the user can build up a running "map" view from a drone flight or SLAM run.
  const [accumulating, setAccumulating] = useState(false);
  const [accumBudget, setAccumBudget] = useState(1_000_000);
  const [accumPerFrame, setAccumPerFrame] = useState(25_000);
  // Footer stats for the accumulator. Updated on every successful append.
  const [accumStats, setAccumStats] = useState<{ points: number; frames: number }>({
    points: 0,
    frames: 0,
  });

  // Pivot — Shift+Click sets a custom orbit centre; null means "auto-fit centre".
  const [pivot, setPivot] = useState<{ x: number; y: number; z: number } | null>(null);

  // Up-axis fix — rotates the cloud so the chosen source axis points up in
  // the rendered scene. Cleared accumulator + pivot are forced on change
  // because both store positions in render-space coordinates.
  const [upAxis, setUpAxis] = useState<UpAxis>('z+');
  const upFixMatrix = useMemo(() => makeUpFix(upAxis), [upAxis]);

  // Cloud topics use the worker-decoded fast path; pose topics stay on the
  // generic message-at-time hook because their messages are tiny.
  const isCloud = sceneKind === 'pointcloud' || sceneKind === 'laserscan';
  const cloudState = useDecodedCloud({
    kind: sceneKind === 'pointcloud' ? 'pointcloud' : 'laserscan',
    topicName,
    timeNs: playheadNs,
    colorMode: sceneKind === 'pointcloud' ? colorMode : undefined,
    // LaserScan ignores maxRange in the decoder; only piping it through for
    // PointCloud2 keeps the hook's request key tight for scans.
    maxRange:
      sceneKind === 'pointcloud' && rangeLimitOn && maxRange > 0 ? maxRange : undefined,
  });
  const poseState = useMessageAtTime(topicName, playheadNs);

  const cloud = isCloud ? cloudState.cloud : null;
  const poseMessage = !isCloud ? poseState.message : null;
  const loading = isCloud ? cloudState.loading : poseState.loading;
  const error = isCloud ? cloudState.error : poseState.error;

  const { graph, missing: noTf } = useTFGraph();
  const { containerRef, sceneRef } = useScene();

  // Auto-pick a world frame when the TF graph + first message arrive.
  useEffect(() => {
    if (worldFrame || !graph) return;
    const srcFrame =
      cloud?.frameId ?? (poseMessage ? pickFrameId(poseMessage.value) : undefined);
    if (!srcFrame) return;
    const pick = pickWorldFrame(graph, srcFrame);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pick) setWorldFrame(pick);
  }, [graph, cloud, poseMessage, worldFrame]);

  // Build scene objects exactly once per panel mount. Stats are tracked in a
  // ref so per-frame updates don't trigger React renders.
  const objectsRef = useRef<{
    cloud: CloudObject | null;
    poseAxes: PoseAxesObject | null;
    grid: THREE.GridHelper | null;
    worldAxes: THREE.AxesHelper | null;
    /** Ring-buffer accumulator for world-frame points. Cloud panels only. */
    accumulator: CloudAccumulator | null;
    /** Visual marker at the orbit pivot. Hidden when pivot is the auto-fit centre. */
    pivotMarker: THREE.Mesh | null;
  } | null>(null);

  // Dedupe accumulator appends — the cloud-effect can fire on the same
  // timestamp when a non-data prop changes (e.g. point size), and we don't
  // want each colour-mode flip to double-add the current frame.
  const lastAppendedTsRef = useRef<bigint | null>(null);

  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    const owned = {
      cloud: null as CloudObject | null,
      poseAxes: null as PoseAxesObject | null,
      grid: null as THREE.GridHelper | null,
      worldAxes: null as THREE.AxesHelper | null,
      accumulator: null as CloudAccumulator | null,
      pivotMarker: null as THREE.Mesh | null,
    };

    if (sceneKind === 'pointcloud') {
      owned.cloud = createPointCloud(pointSize);
      refs.userGroup.add(owned.cloud.object);
      // Accumulator only makes sense for full point clouds — laser scans
      // already represent a single 2D ring per frame and don't benefit much
      // from running concatenation.
      owned.accumulator = new CloudAccumulator(accumBudget, pointSize);
      owned.accumulator.object.visible = false;
      refs.worldGroup.add(owned.accumulator.object);
    } else if (sceneKind === 'laserscan') {
      owned.cloud = createLaserScan(pointSize + 1);
      refs.userGroup.add(owned.cloud.object);
    } else {
      owned.poseAxes = createPoseAxes(1.0);
      refs.userGroup.add(owned.poseAxes.object);
    }

    owned.grid = createGroundGrid(40, 40);
    refs.worldGroup.add(owned.grid);
    owned.worldAxes = createWorldAxes(1.0);
    refs.worldGroup.add(owned.worldAxes);

    // Custom-pivot indicator. Wireframe sphere over the scene (depthTest off)
    // so it stays visible against any colour cloud.
    const pivotGeo = new THREE.SphereGeometry(0.15, 12, 8);
    const pivotMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    owned.pivotMarker = new THREE.Mesh(pivotGeo, pivotMat);
    owned.pivotMarker.renderOrder = 999;
    owned.pivotMarker.visible = false;
    refs.worldGroup.add(owned.pivotMarker);

    objectsRef.current = owned;
    refs.renderOnce();

    return () => {
      if (owned.cloud) {
        refs.userGroup.remove(owned.cloud.object);
        disposeObject(owned.cloud.object);
      }
      if (owned.poseAxes) {
        refs.userGroup.remove(owned.poseAxes.object);
        disposeObject(owned.poseAxes.object);
      }
      if (owned.grid) {
        refs.worldGroup.remove(owned.grid);
        owned.grid.geometry.dispose();
        const m = owned.grid.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m.dispose();
      }
      if (owned.worldAxes) {
        refs.worldGroup.remove(owned.worldAxes);
        owned.worldAxes.geometry.dispose();
        const m = owned.worldAxes.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m.dispose();
      }
      if (owned.accumulator) {
        refs.worldGroup.remove(owned.accumulator.object);
        owned.accumulator.dispose();
      }
      if (owned.pivotMarker) {
        refs.worldGroup.remove(owned.pivotMarker);
        owned.pivotMarker.geometry.dispose();
        const m = owned.pivotMarker.material as THREE.Material | THREE.Material[];
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else m.dispose();
      }
      objectsRef.current = null;
    };
    // Intentionally only on mount: we never swap kinds mid-lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneRef, sceneKind]);

  // Toggle helpers without rebuilding objects.
  useEffect(() => {
    const refs = sceneRef.current;
    const owned = objectsRef.current;
    if (!refs || !owned) return;
    if (owned.grid) owned.grid.visible = showGrid;
    if (owned.worldAxes) owned.worldAxes.visible = showWorldAxes;
    refs.renderOnce();
  }, [showGrid, showWorldAxes, sceneRef]);

  useEffect(() => {
    const owned = objectsRef.current;
    const refs = sceneRef.current;
    if (!refs || !owned) return;
    if (owned.cloud) owned.cloud.material.size = sceneKind === 'laserscan' ? pointSize + 1 : pointSize;
    if (owned.accumulator) owned.accumulator.setPointSize(pointSize);
    refs.renderOnce();
  }, [pointSize, sceneKind, sceneRef]);

  // Accumulator visibility toggle.
  useEffect(() => {
    const owned = objectsRef.current;
    const refs = sceneRef.current;
    if (!refs || !owned?.accumulator) return;
    owned.accumulator.object.visible = accumulating;
    refs.renderOnce();
  }, [accumulating, sceneRef]);

  // Re-size the accumulator buffer when the user changes the budget slider.
  // resize() drops existing data, so the stats reset alongside.
  useEffect(() => {
    const owned = objectsRef.current;
    const refs = sceneRef.current;
    if (!refs || !owned?.accumulator) return;
    owned.accumulator.resize(accumBudget);
    lastAppendedTsRef.current = null;
    setAccumStats({ points: 0, frames: 0 });
    refs.renderOnce();
  }, [accumBudget, sceneRef]);

  // Clear the accumulator + custom pivot whenever the coordinate system the
  // panel renders into changes — world frame, topic, or up-axis. Both the
  // accumulator's stored points and the pivot are expressed in render-space
  // coordinates that get invalidated by any of these changes.
  useEffect(() => {
    const refs = sceneRef.current;
    const owned = objectsRef.current;
    if (!refs) return;
    if (owned?.accumulator) {
      owned.accumulator.clear();
      lastAppendedTsRef.current = null;
      setAccumStats({ points: 0, frames: 0 });
    }
    setPivot(null);
    refs.renderOnce();
  }, [worldFrame, topicName, upAxis, sceneRef]);

  const handleClearAccumulator = () => {
    const owned = objectsRef.current;
    const refs = sceneRef.current;
    if (!refs || !owned?.accumulator) return;
    owned.accumulator.clear();
    lastAppendedTsRef.current = null;
    setAccumStats({ points: 0, frames: 0 });
    refs.renderOnce();
  };

  // Shift+Click → pick a custom orbit pivot in world space.
  //
  // We raycast against the active cloud first (with a Points.threshold tied
  // to the camera distance so the picked tolerance scales with zoom). If
  // nothing's hit — e.g. the user clicked empty space — we fall back to the
  // z=0 ground plane, which is the conventional ROS world floor.
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    const canvas = refs.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const planeHit = new THREE.Vector3();

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.shiftKey || event.button !== 0) return;
      // Block OrbitControls from interpreting this as a drag-start.
      event.preventDefault();
      event.stopPropagation();

      const rect = canvas.getBoundingClientRect();
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(ndc, refs.camera);
      // Threshold scales with view radius so picking feels the same whether
      // you're zoomed into a 5 m room or out over a 200 m field.
      const viewRadius = refs.camera.position.distanceTo(refs.controls.target);
      raycaster.params.Points = { threshold: Math.max(viewRadius * 0.01, 0.05) };

      let hit: THREE.Vector3 | null = null;
      const cloudObj = objectsRef.current?.cloud?.object;
      const accumObj = objectsRef.current?.accumulator?.object;
      // Try both the live frame and the accumulated cloud — either is fair
      // game as a pivot target.
      const targets: THREE.Object3D[] = [];
      if (cloudObj) targets.push(cloudObj);
      if (accumObj && accumObj.visible) targets.push(accumObj);
      for (const target of targets) {
        const hits = raycaster.intersectObject(target, false);
        if (hits.length > 0) {
          hit = hits[0].point.clone();
          break;
        }
      }
      if (!hit) {
        const out = raycaster.ray.intersectPlane(groundPlane, planeHit);
        if (out) hit = planeHit.clone();
      }
      if (!hit) return;
      refs.setOrbitTarget(hit);
      setPivot({ x: hit.x, y: hit.y, z: hit.z });
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
    };
    // sceneRef stays stable for the panel's lifetime; the handler closes over
    // the live objectsRef so we don't need to re-bind when the cloud updates.
  }, [sceneRef]);

  // Keep the pivot marker in sync with the chosen pivot.
  useEffect(() => {
    const owned = objectsRef.current;
    const refs = sceneRef.current;
    if (!refs || !owned?.pivotMarker) return;
    if (pivot) {
      owned.pivotMarker.position.set(pivot.x, pivot.y, pivot.z);
      owned.pivotMarker.visible = true;
    } else {
      owned.pivotMarker.visible = false;
    }
    refs.renderOnce();
  }, [pivot, sceneRef]);

  // Footer stats. Updated only when the data actually changes (not on every
  // playhead tick), so React doesn't churn during playback.
  const [stats, setStats] = useState<{
    points: number;
    bounds: {
      min: { x: number; y: number; z: number };
      max: { x: number; y: number; z: number };
    } | null;
    sourceFrame: string | null;
    timestamp: bigint | null;
  }>({ points: 0, bounds: null, sourceFrame: null, timestamp: null });

  // Memoize the world transform so the per-frame effect doesn't redo the
  // chain walk when the playhead moves but TF graph / world frame don't.
  const cachedTransformRef = useRef<{
    key: string;
    matrix: THREE.Matrix4;
  } | null>(null);

  // Apply a fresh cloud frame to the scene. Splitting from the pose branch
  // keeps each branch's dependencies clear and avoids ping-ponging when
  // both states update at once.
  useEffect(() => {
    const refs = sceneRef.current;
    const owned = objectsRef.current;
    if (!refs || !owned?.cloud || !cloud) return;

    const sourceFrame = cloud.frameId ?? null;
    applyTransform(
      refs.userGroup,
      graph,
      sourceFrame,
      worldFrame,
      cloud.timestamp,
      cachedTransformRef,
      upFixMatrix,
    );

    updateCloud(owned.cloud, {
      positions: cloud.positions,
      colors: cloud.colors,
      pointCount: cloud.pointCount,
      bounds: cloud.bounds,
    });
    setStats({
      points: cloud.pointCount,
      bounds: cloud.bounds,
      sourceFrame,
      timestamp: cloud.timestamp,
    });

    // Accumulator append. userGroup.matrix is now `upFix * tfChain` so using
    // it directly as the worldMatrix puts appended points in render-space
    // coordinates — consistent with the live frame and with previously
    // accumulated points for as long as upAxis stays the same.
    if (
      accumulating &&
      owned.accumulator &&
      sceneKind === 'pointcloud' &&
      lastAppendedTsRef.current !== cloud.timestamp
    ) {
      const stride = Math.max(
        1,
        Math.ceil(cloud.pointCount / Math.max(1, accumPerFrame)),
      );
      owned.accumulator.append(
        cloud.positions,
        cloud.colors,
        cloud.pointCount,
        refs.userGroup.matrix,
        stride,
      );
      lastAppendedTsRef.current = cloud.timestamp;
      const stats = owned.accumulator.getStats();
      setAccumStats({ points: stats.pointCount, frames: stats.framesAccumulated });
    }
    refs.renderOnce();
  }, [cloud, graph, worldFrame, sceneRef, accumulating, accumPerFrame, sceneKind, upFixMatrix]);

  useEffect(() => {
    const refs = sceneRef.current;
    const owned = objectsRef.current;
    if (!refs || !owned?.poseAxes || !poseMessage?.value) return;

    const sourceFrame = pickFrameId(poseMessage.value) ?? null;
    applyTransform(
      refs.userGroup,
      graph,
      sourceFrame,
      worldFrame,
      poseMessage.timestamp,
      cachedTransformRef,
      upFixMatrix,
    );

    const pose = extractPose(poseMessage.value, type);
    if (pose) {
      updatePoseAxes(owned.poseAxes, pose);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStats({
        points: 1,
        bounds: {
          min: { x: pose.position.x - 1, y: pose.position.y - 1, z: pose.position.z - 1 },
          max: { x: pose.position.x + 1, y: pose.position.y + 1, z: pose.position.z + 1 },
        },
        sourceFrame,
        timestamp: poseMessage.timestamp,
      });
    }
    refs.renderOnce();
  }, [poseMessage, graph, worldFrame, type, sceneRef, upFixMatrix]);

  // First-frame autofit. Subsequent frames leave the camera alone so playback
  // doesn't yank the view around.
  const hasAutoFitRef = useRef(false);
  useEffect(() => {
    if (hasAutoFitRef.current) return;
    const refs = sceneRef.current;
    if (!refs || !stats.bounds) return;
    const { min, max } = stats.bounds;
    const cx = (min.x + max.x) / 2;
    const cy = (min.y + max.y) / 2;
    const cz = (min.z + max.z) / 2;
    const radius = Math.max(
      Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) * 0.7,
      3,
    );
    const target = new THREE.Vector3(cx, cy, cz).applyMatrix4(refs.userGroup.matrix);
    refs.resetCamera(target, radius);
    hasAutoFitRef.current = true;
  }, [stats.bounds, sceneRef]);

  const accent = getTopicColor(topicName, type);
  const startNs = bag?.startTime ?? 0n;

  const handleResetCamera = () => {
    const refs = sceneRef.current;
    if (!refs) return;
    if (stats.bounds) {
      const { min, max } = stats.bounds;
      const cx = (min.x + max.x) / 2;
      const cy = (min.y + max.y) / 2;
      const cz = (min.z + max.z) / 2;
      const radius = Math.max(
        Math.hypot(max.x - min.x, max.y - min.y, max.z - min.z) * 0.7,
        3,
      );
      const target = new THREE.Vector3(cx, cy, cz).applyMatrix4(refs.userGroup.matrix);
      refs.resetCamera(target, radius);
    } else {
      refs.resetCamera(new THREE.Vector3(0, 0, 0), 10);
    }
    // Fit re-centres the orbit on the cloud, which means any manual pivot is
    // implicitly overridden. Drop the marker so the user isn't left wondering
    // why orbiting no longer happens around their picked point.
    setPivot(null);
  };

  /**
   * Recentre the orbit on the auto-fit centre without moving the camera.
   * Lets the user return from a custom pivot when their current viewing
   * angle is still useful but the rotation centre has drifted off-cloud.
   */
  const handleResetPivot = () => {
    const refs = sceneRef.current;
    if (!refs) return;
    if (stats.bounds) {
      const { min, max } = stats.bounds;
      const cx = (min.x + max.x) / 2;
      const cy = (min.y + max.y) / 2;
      const cz = (min.z + max.z) / 2;
      const target = new THREE.Vector3(cx, cy, cz).applyMatrix4(refs.userGroup.matrix);
      refs.setOrbitTarget(target);
    } else {
      refs.setOrbitTarget(new THREE.Vector3(0, 0, 0));
    }
    setPivot(null);
  };

  const showInitialSpinner = loading && !cloud && !poseMessage;

  return (
    <PanelShell
      panelId={panelId}
      kind="3d"
      topicName={topicName}
      type={type}
      accentColor={accent}
    >
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 min-h-[260px] relative bg-bg-primary/60 overflow-hidden">
          <div ref={containerRef} className="absolute inset-0" />

          <div className="absolute top-2 right-2 flex flex-col gap-1.5 items-end">
            <div className="flex gap-1">
              {pivot && (
                <button
                  onClick={handleResetPivot}
                  className="px-2 py-1 rounded-md text-xs mono bg-surface/80 border border-border hover:border-accent-blue/40 hover:text-accent-blue text-text-secondary transition-all"
                  title="Return orbit centre to the auto-fit point"
                >
                  Reset pivot
                </button>
              )}
              <button
                onClick={handleResetCamera}
                className="px-2 py-1 rounded-md text-xs mono bg-surface/80 border border-border hover:border-accent-blue/40 hover:text-accent-blue text-text-secondary transition-all"
                title="Reset camera"
              >
                Fit
              </button>
            </div>
            <ControlsCard
              sceneKind={sceneKind}
              colorMode={colorMode}
              setColorMode={setColorMode}
              pointSize={pointSize}
              setPointSize={setPointSize}
              showGrid={showGrid}
              setShowGrid={setShowGrid}
              showWorldAxes={showWorldAxes}
              setShowWorldAxes={setShowWorldAxes}
              graph={graph}
              worldFrame={worldFrame}
              setWorldFrame={setWorldFrame}
              noTf={noTf}
              rangeLimitOn={rangeLimitOn}
              setRangeLimitOn={setRangeLimitOn}
              maxRange={maxRange}
              setMaxRange={setMaxRange}
              accumulating={accumulating}
              setAccumulating={setAccumulating}
              accumBudget={accumBudget}
              setAccumBudget={setAccumBudget}
              accumPerFrame={accumPerFrame}
              setAccumPerFrame={setAccumPerFrame}
              onClearAccumulator={handleClearAccumulator}
              accumStats={accumStats}
              upAxis={upAxis}
              setUpAxis={setUpAxis}
            />
          </div>

          <div className="absolute top-2 left-2 text-text-muted text-[10px] mono leading-tight bg-bg-primary/60 backdrop-blur px-2 py-1 rounded-md border border-border max-w-[60%]">
            <div className="text-text-secondary">
              {sceneKind === 'pointcloud'
                ? 'PointCloud2'
                : sceneKind === 'laserscan'
                  ? 'LaserScan'
                  : 'Pose'}
            </div>
            {stats.sourceFrame && (
              <div>
                <span className="text-text-tertiary">frame</span>{' '}
                <span>{stats.sourceFrame}</span>
                {worldFrame && worldFrame !== stats.sourceFrame && (
                  <>
                    <span className="text-text-tertiary"> → </span>
                    <span>{worldFrame}</span>
                  </>
                )}
              </div>
            )}
            {!stats.sourceFrame && noTf && (
              <div className="text-text-tertiary">no /tf — rendering in topic frame</div>
            )}
            {isCloud && (
              <div className="text-text-tertiary mt-0.5">
                shift+click sets orbit centre
              </div>
            )}
          </div>

          {showInitialSpinner && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-bg-primary/70">
              <svg
                className="w-6 h-6 text-accent-blue animate-spin-slow"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              <span className="text-text-secondary text-sm">Loading frame…</span>
            </div>
          )}
          {error && !cloud && !poseMessage && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg-primary/70 p-8 text-center">
              <div className="text-accent-rose text-sm font-medium">Failed to load frame</div>
              <div className="text-text-secondary text-xs max-w-md">{error}</div>
            </div>
          )}
        </div>

        <div className="px-4 py-1.5 border-t border-border flex items-center justify-between text-text-muted text-xs mono gap-3">
          <span>
            {sceneKind === 'pose'
              ? poseMessage
                ? '1 pose'
                : 'no data'
              : `${stats.points.toLocaleString()} pts`}
            {sceneKind === 'pointcloud' && stats.bounds && (
              <span className="text-text-tertiary ml-3">
                z {stats.bounds.min.z.toFixed(2)}…{stats.bounds.max.z.toFixed(2)} m
              </span>
            )}
            {sceneKind === 'pointcloud' && accumulating && accumStats.points > 0 && (
              <span className="text-accent-blue/80 ml-3">
                +{accumStats.points.toLocaleString()} accum
                <span className="text-text-tertiary">
                  {' '}
                  ({accumStats.frames} frames)
                </span>
              </span>
            )}
          </span>
          <span>
            {stats.timestamp !== null
              ? `t = ${nsToSeconds(stats.timestamp - startNs).toFixed(3)}s`
              : 'no message at playhead'}
          </span>
        </div>
      </div>
    </PanelShell>
  );
}

interface ControlsCardProps {
  sceneKind: SceneKind;
  colorMode: ColorMode;
  setColorMode: (m: ColorMode) => void;
  pointSize: number;
  setPointSize: (s: number) => void;
  showGrid: boolean;
  setShowGrid: (v: boolean) => void;
  showWorldAxes: boolean;
  setShowWorldAxes: (v: boolean) => void;
  graph: TFGraph | null;
  worldFrame: string | null;
  setWorldFrame: (f: string) => void;
  noTf: boolean;
  rangeLimitOn: boolean;
  setRangeLimitOn: (v: boolean) => void;
  maxRange: number;
  setMaxRange: (n: number) => void;
  accumulating: boolean;
  setAccumulating: (v: boolean) => void;
  accumBudget: number;
  setAccumBudget: (n: number) => void;
  accumPerFrame: number;
  setAccumPerFrame: (n: number) => void;
  onClearAccumulator: () => void;
  accumStats: { points: number; frames: number };
  upAxis: UpAxis;
  setUpAxis: (a: UpAxis) => void;
}

function ControlsCard({
  sceneKind,
  colorMode,
  setColorMode,
  pointSize,
  setPointSize,
  showGrid,
  setShowGrid,
  showWorldAxes,
  setShowWorldAxes,
  graph,
  worldFrame,
  setWorldFrame,
  noTf,
  rangeLimitOn,
  setRangeLimitOn,
  maxRange,
  setMaxRange,
  accumulating,
  setAccumulating,
  accumBudget,
  setAccumBudget,
  accumPerFrame,
  setAccumPerFrame,
  onClearAccumulator,
  accumStats,
  upAxis,
  setUpAxis,
}: ControlsCardProps) {
  const [open, setOpen] = useState(false);
  const allFrames = useMemo(() => (graph ? Array.from(graph.frames).sort() : []), [graph]);

  return (
    <div className="bg-bg-primary/85 backdrop-blur border border-border rounded-md text-xs mono shadow-panel">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-2.5 py-1.5 flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span>Display</span>
      </button>
      {open && (
        <div className="border-t border-border p-2.5 space-y-2 w-56">
          {sceneKind === 'pointcloud' && (
            <div>
              <div className="text-text-tertiary text-[10px] mb-1">color by</div>
              <div className="flex gap-1 flex-wrap">
                {(['height', 'intensity', 'single'] as ColorMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setColorMode(m)}
                    className={`px-2 py-0.5 rounded-md transition-colors ${
                      colorMode === m
                        ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/40'
                        : 'border border-border text-text-secondary hover:border-accent-blue/40'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <div className="flex items-center justify-between text-text-tertiary text-[10px] mb-1">
              <span>point size</span>
              <span className="text-text-secondary">{pointSize.toFixed(1)}px</span>
            </div>
            <input
              type="range"
              min={1}
              max={8}
              step={0.5}
              value={pointSize}
              onChange={(e) => setPointSize(Number(e.target.value))}
              className="w-full accent-accent-blue"
            />
          </div>
          {sceneKind === 'pointcloud' && (
            <div className="pt-1 border-t border-border/60">
              <label className="flex items-center justify-between text-text-secondary cursor-pointer mb-1">
                <span className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={rangeLimitOn}
                    onChange={(e) => setRangeLimitOn(e.target.checked)}
                    className="accent-accent-blue"
                  />
                  limit range
                </span>
                <span className="text-text-tertiary text-[10px]">
                  {rangeLimitOn ? `${maxRange.toFixed(0)} m` : 'off'}
                </span>
              </label>
              <input
                type="range"
                min={1}
                max={200}
                step={1}
                value={maxRange}
                disabled={!rangeLimitOn}
                onChange={(e) => setMaxRange(Number(e.target.value))}
                className="w-full accent-accent-blue disabled:opacity-40"
              />
            </div>
          )}
          {sceneKind === 'pointcloud' && (
            <div className="pt-1 border-t border-border/60 space-y-1.5">
              <label className="flex items-center justify-between text-text-secondary cursor-pointer">
                <span className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={accumulating}
                    onChange={(e) => setAccumulating(e.target.checked)}
                    className="accent-accent-blue"
                  />
                  accumulate
                </span>
                {accumulating && (
                  <button
                    onClick={onClearAccumulator}
                    className="text-text-tertiary hover:text-accent-rose text-[10px] underline decoration-dotted"
                    title="Clear accumulated points"
                  >
                    clear
                  </button>
                )}
              </label>
              <div>
                <div className="flex items-center justify-between text-text-tertiary text-[10px] mb-1">
                  <span>per-frame pts</span>
                  <span className="text-text-secondary">
                    {accumPerFrame >= 1000 ? `${(accumPerFrame / 1000).toFixed(0)}k` : accumPerFrame}
                  </span>
                </div>
                <input
                  type="range"
                  min={1000}
                  max={500_000}
                  step={5000}
                  value={accumPerFrame}
                  disabled={!accumulating}
                  onChange={(e) => setAccumPerFrame(Number(e.target.value))}
                  className="w-full accent-accent-blue disabled:opacity-40"
                />
              </div>
              <div>
                <div className="flex items-center justify-between text-text-tertiary text-[10px] mb-1">
                  <span>budget</span>
                  <span className="text-text-secondary">
                    {(accumBudget / 1_000_000).toFixed(1)}M pts
                  </span>
                </div>
                <input
                  type="range"
                  min={250_000}
                  max={10_000_000}
                  step={250_000}
                  value={accumBudget}
                  onChange={(e) => setAccumBudget(Number(e.target.value))}
                  className="w-full accent-accent-blue"
                />
              </div>
              {accumulating && (
                <div className="text-text-tertiary text-[10px] leading-tight">
                  {accumStats.points.toLocaleString()} / {accumBudget.toLocaleString()} pts
                  {accumStats.points >= accumBudget && (
                    <span className="text-accent-amber ml-1">(oldest dropping)</span>
                  )}
                </div>
              )}
              {accumulating && noTf && (
                <div className="text-accent-amber/80 text-[10px] leading-tight">
                  no /tf — frames will overlap in the sensor frame
                </div>
              )}
            </div>
          )}
          <div className="flex items-center justify-between pt-1 border-t border-border/60">
            <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
                className="accent-accent-blue"
              />
              grid
            </label>
            <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={showWorldAxes}
                onChange={(e) => setShowWorldAxes(e.target.checked)}
                className="accent-accent-blue"
              />
              axes
            </label>
          </div>
          <div className="pt-1 border-t border-border/60">
            <div className="text-text-tertiary text-[10px] mb-1">up axis</div>
            <select
              value={upAxis}
              onChange={(e) => setUpAxis(e.target.value as UpAxis)}
              className="w-full px-2 py-1 rounded-md bg-surface border border-border text-text-primary text-xs mono focus:outline-none focus:border-accent-blue/50"
              title="Rotates the cloud so the chosen source-frame axis points up in the rendered scene"
            >
              {UP_AXIS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          {!noTf && allFrames.length > 0 && (
            <div>
              <div className="text-text-tertiary text-[10px] mb-1">world frame</div>
              <select
                value={worldFrame ?? ''}
                onChange={(e) => setWorldFrame(e.target.value)}
                className="w-full px-2 py-1 rounded-md bg-surface border border-border text-text-primary text-xs mono focus:outline-none focus:border-accent-blue/50"
              >
                {allFrames.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function pickFrameId(value: Record<string, unknown> | null | undefined): string | undefined {
  if (!value) return undefined;
  const header = value.header as { frame_id?: unknown } | undefined;
  const fid = header?.frame_id;
  return typeof fid === 'string' && fid.length > 0 ? fid : undefined;
}

/**
 * Set the user-group's matrix to `postMul * TFChain(source → world)` at
 * `timeNs`. The cache stores the bare TF chain so the post-multiplier (the
 * panel's up-axis fix) can change cheaply without invalidating the chain
 * lookup.
 *
 * If `postMul` is omitted the result is just the TF chain — preserves the
 * pre-up-axis behaviour for callers that don't need it.
 */
function applyTransform(
  userGroup: THREE.Group,
  graph: TFGraph | null,
  sourceFrame: string | null,
  worldFrame: string | null,
  timeNs: bigint,
  cache: React.MutableRefObject<{ key: string; matrix: THREE.Matrix4 } | null>,
  postMul?: THREE.Matrix4,
): void {
  userGroup.matrixAutoUpdate = false;
  if (!graph || !sourceFrame || !worldFrame || sourceFrame === worldFrame) {
    if (postMul) userGroup.matrix.copy(postMul);
    else userGroup.matrix.identity();
    cache.current = null;
    return;
  }
  // Quantize timeNs to ~100 ms so consecutive playhead ticks within the same
  // /tf sample window reuse the same transform without re-walking the chain.
  const bucket = timeNs / 100_000_000n;
  const key = `${sourceFrame}>${worldFrame}@${bucket.toString()}`;
  if (cache.current && cache.current.key === key) {
    if (postMul) userGroup.matrix.multiplyMatrices(postMul, cache.current.matrix);
    else userGroup.matrix.copy(cache.current.matrix);
    return;
  }
  const m = composeTFChain(graph, sourceFrame, worldFrame, timeNs);
  if (m) {
    cache.current = { key, matrix: m };
    if (postMul) userGroup.matrix.multiplyMatrices(postMul, m);
    else userGroup.matrix.copy(m);
  } else {
    if (postMul) userGroup.matrix.copy(postMul);
    else userGroup.matrix.identity();
    cache.current = null;
  }
}
