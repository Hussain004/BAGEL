import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useBagStore, resolveBagEntry } from '../../../store/bagStore';
import { useBagLocalPlayhead } from '../../../hooks/useBagLocalPlayhead';
import {
  DEFAULT_THREE_D_SETTINGS,
  useThreeDPanelStore,
  type UpAxis,
} from '../../../store/threeDPanelStore';
import { PanelShell } from '../PanelShell';
import { getTopicColor } from '../../../utils/color';
import { nsToSeconds } from '../../../utils/time';
import {
  isCloudType,
  isLaserScanType,
  isMarkerArrayType,
  isMarkerType,
  isOccupancyGridType,
} from '../../../utils/messages';
import { useMessageAtTime } from '../../../hooks/useMessageAtTime';
import { useTopicMessages, type DecodedMessage } from '../../../hooks/useTopicMessages';
import { useTFGraph, type TFGraph } from '../TFTree/useTFGraph';
import type { ColorMode, HeightAxis } from '../../../utils/pointcloud';
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
import { CloudAccumulator, type AccumulationMode } from './accumulator';
import { extractMarkers } from './markerObjects';
import { MarkerSet } from './markerSet';
import {
  createMapPlane,
  disposeMapPlane,
  setMapPlaneOpacity,
  updateMapPlane,
  type MapPlaneObject,
} from './mapPlane';
import {
  decodeOccupancyGrid,
  type OccupancyGridMessage,
} from '../../../utils/occupancyGrid';

interface ThreeDSceneProps {
  panelId: string;
  topicName: string;
  type: string;
  /** Which bag the panel reads from (multi-bag). Defaults to focused bag. */
  bagId?: string;
}

type SceneKind = 'pointcloud' | 'laserscan' | 'pose' | 'markerarray' | 'occupancygrid';

/**
 * Hard cap on marker messages we decode for a panel. Real-world bags rarely
 * exceed a few thousand MarkerArray messages per topic; the cap exists so a
 * pathological bag (debug topic publishing at 100 Hz for an hour) doesn't
 * OOM the worker. Hitting it just means later-than-cutoff markers won't
 * appear when scrubbing past the limit.
 */
const MARKER_MESSAGE_LIMIT = 50_000;

/**
 * Which source-frame axis points up in the rendered scene. ROS standard is
 * "z+", but bags from Livox, drone NED frames, or camera-aligned LiDAR rigs
 * sometimes emit clouds with X-up, Y-up, or an inverted Z. The selector
 * applies a fixed rotation that maps the chosen axis onto render-space +Z,
 * which is the direction `camera.up` always points.
 *
 * The `UpAxis` type lives in the per-panel settings store; we import it
 * here so the panel and the persisted settings share one source of truth.
 */

const UP_AXIS_OPTIONS: { value: UpAxis; label: string }[] = [
  { value: 'z+', label: '+Z up (ROS default)' },
  { value: 'z-', label: '-Z up (flipped)' },
  { value: 'y+', label: '+Y up' },
  { value: 'y-', label: '-Y up' },
  { value: 'x+', label: '+X up' },
  { value: 'x-', label: '-X up' },
];

/**
 * Translate the panel's UpAxis (e.g. `z+`, `x-`) into the decoder's HeightAxis
 * ('+z', '-x'). The two enums use different conventions because the panel's
 * UI strings predate the colormap fix; rather than renaming everywhere this
 * adapter keeps the change local.
 */
function upAxisToHeightAxis(axis: UpAxis): HeightAxis {
  const sign = axis.endsWith('-') ? '-' : '+';
  const letter = axis[0]; // 'x' | 'y' | 'z'
  return `${sign}${letter}` as HeightAxis;
}

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
  // MarkerArray (and the rare single Marker) get their own path — the
  // primitives are heterogeneous and don't share the cloud/pose code at all.
  if (isMarkerArrayType(type) || isMarkerType(type)) return 'markerarray';
  // Both sensor_msgs/PointCloud2 and list-of-points clouds (Livox CustomMsg
  // etc.) take the 'pointcloud' branch — they share the same render
  // pipeline once the worker has produced Float32Array positions + colors.
  if (isCloudType(type)) return 'pointcloud';
  if (isLaserScanType(type)) return 'laserscan';
  // SLAM-produced maps render as a textured plane in the world frame.
  if (isOccupancyGridType(type)) return 'occupancygrid';
  return 'pose';
}

