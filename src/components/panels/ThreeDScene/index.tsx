import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useBagStore } from '../../../store/bagStore';
import { usePlayheadStore } from '../../../store/playheadStore';
import { PanelShell } from '../PanelShell';
import { getTopicColor } from '../../../utils/color';
import { nsToSeconds } from '../../../utils/time';
import {
  isLaserScanType,
  isPointCloud2Type,
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
  updateLaserScan,
  updatePointCloud,
  updatePoseAxes,
  type LaserScanMessage,
  type LaserScanObject,
  type PointCloudObject,
  type PoseAxesObject,
} from './sceneObjects';
import {
  composeTFChain,
  pickWorldFrame,
} from './tfTransform';

interface ThreeDSceneProps {
  panelId: string;
  topicName: string;
  type: string;
}

type SceneKind = 'pointcloud' | 'laserscan' | 'pose';

function detectKind(type: string): SceneKind {
  if (isPointCloud2Type(type)) return 'pointcloud';
  if (isLaserScanType(type)) return 'laserscan';
  return 'pose';
}

/**
 * ThreeDScene — Three.js-powered 3D viewer for spatial ROS2 topics.
 *
 * Supported message kinds:
 *   - sensor_msgs/PointCloud2 → coloured point cloud (height / intensity / single)
 *   - sensor_msgs/LaserScan   → polar ring lifted into XY at z=0
 *   - nav_msgs/Odometry, geometry_msgs/Pose*, geometry_msgs/TransformStamped
 *                              → coordinate-frame axes + heading arrow
 *
 * All renderings are transformed into a chosen *world frame* using the
 * /tf graph from v0.3 when available. The world frame defaults to "map" or
 * "odom" if those exist, otherwise the topmost root of the TF tree.
 */