/**
 * Binary search the largest index `i` such that `messages[i].timestamp` is at
 * or before `targetNs`. Returns -1 when no such message exists (the playhead
 * is before the first marker). Used to find the cutoff for marker replay.
 */
function findCutoffIndex(messages: DecodedMessage[], targetNs: bigint): number {
  if (messages.length === 0) return -1;
  let lo = 0;
  let hi = messages.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (messages[mid].timestamp <= targetNs) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Pull the first marker's `header.frame_id` out of a MarkerArray message —
 * used only to auto-pick a default world frame. Returns undefined when the
 * message has no markers, or none of them carry a frame_id.
 */
function pickMarkerFrame(
  messages: DecodedMessage[] | null,
): string | undefined {
  if (!messages) return undefined;
  for (const msg of messages) {
    if (!msg.value) continue;
    const markers = extractMarkers(msg.value, msg.timestamp);
    for (const m of markers) {
      if (m.frameId) return m.frameId;
    }
  }
  return undefined;
}

/**
 * Compute a rough axis-aligned bounding box from every marker pose +
 * every per-point position across messages 0..cutoff. Returned in source
 * frame coordinates (TF chain is applied separately by the panel), so the
 * resulting box is "wherever the markers say they live" — good enough for
 * the once-per-panel auto-fit.
 *
 * Returns null when there are no positions to bound.
 */
function computeMarkerBounds(
  messages: DecodedMessage[],
  cutoff: number,
): {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
} | null {
  let hasPoint = false;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  const consume = (x: number, y: number, z: number): void => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    hasPoint = true;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  };
  for (let i = 0; i <= cutoff; i++) {
    const msg = messages[i];
    if (!msg?.value) continue;
    const markers = extractMarkers(msg.value, msg.timestamp);
    for (const m of markers) {
      consume(m.pose.position.x, m.pose.position.y, m.pose.position.z);
      for (const p of m.points) consume(p.x, p.y, p.z);
    }
  }
  if (!hasPoint) return null;
  // Ensure a non-degenerate box so the auto-fit's radius doesn't snap to 0.
  if (minX === maxX) {
    minX -= 0.5;
    maxX += 0.5;
  }
  if (minY === maxY) {
    minY -= 0.5;
    maxY += 0.5;
  }
  if (minZ === maxZ) {
    minZ -= 0.5;
    maxZ += 0.5;
  }
  return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
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
export function ThreeDScene({ panelId, topicName, type, bagId }: ThreeDSceneProps) {
  const bag = useBagStore((s) => resolveBagEntry(s, bagId))?.summary ?? null;
  const playheadNs = useBagLocalPlayhead(bagId);
  const sceneKind = useMemo(() => detectKind(type), [type]);

  // Persistent display settings live in a per-panelId zustand store rather
  // than local useState. `PanelGrid` puts a `key` on its <Group> that
  // includes every open panel id, so adding or closing any sibling panel
  // forces a remount of this panel — local useState would reset to defaults
  // every time. Lifting to the store also makes settings survive close +
  // reopen of the same 3D panel as a side benefit. `accumStats` stays as
  // local state because it's a derived view of the live accumulator object,
  // not a user preference.
  const settings = useThreeDPanelStore((s) => s.byId[panelId] ?? DEFAULT_THREE_D_SETTINGS);
  const updateSettings = useThreeDPanelStore((s) => s.update);
  const {
    colorMode,
    pointSize,
    showGrid,
    showWorldAxes,
    worldFrame,
    rangeLimitOn,
    maxRange,
    accumulating,
    accumMode,
    accumBudget,
    accumPerFrame,
    voxelSize,
    upAxis,
    pivot,
    hiddenMarkerNamespaces,
    mapAlpha,
  } = settings;

  const setColorMode = (v: ColorMode) => updateSettings(panelId, { colorMode: v });
  const setPointSize = (v: number) => updateSettings(panelId, { pointSize: v });
  const setShowGrid = (v: boolean) => updateSettings(panelId, { showGrid: v });
  const setShowWorldAxes = (v: boolean) => updateSettings(panelId, { showWorldAxes: v });
  const setWorldFrame = (v: string) => updateSettings(panelId, { worldFrame: v });
  const setRangeLimitOn = (v: boolean) => updateSettings(panelId, { rangeLimitOn: v });
  const setMaxRange = (v: number) => updateSettings(panelId, { maxRange: v });
  const setAccumulating = (v: boolean) => updateSettings(panelId, { accumulating: v });
  const setAccumMode = (v: AccumulationMode) => updateSettings(panelId, { accumMode: v });
  const setAccumBudget = (v: number) => updateSettings(panelId, { accumBudget: v });
  const setAccumPerFrame = (v: number) => updateSettings(panelId, { accumPerFrame: v });
  const setVoxelSize = (v: number) => updateSettings(panelId, { voxelSize: v });
  const setUpAxis = (v: UpAxis) => updateSettings(panelId, { upAxis: v });
  const setPivot = (v: { x: number; y: number; z: number } | null) =>
    updateSettings(panelId, { pivot: v });
  const toggleNamespaceHidden = (ns: string, hidden: boolean) => {
    const cur = new Set(hiddenMarkerNamespaces);
    if (hidden) cur.add(ns);
    else cur.delete(ns);
    updateSettings(panelId, { hiddenMarkerNamespaces: Array.from(cur).sort() });
  };
  const setMapAlpha = (v: number) => updateSettings(panelId, { mapAlpha: v });

  // Footer stats for the accumulator. Updated on every successful append;
  // derived from the THREE.js accumulator state which is recreated on every
  // panel mount, so this resetting to {0, 0} on remount is the correct
  // behaviour (the accumulator object itself is empty after the remount).
  const [accumStats, setAccumStats] = useState<{ points: number; frames: number }>({
    points: 0,
    frames: 0,
  });
  const upFixMatrix = useMemo(() => makeUpFix(upAxis), [upAxis]);
  // Height colormap follows the up-axis — picking "-X up" means the most
  // negative source X paints reddest (highest in render space).
  const heightAxis = useMemo(() => upAxisToHeightAxis(upAxis), [upAxis]);

  // Cloud topics use the worker-decoded fast path; pose / map topics stay on
  // the generic message-at-time hook because their messages are small enough
  // for main-thread CDR decode (and OccupancyGrid publishers tick at ≤ 1 Hz
  // so it doesn't matter even when the message hits a few MB).
  const isCloud = sceneKind === 'pointcloud' || sceneKind === 'laserscan';
  const isMarker = sceneKind === 'markerarray';
  const isMap = sceneKind === 'occupancygrid';
  const cloudState = useDecodedCloud({
    kind: sceneKind === 'pointcloud' ? 'pointcloud' : 'laserscan',
    topicName,
    timeNs: playheadNs,
    colorMode: sceneKind === 'pointcloud' ? colorMode : undefined,
    // LaserScan ignores maxRange in the decoder; only piping it through for
    // PointCloud2 keeps the hook's request key tight for scans.
    maxRange:
      sceneKind === 'pointcloud' && rangeLimitOn && maxRange > 0 ? maxRange : undefined,
    // LaserScan colours by range, so heightAxis is only meaningful for
    // PointCloud2 / CustomCloud — pass it conditionally to keep scans' cache
    // key minimal.
    heightAxis: sceneKind === 'pointcloud' ? heightAxis : undefined,
    bagId,
  });
  const poseState = useMessageAtTime(topicName, playheadNs, bagId);
  // Marker streams are unlike clouds and poses: every marker persists in the
  // scene until DELETE or lifetime expiry, so we need the full history up to
  // the playhead — not just the message at the playhead. The hook is gated
  // on `isMarker` so it does nothing on cloud / pose panels.
  const markerStream = useTopicMessages(topicName, MARKER_MESSAGE_LIMIT, isMarker, bagId);

  const cloud = isCloud ? cloudState.cloud : null;
  // Pose-axes panels and OccupancyGrid panels share the same single-message
  // hook (their messages are small enough). We keep them separate downstream
  // so the pose-only auto-fit / pose-axes update doesn't fire on a map.
  const poseMessage = !isCloud && !isMarker && !isMap ? poseState.message : null;
  const mapMessage = isMap ? poseState.message : null;
  const loading = isMarker
    ? markerStream.loading
    : isCloud
      ? cloudState.loading
      : poseState.loading;
  const error = isMarker
    ? markerStream.error
    : isCloud
      ? cloudState.error
      : poseState.error;

  const { graph, missing: noTf } = useTFGraph(bagId);
  const { containerRef, sceneRef } = useScene();

  // Auto-pick a world frame when the TF graph + first message arrive.
  useEffect(() => {
    if (worldFrame || !graph) return;
    const srcFrame =
      cloud?.frameId ??
      (poseMessage ? pickFrameId(poseMessage.value) : undefined) ??
      (mapMessage ? pickFrameId(mapMessage.value) : undefined) ??
      (isMarker ? pickMarkerFrame(markerStream.messages) : undefined);
    if (!srcFrame) return;
    const pick = pickWorldFrame(graph, srcFrame);
    if (pick) setWorldFrame(pick);
  }, [graph, cloud, poseMessage, mapMessage, worldFrame, isMarker, markerStream.messages]);

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
    /** Marker scene manager. MarkerArray panels only. */
    markerSet: MarkerSet | null;
    /** Textured plane for nav_msgs/OccupancyGrid. occupancygrid panels only. */
    mapPlane: MapPlaneObject | null;
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
      markerSet: null as MarkerSet | null,
      mapPlane: null as MapPlaneObject | null,
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
    } else if (sceneKind === 'markerarray') {
      // Markers handle their own per-frame TF inside the MarkerSet's frame
      // subgroups, so the panel's userGroup only ends up carrying the
      // up-axis fix (sourceFrame = null in applyTransform → matrix = upFix).
      owned.markerSet = new MarkerSet();
      refs.userGroup.add(owned.markerSet.root);
    } else if (sceneKind === 'occupancygrid') {
      owned.mapPlane = createMapPlane();
      setMapPlaneOpacity(owned.mapPlane, mapAlpha);
      refs.userGroup.add(owned.mapPlane.object);
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
      if (owned.markerSet) {
        refs.userGroup.remove(owned.markerSet.root);
        owned.markerSet.dispose();
      }
      if (owned.mapPlane) {
        refs.userGroup.remove(owned.mapPlane.object);
        disposeMapPlane(owned.mapPlane);
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

  // Mode + voxel-size changes clear the accumulator (the storage layout for
  // voxel mode differs from ring mode, and a new voxel size invalidates the
  // existing voxel index).
  useEffect(() => {
    const owned = objectsRef.current;
    const refs = sceneRef.current;
    if (!refs || !owned?.accumulator) return;
    owned.accumulator.setMode(accumMode);
    lastAppendedTsRef.current = null;
    setAccumStats({ points: 0, frames: 0 });
    refs.renderOnce();
  }, [accumMode, sceneRef]);

  useEffect(() => {
    const owned = objectsRef.current;
    const refs = sceneRef.current;
    if (!refs || !owned?.accumulator) return;
    owned.accumulator.setVoxelSize(voxelSize);
    lastAppendedTsRef.current = null;
    setAccumStats({ points: 0, frames: 0 });
    refs.renderOnce();
  }, [voxelSize, sceneRef]);

  // Clear the accumulator + custom pivot whenever the coordinate system the
  // panel renders into actually *changes* — world frame, topic, or up-axis.
  // Both the accumulator's stored points and the pivot are expressed in
  // render-space coordinates that get invalidated by any of these changes.
  //
  // We compare against the previous deps via a ref so we don't clear on the
  // initial mount (or on a remount, when settings are being restored from
  // the per-panel store). Without this, a remount triggered by adding a
  // sibling panel would silently null out the user's pivot.
  const prevCoordDepsRef = useRef({ worldFrame, topicName, upAxis });
  useEffect(() => {
    const refs = sceneRef.current;
    const owned = objectsRef.current;
    if (!refs) return;
    const prev = prevCoordDepsRef.current;
    const changed =
      prev.worldFrame !== worldFrame ||
      prev.topicName !== topicName ||
      prev.upAxis !== upAxis;
    if (!changed) return;
    prevCoordDepsRef.current = { worldFrame, topicName, upAxis };
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

  // OccupancyGrid map update. Texture is keyed by a content fingerprint so
  // playhead ticks that hit the same map message don't re-upload — typical
  // SLAM publishers tick at ≤ 1 Hz, so most ticks are no-ops here.
  useEffect(() => {
    const refs = sceneRef.current;
    const owned = objectsRef.current;
    if (!refs || !owned?.mapPlane || !mapMessage?.value) return;

    const decoded = decodeOccupancyGrid(mapMessage.value as OccupancyGridMessage);
    if (!decoded) return;

    const sourceFrame = pickFrameId(mapMessage.value) ?? null;
    applyTransform(
      refs.userGroup,
      graph,
      sourceFrame,
      worldFrame,
      mapMessage.timestamp,
      cachedTransformRef,
      upFixMatrix,
    );

    updateMapPlane(owned.mapPlane, decoded);
    if (owned.mapPlane.bounds) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStats({
        points: decoded.width * decoded.height,
        bounds: owned.mapPlane.bounds,
        sourceFrame,
        timestamp: mapMessage.timestamp,
      });
    }
    refs.renderOnce();
  }, [mapMessage, graph, worldFrame, sceneRef, upFixMatrix]);

  // Map alpha slider → material opacity. Cheap; no texture rebuild.
  useEffect(() => {
    const owned = objectsRef.current;
    const refs = sceneRef.current;
    if (!refs || !owned?.mapPlane) return;
    setMapPlaneOpacity(owned.mapPlane, mapAlpha);
    refs.renderOnce();
  }, [mapAlpha, sceneRef]);

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

  // ── Marker ingest + refresh ────────────────────────────────────────────
  //
  // Markers persist in the scene until DELETE or lifetime expiry, so we have
  // to keep state synchronised with the messages stream. The watermark refs
  // track how far we've ingested:
  //
  //   - `lastIngestedIndexRef`: index into `markerStream.messages` we last
  //      processed. Lets a forward scrub append new ADDs without re-running
  //      the whole history.
  //   - `lastPlayheadRef`: previous playhead time, to detect backward scrub.
  //      On scrub-back we wipe the MarkerSet and replay from message 0 up
  //      to the new cutoff — replaying selected ranges is messier than it
  //      sounds because a DELETE at index 50 only "undoes" an ADD at index
  //      40 if we still know about it, which we wouldn't after partial
  //      replay.
  //
  // The discovered namespaces list is mirrored to React state so the
  // controls card can render the filter checklist. Live marker count goes
  // into a separate state so the footer can show it.
  const lastIngestedIndexRef = useRef(-1);
  const lastPlayheadRef = useRef<bigint>(0n);
  const [markerNamespaces, setMarkerNamespaces] = useState<string[]>([]);
  const [markerCount, setMarkerCount] = useState(0);

  // Clear the watermark when the topic / panel mounts — re-ingest happens
  // automatically on the first messages effect tick. Setting React state in
  // here is intentional: the watermark refs are the source of truth for the
  // ingest loop, and the React state mirrors the MarkerSet's emitted view
  // so the controls card / footer render in sync. Without this reset, a
  // close+reopen of the same panel id would show stale namespace chips
  // until the first new message arrived.
  useEffect(() => {
    if (!isMarker) return;
    lastIngestedIndexRef.current = -1;
    lastPlayheadRef.current = 0n;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMarkerNamespaces([]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMarkerCount(0);
  }, [isMarker, topicName]);

  useEffect(() => {
    if (!isMarker) return;
    const refs = sceneRef.current;
    const owned = objectsRef.current;
    const markerSet = owned?.markerSet;
    const messages = markerStream.messages;
    if (!refs || !markerSet || !messages) return;

    const targetIndex = findCutoffIndex(messages, playheadNs);
    const scrubBack = playheadNs < lastPlayheadRef.current;

    if (scrubBack) {
      markerSet.clear();
      lastIngestedIndexRef.current = -1;
    }

    for (let i = lastIngestedIndexRef.current + 1; i <= targetIndex; i++) {
      const msg = messages[i];
      if (!msg.value) continue;
      const markers = extractMarkers(msg.value, msg.timestamp);
      for (const m of markers) {
        markerSet.applyMarker(m);
      }
    }
    lastIngestedIndexRef.current = targetIndex;
    lastPlayheadRef.current = playheadNs;

    // userGroup.matrix carries just the up-fix for marker panels; the per-
    // frame TF chains live inside the MarkerSet's frame subgroups.
    applyTransform(
      refs.userGroup,
      graph,
      null,
      worldFrame,
      playheadNs,
      cachedTransformRef,
      upFixMatrix,
    );

    markerSet.refresh(playheadNs, graph, worldFrame);

    // Surface the namespace list + live count to React only when they
    // actually changed, so paused playback doesn't churn the controls card.
    const nextNamespaces = markerSet.namespaces();
    setMarkerNamespaces((prev) => {
      if (prev.length === nextNamespaces.length && prev.every((n, i) => n === nextNamespaces[i])) {
        return prev;
      }
      return nextNamespaces;
    });
    const liveCount = markerSet.size();
    setMarkerCount((prev) => (prev === liveCount ? prev : liveCount));

    // Bounds for autofit: derive a generous box from the first message's
    // markers' positions, so the camera at least frames the scene.
    if (!stats.bounds && targetIndex >= 0) {
      const bounds = computeMarkerBounds(messages, targetIndex);
      if (bounds) {
        setStats({
          points: liveCount,
          bounds,
          sourceFrame: pickMarkerFrame(messages) ?? null,
          timestamp: messages[targetIndex].timestamp,
        });
      }
    } else if (stats.timestamp !== (targetIndex >= 0 ? messages[targetIndex].timestamp : null)) {
      // Footer "points" + timestamp updates without re-computing bounds.
      setStats((s) => ({
        ...s,
        points: liveCount,
        timestamp: targetIndex >= 0 ? messages[targetIndex].timestamp : null,
      }));
    }
    refs.renderOnce();
  }, [
    isMarker,
    markerStream.messages,
    playheadNs,
    graph,
    worldFrame,
    upFixMatrix,
    sceneRef,
    stats.bounds,
    stats.timestamp,
  ]);

  // Sync hidden-namespace setting → MarkerSet visibility.
  useEffect(() => {
    if (!isMarker) return;
    const owned = objectsRef.current;
    const refs = sceneRef.current;
    if (!refs || !owned?.markerSet) return;
    const hidden = new Set(hiddenMarkerNamespaces);
    for (const ns of markerNamespaces) {
      owned.markerSet.setNamespaceVisible(ns, !hidden.has(ns));
    }
    refs.renderOnce();
  }, [isMarker, hiddenMarkerNamespaces, markerNamespaces, sceneRef]);

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

  const showInitialSpinner =
    loading &&
    !cloud &&
    !poseMessage &&
    !mapMessage &&
    !(isMarker && markerStream.messages && markerStream.messages.length > 0);

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
              accumMode={accumMode}
              setAccumMode={setAccumMode}
              accumBudget={accumBudget}
              setAccumBudget={setAccumBudget}
              accumPerFrame={accumPerFrame}
              setAccumPerFrame={setAccumPerFrame}
              voxelSize={voxelSize}
              setVoxelSize={setVoxelSize}
              onClearAccumulator={handleClearAccumulator}
              accumStats={accumStats}
              upAxis={upAxis}
              setUpAxis={setUpAxis}
              markerNamespaces={markerNamespaces}
              hiddenMarkerNamespaces={hiddenMarkerNamespaces}
              onToggleNamespace={toggleNamespaceHidden}
              mapAlpha={mapAlpha}
              setMapAlpha={setMapAlpha}
            />
          </div>

          <div className="absolute top-2 left-2 text-text-muted text-[10px] mono leading-tight bg-bg-primary/60 backdrop-blur px-2 py-1 rounded-md border border-border max-w-[60%]">
            <div className="text-text-secondary">
              {sceneKind === 'pointcloud'
                ? 'PointCloud2'
                : sceneKind === 'laserscan'
                  ? 'LaserScan'
                  : sceneKind === 'markerarray'
                    ? 'MarkerArray'
                    : sceneKind === 'occupancygrid'
                      ? 'OccupancyGrid'
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
          {error && !cloud && !poseMessage && !mapMessage && !(isMarker && markerCount > 0) && (
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
              : sceneKind === 'markerarray'
                ? `${markerCount.toLocaleString()} markers`
                : sceneKind === 'occupancygrid'
                  ? mapMessage
                    ? `${stats.points.toLocaleString()} cells`
                    : 'no map at playhead'
                  : `${stats.points.toLocaleString()} pts`}
            {sceneKind === 'markerarray' && markerNamespaces.length > 0 && (
              <span className="text-text-tertiary ml-3">
                {markerNamespaces.length} ns
                {hiddenMarkerNamespaces.length > 0 && (
                  <span className="text-accent-amber/80">
                    {' '}
                    ({hiddenMarkerNamespaces.length} hidden)
                  </span>
                )}
              </span>
            )}
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
  accumMode: AccumulationMode;
  setAccumMode: (m: AccumulationMode) => void;
  accumBudget: number;
  setAccumBudget: (n: number) => void;
  accumPerFrame: number;
  setAccumPerFrame: (n: number) => void;
  voxelSize: number;
  setVoxelSize: (n: number) => void;
  onClearAccumulator: () => void;
  accumStats: { points: number; frames: number };
  upAxis: UpAxis;
  setUpAxis: (a: UpAxis) => void;
  /** Every namespace the marker stream has ever published — sorted. */
  markerNamespaces: string[];
  /** Namespaces the user has hidden from the marker filter. */
  hiddenMarkerNamespaces: string[];
  onToggleNamespace: (ns: string, hidden: boolean) => void;
  /** Global alpha multiplier for OccupancyGrid panels (0…1). */
  mapAlpha: number;
  setMapAlpha: (a: number) => void;
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
  accumMode,
  setAccumMode,
  accumBudget,
  setAccumBudget,
  accumPerFrame,
  setAccumPerFrame,
  voxelSize,
  setVoxelSize,
  onClearAccumulator,
  accumStats,
  upAxis,
  setUpAxis,
  markerNamespaces,
  hiddenMarkerNamespaces,
  onToggleNamespace,
  mapAlpha,
  setMapAlpha,
}: ControlsCardProps) {
  const [open, setOpen] = useState(false);
  const allFrames = useMemo(() => (graph ? Array.from(graph.frames).sort() : []), [graph]);
  const hiddenSet = useMemo(
    () => new Set(hiddenMarkerNamespaces),
    [hiddenMarkerNamespaces],
  );

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
          {sceneKind !== 'occupancygrid' && (
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
          )}
          {sceneKind === 'occupancygrid' && (
            <div>
              <div className="flex items-center justify-between text-text-tertiary text-[10px] mb-1">
                <span>map alpha</span>
                <span className="text-text-secondary">{Math.round(mapAlpha * 100)}%</span>
              </div>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={mapAlpha}
                onChange={(e) => setMapAlpha(Number(e.target.value))}
                className="w-full accent-accent-blue"
                title="Global fade on top of the per-cell unknown/free/occupied ramp"
              />
            </div>
          )}
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
              {/* Mode toggle — ring keeps the last N points, voxel deduplicates
                  by grid cell for a true downsampled map. */}
              <div className="flex gap-1">
                {(['ring', 'voxel'] as AccumulationMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setAccumMode(m)}
                    disabled={!accumulating}
                    title={
                      m === 'ring'
                        ? 'FIFO ring buffer — most recent N points'
                        : 'Voxel grid downsample — one point per cell'
                    }
                    className={`flex-1 px-2 py-0.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                      accumMode === m
                        ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/40'
                        : 'border border-border text-text-secondary hover:border-accent-blue/40'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              {accumMode === 'voxel' && (
                <div>
                  <div className="flex items-center justify-between text-text-tertiary text-[10px] mb-1">
                    <span>voxel size</span>
                    <span className="text-text-secondary">
                      {voxelSize < 1 ? `${(voxelSize * 100).toFixed(0)} cm` : `${voxelSize.toFixed(2)} m`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0.05}
                    max={2.0}
                    step={0.05}
                    value={voxelSize}
                    disabled={!accumulating}
                    onChange={(e) => setVoxelSize(Number(e.target.value))}
                    className="w-full accent-accent-blue disabled:opacity-40"
                  />
                </div>
              )}
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
                    <span className="text-accent-amber ml-1">
                      ({accumMode === 'voxel' ? 'oldest cells dropping' : 'oldest dropping'})
                    </span>
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
          {sceneKind === 'markerarray' && markerNamespaces.length > 0 && (
            <div className="pt-1 border-t border-border/60">
              <div className="flex items-center justify-between text-text-tertiary text-[10px] mb-1">
                <span>namespaces ({markerNamespaces.length})</span>
                {hiddenSet.size > 0 && (
                  <button
                    onClick={() => {
                      // "Show all" — flip every hidden ns visible.
                      for (const ns of hiddenSet) onToggleNamespace(ns, false);
                    }}
                    className="text-text-tertiary hover:text-accent-blue underline decoration-dotted"
                    title="Show every namespace again"
                  >
                    show all
                  </button>
                )}
              </div>
              <div className="max-h-32 overflow-y-auto space-y-0.5 pr-1">
                {markerNamespaces.map((ns) => {
                  const hidden = hiddenSet.has(ns);
                  // Empty-string namespace shown as `<default>` so the row
                  // doesn't render as an unclickable blank.
                  const label = ns || '<default>';
                  return (
                    <label
                      key={ns}
                      className={`flex items-center gap-1.5 cursor-pointer ${
                        hidden ? 'text-text-tertiary' : 'text-text-secondary'
                      }`}
                      title={ns || 'unnamed namespace'}
                    >
                      <input
                        type="checkbox"
                        checked={!hidden}
                        onChange={(e) => onToggleNamespace(ns, !e.target.checked)}
                        className="accent-accent-blue flex-shrink-0"
                      />
                      <span className="truncate">{label}</span>
                    </label>
                  );
                })}
              </div>
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