export function ThreeDScene({ panelId, topicName, type }: ThreeDSceneProps) {
  const bag = useBagStore((s) => s.bag);
  const playheadNs = usePlayheadStore((s) => s.timeNs);
  const sceneKind = useMemo(() => detectKind(type), [type]);

  const { message, loading, error } = useMessageAtTime(topicName, playheadNs);
  const { graph, missing: noTf } = useTFGraph();

  const { containerRef, sceneRef } = useScene();

  // UI state.
  const [colorMode, setColorMode] = useState<ColorMode>('height');
  const [pointSize, setPointSize] = useState(2.5);
  const [showGrid, setShowGrid] = useState(true);
  const [showWorldAxes, setShowWorldAxes] = useState(true);
  const [worldFrame, setWorldFrame] = useState<string | null>(null);
  // Auto-pick a world frame when the TF graph arrives. The user can override
  // it via the dropdown afterward.
  useEffect(() => {
    if (worldFrame || !graph || !message?.value) return;
    const srcFrame = pickFrameId(message.value);
    const pick = pickWorldFrame(graph, srcFrame);
    if (pick) setWorldFrame(pick);
  }, [graph, message, worldFrame]);

  // Owned scene objects. Re-built when the panel kind changes (it shouldn't,
  // because topic+type is fixed for the panel lifetime, but be defensive).
  const objectsRef = useRef<{
    pointCloud: PointCloudObject | null;
    laserScan: LaserScanObject | null;
    poseAxes: PoseAxesObject | null;
    grid: THREE.GridHelper | null;
    worldAxes: THREE.AxesHelper | null;
  } | null>(null);

  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    const owned = {
      pointCloud: null as PointCloudObject | null,
      laserScan: null as LaserScanObject | null,
      poseAxes: null as PoseAxesObject | null,
      grid: null as THREE.GridHelper | null,
      worldAxes: null as THREE.AxesHelper | null,
    };

    if (sceneKind === 'pointcloud') {
      owned.pointCloud = createPointCloud(pointSize);
      refs.userGroup.add(owned.pointCloud.object);
    } else if (sceneKind === 'laserscan') {
      owned.laserScan = createLaserScan(pointSize + 1);
      refs.userGroup.add(owned.laserScan.object);
    } else {
      owned.poseAxes = createPoseAxes(1.0);
      refs.userGroup.add(owned.poseAxes.object);
    }

    owned.grid = createGroundGrid(40, 40);
    refs.worldGroup.add(owned.grid);
    owned.worldAxes = createWorldAxes(1.0);
    refs.worldGroup.add(owned.worldAxes);

    objectsRef.current = owned;
    refs.renderOnce();

    return () => {
      if (owned.pointCloud) {
        refs.userGroup.remove(owned.pointCloud.object);
        disposeObject(owned.pointCloud.object);
      }
      if (owned.laserScan) {
        refs.userGroup.remove(owned.laserScan.object);
        disposeObject(owned.laserScan.object);
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
      objectsRef.current = null;
    };
    // sceneRef is a stable ref; bind to sceneKind so a hypothetical kind
    // change rebuilds the objects.
  }, [sceneKind, sceneRef, pointSize]);

  // Toggle grid / axes visibility without rebuilding.
  useEffect(() => {
    const refs = sceneRef.current;
    const owned = objectsRef.current;
    if (!refs || !owned) return;
    if (owned.grid) owned.grid.visible = showGrid;
    if (owned.worldAxes) owned.worldAxes.visible = showWorldAxes;
    refs.renderOnce();
  }, [showGrid, showWorldAxes, sceneRef]);

  // Apply point size live to PointsMaterial.
  useEffect(() => {
    const owned = objectsRef.current;
    const refs = sceneRef.current;
    if (!refs || !owned) return;
    if (owned.pointCloud) owned.pointCloud.material.size = pointSize;
    if (owned.laserScan) owned.laserScan.material.size = pointSize + 1;
    refs.renderOnce();
  }, [pointSize, sceneRef]);

  // Stats surfaced to the footer.
  const [stats, setStats] = useState<{
    points: number;
    bounds: { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } } | null;
    sourceFrame: string | null;
  }>({ points: 0, bounds: null, sourceFrame: null });

  // Update scene objects whenever we have a new message or the TF frame /
  // color mode changes.
  useEffect(() => {
    const refs = sceneRef.current;
    const owned = objectsRef.current;
    if (!refs || !owned || !message?.value) return;

    const value = message.value as Record<string, unknown>;
    const sourceFrame = pickFrameId(value) ?? null;

    // Compute the source→world transform if we have a TF graph + chosen
    // world frame. When the graph is missing or doesn't contain either
    // frame, render in-place (frame == world).
    const transform = computeWorldTransform(graph, sourceFrame, worldFrame, message.timestamp);
    refs.userGroup.matrixAutoUpdate = false;
    refs.userGroup.matrix.copy(transform);

    if (owned.pointCloud) {
      const ok = updatePointCloud(owned.pointCloud, value, colorMode);
      if (ok) {
        setStats({ points: owned.pointCloud.pointCount, bounds: owned.pointCloud.bounds, sourceFrame });
      }
    } else if (owned.laserScan) {
      const ok = updateLaserScan(owned.laserScan, value as LaserScanMessage);
      if (ok) {
        setStats({ points: owned.laserScan.pointCount, bounds: owned.laserScan.bounds, sourceFrame });
      }
    } else if (owned.poseAxes) {
      const pose = extractPose(message.value, type);
      if (pose) {
        updatePoseAxes(owned.poseAxes, pose);
        setStats({
          points: 1,
          bounds: {
            min: { x: pose.position.x - 1, y: pose.position.y - 1, z: pose.position.z - 1 },
            max: { x: pose.position.x + 1, y: pose.position.y + 1, z: pose.position.z + 1 },
          },
          sourceFrame,
        });
      }
    }

    refs.renderOnce();
  }, [message, colorMode, graph, worldFrame, type, sceneRef]);

  // Camera auto-fit: the first time we get bounds for this scene, snap the
  // camera to a reasonable distance. Subsequent updates leave the user's view
  // alone (so playback doesn't yank the camera around).
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
    // Bounds are in source frame; if a TF transform is in play, push them
    // through the userGroup matrix so the camera lands near the visible data.
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
  };

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

          {/* Controls overlay (top-right) */}
          <div className="absolute top-2 right-2 flex flex-col gap-1.5 items-end">
            <div className="flex gap-1">
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
            />
          </div>

          {/* Status overlay (top-left) */}
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
          </div>

          {/* Loading / error overlays */}
          {loading && !message && (
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
          {error && !message && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-bg-primary/70 p-8 text-center">
              <div className="text-accent-rose text-sm font-medium">Failed to load frame</div>
              <div className="text-text-secondary text-xs max-w-md">{error}</div>
            </div>
          )}
        </div>

        <div className="px-4 py-1.5 border-t border-border flex items-center justify-between text-text-muted text-xs mono gap-3">
          <span>
            {sceneKind === 'pose'
              ? message
                ? '1 pose'
                : 'no data'
              : `${stats.points.toLocaleString()} pts`}
            {sceneKind === 'pointcloud' && stats.bounds && (
              <span className="text-text-tertiary ml-3">
                z {stats.bounds.min.z.toFixed(2)}…{stats.bounds.max.z.toFixed(2)} m
              </span>
            )}
          </span>
          <span>
            {message
              ? `t = ${nsToSeconds(message.timestamp - startNs).toFixed(3)}s`
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
          <div className="flex items-center justify-between">
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

function computeWorldTransform(
  graph: TFGraph | null,
  sourceFrame: string | null,
  worldFrame: string | null,
  timeNs: bigint,
): THREE.Matrix4 {
  const identity = new THREE.Matrix4();
  if (!graph || !sourceFrame || !worldFrame || sourceFrame === worldFrame) {
    return identity;
  }
  const m = composeTFChain(graph, sourceFrame, worldFrame, timeNs);
  return m ?? identity;
}
