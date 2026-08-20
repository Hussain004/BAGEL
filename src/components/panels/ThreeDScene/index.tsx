import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { useBagStore, resolveBagEntry } from '../../../store/bagStore';
import { useBagLocalPlayhead } from '../../../hooks/useBagLocalPlayhead';
import { useEscapeToClose } from '../../../hooks/useEscapeToClose';
import { OverlayCard } from '../shared/OverlayCard';
import { PanelErrorState } from '../shared/PanelStates';
import {
  useThreeDPanelStore,
  type MapColorSchemeChoice,
  type ProjectionMode,
  type SpatialOverlayStyle,
  type UpAxis,
} from '../../../store/threeDPanelStore';
import {
  resolveDefaults,
  usePanelDefaultsStore,
} from '../../../store/panelDefaultsStore';
import {
  detectKind,
  SCENE_KIND_LABELS,
  type SceneKind,
} from './sceneKind';
import { useRobotModelStore } from '../../../store/robotModelStore';
import { useJointStates } from '../../../hooks/useJointStates';
import { buildRobotSubtree, type RobotSubtree } from './robotModel';
import { PanelShell } from '../PanelShell';
import { getTopicColor } from '../../../utils/color';
import { nsToSeconds } from '../../../utils/time';
import { isCameraInfoType } from '../../../utils/messages';
import {
  parseCameraInfo,
  type CameraIntrinsics,
} from '../../../hooks/useCameraInfo';
import {
  createCameraFrustum,
  type CameraFrustumObject,
} from './cameraFrustum';
import { useMessageAtTime } from '../../../hooks/useMessageAtTime';
import { useTopicMessages, type DecodedMessage } from '../../../hooks/useTopicMessages';
import { useTFGraph, type TFGraph } from '../TFTree/useTFGraph';
import type { AxisClip, ColorMode, HeightAxis } from '../../../utils/pointcloud';
import { useScene } from './useScene';
import {
  createGroundGrid,
  createLaserScan,
  createPointCloud,
  createPoseAxes,
  createWorldAxes,
  disposeObject,
  extractPose,
  setCloudStyle,
  updateCloud,
  updatePoseAxes,
  type CloudObject,
  type PoseAxesObject,
} from './sceneObjects';
import { applyTransform, pickWorldFrame } from './tfTransform';
import { useDecodedCloud } from './useDecodedPointCloud';
import { SpatialOverlay } from './spatialOverlay';
import {
  getSpatialOverlayCandidates,
  overlayKey,
  type SpatialOverlayTopic,
} from './spatialOverlayTopics';
import { CloudAccumulator, type AccumulationMode } from './accumulator';
import { extractMarkers } from './markerObjects';
import { MarkerSet } from './markerSet';
import {
  createMapPlane,
  disposeMapPlane,
  setMapPlaneOpacity,
  updateMapPlane,
  MAP_PLANE_RENDER_ORDER,
  type MapPlaneObject,
} from './mapPlane';
import {
  classifyMapPlaneTier,
  decodeOccupancyGrid,
  resolveOccupancyGridScheme,
  type OccupancyGridMessage,
} from '../../../utils/occupancyGrid';
import { registerCapture } from '../../../utils/captureRegistry';
import { RobotMarker } from './robotMarker';

interface ThreeDSceneProps {
  panelId: string;
  topicName: string;
  type: string;
  /** Which bag the panel reads from (multi-bag). Defaults to focused bag. */
  bagId?: string;
}

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
  const bagEntry = useBagStore((s) => resolveBagEntry(s, bagId));
  const bag = bagEntry?.summary ?? null;
  const resolvedBagId = bagEntry?.id ?? null;
  // Every loaded bag's topics, for the cross-bag spatial-overlay picker
  // (multi-robot bags overlaid on one map), not just this panel's own bag.
  const allBags = useBagStore((s) => s.bags);
  const bagOrder = useBagStore((s) => s.bagOrder);
  const overlayBags = useMemo(
    () =>
      bagOrder.map((id) => ({
        bagId: id,
        topics: allBags.get(id)?.summary.topics ?? [],
      })),
    [bagOrder, allBags],
  );
  // Color + label per bag, so the overlay picker can show which robot/bag a
  // cross-bag candidate comes from (only meaningful once >1 bag is loaded).
  const overlayBagMeta = useMemo(() => {
    const map = new Map<string, { color: string; label: string }>();
    for (const id of bagOrder) {
      const entry = allBags.get(id);
      if (entry) map.set(id, { color: entry.color, label: entry.summary.fileName });
    }
    return map;
  }, [bagOrder, allBags]);
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
  //
  // v1.3.3: a *user-saved* default per scene kind sits between the per-panel
  // entry and the hard-coded fallback. On first mount of a panelId, the
  // resolved kind default is materialised into the panel's store entry so
  // every subsequent `update` keeps the same baseline.
  const userDefaultsByKind = usePanelDefaultsStore((s) => s.byKind);
  const setUserDefault = usePanelDefaultsStore((s) => s.setDefault);
  const clearUserDefault = usePanelDefaultsStore((s) => s.clearDefault);
  const hasUserDefault = !!userDefaultsByKind[sceneKind];
  const effectiveDefaults = useMemo(
    () => resolveDefaults(sceneKind, userDefaultsByKind),
    [sceneKind, userDefaultsByKind],
  );
  const settings = useThreeDPanelStore(
    (s) => s.byId[panelId] ?? effectiveDefaults,
  );
  const updateSettings = useThreeDPanelStore((s) => s.update);
  const setAllSettings = useThreeDPanelStore((s) => s.setAll);

  // Seed the per-panel store entry from the resolved kind defaults the first
  // time this panel is rendered. Without this seeding the user's saved
  // default would only "stick" once they touched any setting (because the
  // current `update` baseline is the hard-coded fallback). The effect checks the store before writing, so it remains idempotent across
  // React 18 double-mount.
  useEffect(() => {
    const hasSettings = useThreeDPanelStore.getState().byId[panelId] !== undefined;
    if (!hasSettings && hasUserDefault) {
      setAllSettings(panelId, effectiveDefaults);
    }
  }, [effectiveDefaults, hasUserDefault, panelId, setAllSettings]);

  // ─── Robot model (v1.3.0) ──────────────────────────────────────────────
  // Each panel grows its own `RobotSubtree` instance because Three.js scene
  // graph nodes can't be parented to two scenes at once. The store is the
  // source of truth for the URDF; per-panel hide flags live there too.
  const robotModel = useRobotModelStore((s) => s.loaded);
  const robotHidden = useRobotModelStore((s) => !!s.hiddenInPanel[panelId]);
  const setRobotHidden = useRobotModelStore((s) => s.setHiddenInPanel);
  const jointStates = useJointStates(bagId, playheadNs);
  const {
    colorMode,
    pointSize,
    laserScanColor,
    showGrid,
    showWorldAxes,
    projectionMode,
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
    mapColorScheme,
    showRobotMarkers,
    cameraFrustumsOn,
    cameraFrustumFar,
    hiddenFrustumTopics,
    spatialOverlayTopics,
    spatialOverlayStyles,
    clipBoxOn,
    clipXMin,
    clipXMax,
    clipYMin,
    clipYMax,
    clipZMin,
    clipZMax,
    sectionCoordFrameOpen,
    sectionRangeClipOpen,
    sectionAccumulationOpen,
    sectionOverlaysOpen,
  } = settings;

  const spatialOverlayCandidates = useMemo(
    () => getSpatialOverlayCandidates(overlayBags, resolvedBagId ?? '', topicName),
    [overlayBags, resolvedBagId, topicName],
  );
  const selectedSpatialOverlays = useMemo(
    () =>
      spatialOverlayCandidates.filter((candidate) =>
        spatialOverlayTopics.includes(overlayKey(candidate.bagId, candidate.name)),
      ),
    [spatialOverlayCandidates, spatialOverlayTopics],
  );
  const hasPointCloudLayer =
    sceneKind === 'pointcloud' ||
    selectedSpatialOverlays.some((candidate) => detectKind(candidate.type) === 'pointcloud');
  const hasPointLayer =
    hasPointCloudLayer ||
    sceneKind === 'laserscan' ||
    selectedSpatialOverlays.some((candidate) => detectKind(candidate.type) === 'laserscan');
  const hasMapLayer =
    sceneKind === 'occupancygrid' ||
    selectedSpatialOverlays.some((candidate) => detectKind(candidate.type) === 'occupancygrid');

  const setColorMode = (v: ColorMode) => updateSettings(panelId, { colorMode: v });
  const setPointSize = (v: number) => updateSettings(panelId, { pointSize: v });
  const setLaserScanColor = (v: string | null) =>
    updateSettings(panelId, { laserScanColor: v });
  const setShowGrid = (v: boolean) => updateSettings(panelId, { showGrid: v });
  const setShowWorldAxes = (v: boolean) => updateSettings(panelId, { showWorldAxes: v });
  const setProjectionMode = (v: ProjectionMode) =>
    updateSettings(panelId, { projectionMode: v });
  // useCallback (unlike the sibling setters above) because these two are
  // read from useEffect dependency arrays further down, which need a
  // stable identity to avoid re-running on every render.
  const setWorldFrame = useCallback(
    (v: string) => updateSettings(panelId, { worldFrame: v }),
    [panelId, updateSettings],
  );
  const setRangeLimitOn = (v: boolean) => updateSettings(panelId, { rangeLimitOn: v });
  const setMaxRange = (v: number) => updateSettings(panelId, { maxRange: v });
  const setAccumulating = (v: boolean) => updateSettings(panelId, { accumulating: v });
  const setAccumMode = (v: AccumulationMode) => updateSettings(panelId, { accumMode: v });
  const setAccumBudget = (v: number) => updateSettings(panelId, { accumBudget: v });
  const setAccumPerFrame = (v: number) => updateSettings(panelId, { accumPerFrame: v });
  const setVoxelSize = (v: number) => updateSettings(panelId, { voxelSize: v });
  const setUpAxis = (v: UpAxis) => updateSettings(panelId, { upAxis: v });
  const setPivot = useCallback(
    (v: { x: number; y: number; z: number } | null) =>
      updateSettings(panelId, { pivot: v }),
    [panelId, updateSettings],
  );
  const toggleNamespaceHidden = (ns: string, hidden: boolean) => {
    const cur = new Set(hiddenMarkerNamespaces);
    if (hidden) cur.add(ns);
    else cur.delete(ns);
    updateSettings(panelId, { hiddenMarkerNamespaces: Array.from(cur).sort() });
  };
  const setMapAlpha = (v: number) => updateSettings(panelId, { mapAlpha: v });
  const setMapColorScheme = (v: MapColorSchemeChoice) =>
    updateSettings(panelId, { mapColorScheme: v });
  const setShowRobotMarkers = (v: boolean) => updateSettings(panelId, { showRobotMarkers: v });
  const setCameraFrustumsOn = (v: boolean) =>
    updateSettings(panelId, { cameraFrustumsOn: v });
  const setCameraFrustumFar = (v: number) =>
    updateSettings(panelId, { cameraFrustumFar: v });
  const toggleFrustumTopicHidden = (t: string, hidden: boolean) => {
    const cur = new Set(hiddenFrustumTopics);
    if (hidden) cur.add(t);
    else cur.delete(t);
    updateSettings(panelId, { hiddenFrustumTopics: Array.from(cur).sort() });
  };
  const toggleSpatialOverlay = (candidateBagId: string, topic: string, visible: boolean) => {
    const key = overlayKey(candidateBagId, topic);
    const current = new Set(spatialOverlayTopics);
    if (visible) current.add(key);
    else current.delete(key);
    updateSettings(panelId, { spatialOverlayTopics: Array.from(current).sort() });
  };
  const setSpatialOverlayStyle = (
    candidateBagId: string,
    topic: string,
    patch: Partial<SpatialOverlayStyle>,
  ) => {
    const key = overlayKey(candidateBagId, topic);
    updateSettings(panelId, {
      spatialOverlayStyles: {
        ...spatialOverlayStyles,
        [key]: { ...spatialOverlayStyles[key], ...patch },
      },
    });
  };

  const setClipBoxOn = (v: boolean) => updateSettings(panelId, { clipBoxOn: v });
  const onSetClipBound = (
    axis: 'x' | 'y' | 'z',
    side: 'min' | 'max',
    v: number | null,
  ) => {
    const key = `clip${axis.toUpperCase()}${side === 'min' ? 'Min' : 'Max'}` as
      | 'clipXMin' | 'clipXMax' | 'clipYMin' | 'clipYMax' | 'clipZMin' | 'clipZMax';
    updateSettings(panelId, { [key]: v });
  };
  const setSectionCoordFrameOpen = (v: boolean) => updateSettings(panelId, { sectionCoordFrameOpen: v });
  const setSectionRangeClipOpen = (v: boolean) => updateSettings(panelId, { sectionRangeClipOpen: v });
  const setSectionAccumulationOpen = (v: boolean) => updateSettings(panelId, { sectionAccumulationOpen: v });
  const setSectionOverlaysOpen = (v: boolean) => updateSettings(panelId, { sectionOverlaysOpen: v });

  const axisClip: AxisClip | undefined = clipBoxOn
    ? {
        ...(clipXMin !== null ? { xMin: clipXMin } : {}),
        ...(clipXMax !== null ? { xMax: clipXMax } : {}),
        ...(clipYMin !== null ? { yMin: clipYMin } : {}),
        ...(clipYMax !== null ? { yMax: clipYMax } : {}),
        ...(clipZMin !== null ? { zMin: clipZMin } : {}),
        ...(clipZMax !== null ? { zMax: clipZMax } : {}),
      }
    : undefined;

  // v1.3.3 - issue #44: "Save as default" snapshots the current panel's
  // settings as the kind-level user default; "Reset to default" applies the
  // saved default (or the hard-coded fallback when none is saved) back to
  // *this* panel. Both actions only touch their respective stores - the
  // panel re-renders through the existing `byId[panelId]` selector.
  const handleSaveAsDefault = useCallback(() => {
    setUserDefault(sceneKind, settings);
  }, [setUserDefault, sceneKind, settings]);
  const handleResetToDefault = useCallback(() => {
    // Apply the kind default to this panel. We deliberately reuse
    // `effectiveDefaults` here so the user immediately sees the default
    // they just saved, instead of needing to reopen the panel.
    setAllSettings(panelId, effectiveDefaults);
  }, [setAllSettings, panelId, effectiveDefaults]);
  const handleClearSavedDefault = useCallback(() => {
    clearUserDefault(sceneKind);
  }, [clearUserDefault, sceneKind]);

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
    axisClip: sceneKind === 'pointcloud' ? axisClip : undefined,
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

  const { graph, missing: noTf } = useTFGraph(bagId, topicName);
  const { containerRef, sceneRef, ready: sceneReady, zoomLevel } = useScene();

  useEffect(() => {
    if (!sceneReady) return;
    sceneRef.current?.setProjectionMode(projectionMode);
  }, [projectionMode, sceneReady, sceneRef]);

  // Register this panel's WebGL canvas for clip export.
  useEffect(
    () => registerCapture(panelId, () => sceneRef.current?.renderer.domElement ?? null),
    [panelId, sceneRef],
  );

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
  }, [graph, cloud, poseMessage, mapMessage, worldFrame, isMarker, markerStream.messages, setWorldFrame]);

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
      owned.mapPlane = createMapPlane(MAP_PLANE_RENDER_ORDER[classifyMapPlaneTier(topicName)]);
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
    if (owned.cloud) {
      setCloudStyle(
        owned.cloud,
        sceneKind === 'laserscan' ? pointSize + 1 : pointSize,
        sceneKind === 'laserscan' ? laserScanColor : null,
      );
    }
    if (owned.accumulator) owned.accumulator.setPointSize(pointSize);
    refs.renderOnce();
  }, [laserScanColor, pointSize, sceneKind, sceneRef]);

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
  }, [worldFrame, topicName, upAxis, sceneRef, setPivot]);

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
  }, [sceneRef, setPivot]);

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

    const scheme = resolveOccupancyGridScheme(mapColorScheme, topicName);
    const decoded = decodeOccupancyGrid(mapMessage.value as OccupancyGridMessage, scheme);
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
      setStats({
        points: decoded.width * decoded.height,
        bounds: owned.mapPlane.bounds,
        sourceFrame,
        timestamp: mapMessage.timestamp,
      });
    }
    refs.renderOnce();
  }, [mapMessage, graph, worldFrame, sceneRef, upFixMatrix, mapColorScheme, topicName]);

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

  // ─── Robot subtree lifecycle ───────────────────────────────────────────
  //
  // Build the Three.js subtree whenever the loaded URDF, the anchor link,
  // or the scene mounts. The build is async (mesh loads), so we guard
  // against the user swapping models mid-build with a cancellation flag.
  const robotRef = useRef<RobotSubtree | null>(null);
  const robotTransformCacheRef = useRef<{ key: string; matrix: THREE.Matrix4 } | null>(null);

  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    if (!robotModel) {
      // No URDF loaded - nothing to render.
      const existing = robotRef.current;
      if (existing) {
        refs.worldGroup.remove(existing.root);
        existing.dispose();
        robotRef.current = null;
        refs.renderOnce();
      }
      return;
    }

    let cancelled = false;
    void buildRobotSubtree(robotModel.model, robotModel.anchorLink).then((subtree) => {
      if (cancelled) {
        subtree.dispose();
        return;
      }
      // Dispose any previous subtree before swapping in the new one so a
      // re-mount or model swap doesn't leak the prior tree.
      const existing = robotRef.current;
      if (existing) {
        refs.worldGroup.remove(existing.root);
        existing.dispose();
      }
      robotRef.current = subtree;
      subtree.root.visible = !robotHidden;
      refs.worldGroup.add(subtree.root);
      // Force the per-tick transform effect below to re-apply at first paint.
      robotTransformCacheRef.current = null;
      refs.renderOnce();
    });

    return () => {
      cancelled = true;
    };
    // sceneKind in the deps so a panel that switches data flavour (e.g. via
    // a topic-row drag from a pointcloud to a markerarray panel kind) still
    // rebuilds correctly. Also re-run when the anchor link changes so the
    // root group's local frame matches the new anchor.
  }, [sceneRef, robotModel, robotHidden, sceneKind]);

  // Apply hide toggle without rebuilding.
  useEffect(() => {
    const refs = sceneRef.current;
    const subtree = robotRef.current;
    if (!refs || !subtree) return;
    subtree.root.visible = !robotHidden;
    refs.renderOnce();
  }, [robotHidden, sceneRef]);

  // Joint-state ingestion. setJointPositions is cheap (matrix tweaks per
  // joint), so we just apply on every change.
  useEffect(() => {
    const refs = sceneRef.current;
    const subtree = robotRef.current;
    if (!refs || !subtree) return;
    subtree.setJointPositions(jointStates.positions);
    refs.renderOnce();
  }, [jointStates.positions, sceneRef]);

  // Per-tick TF transform: place the robot's root at its anchor link's
  // world-space pose. Independent from the user-group's transform because
  // the robot's anchor link is rarely the same as the data topic's
  // header.frame_id. Uses the same cache-on-key pattern as the userGroup
  // transform so consecutive playhead ticks don't re-walk the chain.
  useEffect(() => {
    const refs = sceneRef.current;
    const subtree = robotRef.current;
    if (!refs || !subtree || !robotModel) return;
    subtree.root.matrixAutoUpdate = false;
    applyTransform(
      subtree.root as unknown as THREE.Group,
      graph,
      robotModel.anchorLink || null,
      worldFrame,
      playheadNs,
      robotTransformCacheRef,
      upFixMatrix,
    );
    refs.renderOnce();
  }, [robotModel, graph, worldFrame, playheadNs, upFixMatrix, sceneRef]);

  // ─── Camera frustums (v1.3.2) ──────────────────────────────────────────
  //
  // For every `sensor_msgs/CameraInfo` topic in the bag, render a wireframe
  // pyramid in the camera's optical frame. The frustum is sized by the
  // intrinsics (fx, fy, cx, cy, width, height) and a single far-plane
  // distance set per-panel. Hidden subcomponents below the panel mount one
  // `useMessageAtTime` per camera and push parsed intrinsics into the map
  // here; the lifecycle effect mirrors the map onto the Three.js scene.
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

  /**
   * Keyboard camera control (accessibility Tier 1) - I/J/K/L orbit,
   * +/- zoom, F re-fit. Deliberately not arrow keys or Space: those are
   * already bound globally (playhead step / play-pause in
   * useKeyboardShortcuts.ts) and would double-fire alongside a camera move.
   * Scoped to this element's own onKeyDown (not a window listener), so
   * there's no possibility of colliding with SplatViewer's separate
   * hover-gated WASD fly-through in a different panel - only one panel's
   * listener can ever be in scope for a given keypress.
   */
  const handleSceneKeyDown = (e: React.KeyboardEvent) => {
    const refs = sceneRef.current;
    if (!refs) return;
    const ORBIT_STEP = Math.PI / 24; // 7.5 degrees per press
    switch (e.key) {
      case 'i':
      case 'I':
        e.preventDefault();
        refs.orbitBy(0, -ORBIT_STEP);
        return;
      case 'k':
      case 'K':
        e.preventDefault();
        refs.orbitBy(0, ORBIT_STEP);
        return;
      case 'j':
      case 'J':
        e.preventDefault();
        refs.orbitBy(-ORBIT_STEP, 0);
        return;
      case 'l':
      case 'L':
        e.preventDefault();
        refs.orbitBy(ORBIT_STEP, 0);
        return;
      case '+':
      case '=':
        e.preventDefault();
        refs.zoomBy(0.85);
        return;
      case '-':
      case '_':
        e.preventDefault();
        refs.zoomBy(1 / 0.85);
        return;
      case 'f':
      case 'F':
        e.preventDefault();
        handleResetCamera();
        return;
    }
  };

  // Visually-hidden scene summary for screen readers - the canvas itself
  // has no accessible content otherwise. Kind + frame covers every scene
  // type; point count is meaningful for the two kinds that have one.
  const sceneSummary = `${SCENE_KIND_LABELS[sceneKind]} scene${
    stats.sourceFrame ? `, frame ${stats.sourceFrame}` : ''
  }${stats.points > 0 ? `, ${stats.points.toLocaleString()} points` : ''}`;

  return (
    <PanelShell
      panelId={panelId}
      kind="3d"
      topicName={topicName}
      type={type}
      accentColor={accent}
    >
      {/* Hidden feeds: one per CameraInfo topic, push parsed intrinsics into
          `cameraInfos`. Only mount when the user has enabled frustums so we
          don't pay for CameraInfo decodes on bags they don't care about. */}
      {cameraFrustumsOn &&
        cameraInfoTopics.map((topic) => (
          <CameraInfoFeed
            key={topic}
            topic={topic}
            bagId={bagId}
            playheadNs={playheadNs}
            onUpdate={handleCameraInfoUpdate}
          />
        ))}
      {sceneReady &&
        selectedSpatialOverlays.map((overlay) => (
          <SpatialOverlay
            key={overlayKey(overlay.bagId, overlay.name)}
            topic={overlay}
            sceneRef={sceneRef}
            worldFrame={worldFrame}
            upFixMatrix={upFixMatrix}
            colorMode={colorMode}
            pointSize={pointSize}
            style={spatialOverlayStyles[overlayKey(overlay.bagId, overlay.name)]}
            maxRange={rangeLimitOn && maxRange > 0 ? maxRange : undefined}
            heightAxis={heightAxis}
            axisClip={axisClip}
            mapAlpha={mapAlpha}
          />
        ))}
      {sceneReady &&
        showRobotMarkers &&
        overlayBagMeta.size > 1 &&
        bagOrder.map((id) => (
          <RobotMarker
            key={id}
            bagId={id}
            color={overlayBagMeta.get(id)?.color ?? '#22d3ee'}
            sceneRef={sceneRef}
            worldFrame={worldFrame}
            upFixMatrix={upFixMatrix}
          />
        ))}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 min-h-[260px] relative bg-bg-primary/60 overflow-hidden">
          <div
            ref={containerRef}
            className="absolute inset-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60 focus-visible:ring-inset"
            tabIndex={0}
            role="img"
            aria-label={`3D scene: ${topicName} (${SCENE_KIND_LABELS[sceneKind]}). Focus and use I/J/K/L to orbit, +/- to zoom, F to re-fit.`}
            onKeyDown={handleSceneKeyDown}
          />
          {/* Visually-hidden live summary - the canvas has no accessible
              content of its own, so this is the only way a screen reader
              knows what's currently rendered. */}
          <span className="sr-only" aria-live="polite">
            {sceneSummary}
          </span>

          <div className="absolute top-2 right-2 flex flex-col gap-1.5 items-end">
            <div className="flex gap-1">
              {pivot && (
                <button
                  onClick={handleResetPivot}
                  className="px-2 py-1 rounded-md text-xs mono bg-surface/80 border border-border hover:border-accent-blue/40 hover:text-accent-blue text-text-secondary transition-colors"
                  title="Return orbit centre to the auto-fit point"
                >
                  Reset pivot
                </button>
              )}
              <div
                className="flex rounded-md overflow-hidden border border-border bg-surface/80"
                role="group"
                aria-label="Scene projection"
              >
                {(['orthographic', 'perspective'] as const).map((mode) => {
                  const active = projectionMode === mode;
                  const label = mode === 'orthographic' ? '2D' : '3D';
                  return (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setProjectionMode(mode)}
                      className={
                        active
                          ? 'px-2 py-1 text-xs mono bg-accent-blue/20 text-accent-blue'
                          : 'px-2 py-1 text-xs mono text-text-secondary hover:text-accent-blue'
                      }
                      title={mode === 'orthographic'
                        ? 'Top-down orthographic map view'
                        : 'Perspective 3D orbit view'}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={handleResetCamera}
                className="px-2 py-1 rounded-md text-xs mono bg-surface/80 border border-border hover:border-accent-blue/40 hover:text-accent-blue text-text-secondary transition-colors"
                title="Reset camera"
              >
                Fit
              </button>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-border bg-surface/80 px-2 py-1 text-[10px] mono text-text-tertiary">
              <span>zoom</span>
              <input
                type="range"
                aria-label="Map zoom"
                min={-3.3219}
                max={3.3219}
                step={0.05}
                value={Math.log2(zoomLevel)}
                onChange={(event) =>
                  sceneRef.current?.setZoomLevel(2 ** Number(event.target.value))
                }
                className="w-28 accent-accent-blue"
              />
              <span className="w-10 text-right text-text-secondary">
                {Math.round(zoomLevel * 100)}%
              </span>
            </label>
            <ControlsCard
              sceneKind={sceneKind}
              colorMode={colorMode}
              setColorMode={setColorMode}
              pointSize={pointSize}
              setPointSize={setPointSize}
              laserScanColor={laserScanColor}
              setLaserScanColor={setLaserScanColor}
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
              mapColorScheme={mapColorScheme}
              setMapColorScheme={setMapColorScheme}
              showRobotMarkers={showRobotMarkers}
              setShowRobotMarkers={setShowRobotMarkers}
              multiBag={overlayBagMeta.size > 1}
              spatialOverlayCandidates={spatialOverlayCandidates}
              spatialOverlayTopics={spatialOverlayTopics}
              onToggleSpatialOverlay={toggleSpatialOverlay}
              spatialOverlayStyles={spatialOverlayStyles}
              onSetSpatialOverlayStyle={setSpatialOverlayStyle}
              overlayBagMeta={overlayBagMeta}
              hasPointCloudLayer={hasPointCloudLayer}
              hasPointLayer={hasPointLayer}
              hasMapLayer={hasMapLayer}
              hasRobotModel={!!robotModel}
              robotName={robotModel?.sourceName ?? null}
              robotHidden={robotHidden}
              setRobotHidden={(hidden) => setRobotHidden(panelId, hidden)}
              robotHasJointStates={jointStates.hasTopic}
              cameraFrustumCount={cameraInfoTopics.length}
              cameraFrustumsOn={cameraFrustumsOn}
              setCameraFrustumsOn={setCameraFrustumsOn}
              cameraFrustumFar={cameraFrustumFar}
              setCameraFrustumFar={setCameraFrustumFar}
              cameraInfoTopics={cameraInfoTopics}
              hiddenFrustumTopics={hiddenFrustumTopics}
              onToggleFrustumTopic={toggleFrustumTopicHidden}
              sceneKindLabel={SCENE_KIND_LABELS[sceneKind]}
              hasSavedDefault={hasUserDefault}
              onSaveAsDefault={handleSaveAsDefault}
              onResetToDefault={handleResetToDefault}
              onClearSavedDefault={handleClearSavedDefault}
              clipBoxOn={clipBoxOn}
              setClipBoxOn={setClipBoxOn}
              clipBounds={{ xMin: clipXMin, xMax: clipXMax, yMin: clipYMin, yMax: clipYMax, zMin: clipZMin, zMax: clipZMax }}
              onSetClipBound={onSetClipBound}
              sectionCoordFrameOpen={sectionCoordFrameOpen}
              setSectionCoordFrameOpen={setSectionCoordFrameOpen}
              sectionRangeClipOpen={sectionRangeClipOpen}
              setSectionRangeClipOpen={setSectionRangeClipOpen}
              sectionAccumulationOpen={sectionAccumulationOpen}
              setSectionAccumulationOpen={setSectionAccumulationOpen}
              sectionOverlaysOpen={sectionOverlaysOpen}
              setSectionOverlaysOpen={setSectionOverlaysOpen}
            />
          </div>

          <OverlayCard variant="subtle" className="absolute top-2 left-2 text-text-muted text-[10px] mono leading-tight px-2 py-1 max-w-[60%]">
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
          </OverlayCard>

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
            <div className="absolute inset-0 flex bg-bg-primary/70">
              <PanelErrorState
                title="Failed to load frame"
                message={error}
                schemaTarget={{ typeName: type, topicName, panelKind: '3d', bagId }}
              />
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
  laserScanColor: string | null;
  setLaserScanColor: (color: string | null) => void;
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
  /** OccupancyGrid color scheme for this panel's own primary topic. */
  mapColorScheme: MapColorSchemeChoice;
  setMapColorScheme: (v: MapColorSchemeChoice) => void;
  /** Per-bag colored robot markers - only offered once more than one bag is loaded. */
  showRobotMarkers: boolean;
  setShowRobotMarkers: (v: boolean) => void;
  multiBag: boolean;
  spatialOverlayCandidates: SpatialOverlayTopic[];
  spatialOverlayTopics: string[];
  onToggleSpatialOverlay: (bagId: string, topic: string, visible: boolean) => void;
  spatialOverlayStyles: Record<string, SpatialOverlayStyle>;
  onSetSpatialOverlayStyle: (
    bagId: string,
    topic: string,
    patch: Partial<SpatialOverlayStyle>,
  ) => void;
  /** Color + display label per loaded bag, for tagging cross-bag overlay candidates. */
  overlayBagMeta: Map<string, { color: string; label: string }>;
  hasPointCloudLayer: boolean;
  hasPointLayer: boolean;
  hasMapLayer: boolean;
  /** A URDF has been loaded app-wide. */
  hasRobotModel: boolean;
  /** Source filename (for the title attribute). */
  robotName: string | null;
  /** This panel hides the robot model. */
  robotHidden: boolean;
  setRobotHidden: (hidden: boolean) => void;
  /** Bag has a JointState topic the model can ingest. */
  robotHasJointStates: boolean;
  /** Number of `sensor_msgs/CameraInfo` topics in the bag (v1.3.2). */
  cameraFrustumCount: number;
  /** Master toggle for the camera frustum overlay. */
  cameraFrustumsOn: boolean;
  setCameraFrustumsOn: (v: boolean) => void;
  /** Far-plane distance for the frustum, in metres. */
  cameraFrustumFar: number;
  setCameraFrustumFar: (v: number) => void;
  /** All CameraInfo topic names (v1.3.4). Used to render per-camera hide checkboxes. */
  cameraInfoTopics: string[];
  /** Topics whose frustum the user has hidden (v1.3.4). */
  hiddenFrustumTopics: string[];
  onToggleFrustumTopic: (topic: string, hidden: boolean) => void;
  /** Human-readable scene-kind label for the v1.3.3 defaults UI ("PointCloud2"). */
  sceneKindLabel: string;
  /** True when a user default is saved for this scene kind. */
  hasSavedDefault: boolean;
  onSaveAsDefault: () => void;
  onResetToDefault: () => void;
  onClearSavedDefault: () => void;
  /** Per-axis clip box (v1.6.1). */
  clipBoxOn: boolean;
  setClipBoxOn: (v: boolean) => void;
  clipBounds: { xMin: number | null; xMax: number | null; yMin: number | null; yMax: number | null; zMin: number | null; zMax: number | null };
  onSetClipBound: (axis: 'x' | 'y' | 'z', side: 'min' | 'max', v: number | null) => void;
  /** Disclosure-section expand state (v1.7 progressive disclosure). */
  sectionCoordFrameOpen: boolean;
  setSectionCoordFrameOpen: (v: boolean) => void;
  sectionRangeClipOpen: boolean;
  setSectionRangeClipOpen: (v: boolean) => void;
  sectionAccumulationOpen: boolean;
  setSectionAccumulationOpen: (v: boolean) => void;
  sectionOverlaysOpen: boolean;
  setSectionOverlaysOpen: (v: boolean) => void;
}

function ControlsCard({
  sceneKind,
  colorMode,
  setColorMode,
  pointSize,
  setPointSize,
  laserScanColor,
  setLaserScanColor,
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
  mapColorScheme,
  setMapColorScheme,
  showRobotMarkers,
  setShowRobotMarkers,
  multiBag,
  spatialOverlayCandidates,
  spatialOverlayTopics,
  onToggleSpatialOverlay,
  spatialOverlayStyles,
  onSetSpatialOverlayStyle,
  overlayBagMeta,
  hasPointCloudLayer,
  hasPointLayer,
  hasMapLayer,
  hasRobotModel,
  robotName,
  robotHidden,
  setRobotHidden,
  robotHasJointStates,
  cameraFrustumCount,
  cameraFrustumsOn,
  setCameraFrustumsOn,
  cameraFrustumFar,
  setCameraFrustumFar,
  cameraInfoTopics,
  hiddenFrustumTopics,
  onToggleFrustumTopic,
  sceneKindLabel,
  hasSavedDefault,
  onSaveAsDefault,
  onResetToDefault,
  onClearSavedDefault,
  clipBoxOn,
  setClipBoxOn,
  clipBounds,
  onSetClipBound,
  sectionCoordFrameOpen,
  setSectionCoordFrameOpen,
  sectionRangeClipOpen,
  setSectionRangeClipOpen,
  sectionAccumulationOpen,
  setSectionAccumulationOpen,
  sectionOverlaysOpen,
  setSectionOverlaysOpen,
}: ControlsCardProps) {
  const [open, setOpen] = useState(false);
  // Esc closes the Display card, not the whole panel (see useEscapeToClose).
  useEscapeToClose(open, () => setOpen(false));
  const allFrames = useMemo(() => (graph ? Array.from(graph.frames).sort() : []), [graph]);
  const hiddenSet = useMemo(
    () => new Set(hiddenMarkerNamespaces),
    [hiddenMarkerNamespaces],
  );

  return (
    <OverlayCard elevated className="text-xs mono">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-2.5 py-1.5 flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span>Display</span>
        {spatialOverlayTopics.length > 0 && (
          <span className="text-accent-cyan text-[10px]">
            {spatialOverlayTopics.length + 1} layers
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border w-56">
        <div className="p-2.5 space-y-2 max-h-[60vh] overflow-y-auto">
          {hasPointCloudLayer && (
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
          {sceneKind === 'laserscan' && (
            <div>
              <div className="text-text-tertiary text-[10px] mb-1">scan color</div>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  aria-label="LaserScan color"
                  value={laserScanColor ?? '#22d3ee'}
                  onChange={(event) => setLaserScanColor(event.target.value)}
                  className="w-8 h-6 rounded border border-border bg-transparent cursor-pointer"
                />
                <button
                  type="button"
                  aria-pressed={laserScanColor === null}
                  onClick={() => setLaserScanColor(null)}
                  className={
                    laserScanColor === null
                      ? 'px-2 py-0.5 rounded border border-accent-blue/40 text-accent-blue'
                      : 'px-2 py-0.5 rounded border border-border text-text-secondary hover:border-accent-blue/40'
                  }
                  title="Use the decoded range gradient"
                >
                  range
                </button>
              </div>
            </div>
          )}
          {hasPointLayer && (
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
          {hasMapLayer && (
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
          {sceneKind === 'occupancygrid' && (
            <div>
              <div className="text-text-tertiary text-[10px] mb-1">map style</div>
              <div className="flex gap-1">
                {(['auto', 'map', 'costmap'] as MapColorSchemeChoice[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setMapColorScheme(v)}
                    className={`px-2 py-0.5 rounded-md transition-colors ${
                      mapColorScheme === v
                        ? 'bg-accent-blue/15 text-accent-blue border border-accent-blue/40'
                        : 'border border-border text-text-secondary hover:border-accent-blue/40'
                    }`}
                    title={
                      v === 'auto'
                        ? 'Costmap palette for topics named "costmap", grayscale otherwise'
                        : v === 'costmap'
                          ? "Nav2/rviz costmap palette - obstacles in cyan/magenta, cost gradient in blue-magenta"
                          : 'Grayscale, for SLAM/static maps'
                    }
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Everyday four, stop here: color by / point size / grid / axes.
              Everything below is one click away in a disclosure section -
              collapsed by default so a first-time user sees four controls,
              not twenty. */}
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

          <DisclosureSection
            label="Coordinate frame"
            open={sectionCoordFrameOpen}
            onToggle={setSectionCoordFrameOpen}
          >
            <div>
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
          </DisclosureSection>

          {hasPointCloudLayer && (
            <DisclosureSection
              label="Range and clipping"
              open={sectionRangeClipOpen}
              onToggle={setSectionRangeClipOpen}
            >
              <div>
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
              <div>
                <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer mb-1.5">
                  <input
                    type="checkbox"
                    checked={clipBoxOn}
                    onChange={(e) => setClipBoxOn(e.target.checked)}
                    className="accent-accent-blue"
                  />
                  clip box
                </label>
                {clipBoxOn && (
                  <div className="space-y-1">
                    {(['x', 'y', 'z'] as const).map((axis) => (
                      <div key={axis} className="grid items-center gap-1" style={{ gridTemplateColumns: '0.75rem 1fr 1fr' }}>
                        <span className="text-text-tertiary uppercase text-center">{axis}</span>
                        <ClipBoundInput
                          value={clipBounds[`${axis}Min`]}
                          onChange={(v) => onSetClipBound(axis, 'min', v)}
                          placeholder="min"
                        />
                        <ClipBoundInput
                          value={clipBounds[`${axis}Max`]}
                          onChange={(v) => onSetClipBound(axis, 'max', v)}
                          placeholder="max"
                        />
                      </div>
                    ))}
                    <p className="text-text-muted text-[9px] leading-tight pt-0.5">
                      empty = no clip on that side
                    </p>
                  </div>
                )}
              </div>
            </DisclosureSection>
          )}

          {sceneKind === 'pointcloud' && (
            <DisclosureSection
              label="Accumulation"
              open={sectionAccumulationOpen}
              onToggle={setSectionAccumulationOpen}
            >
              <div className="space-y-1.5">
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
            </DisclosureSection>
          )}

          {(spatialOverlayCandidates.length > 0 || hasRobotModel || cameraFrustumCount > 0 || multiBag || (sceneKind === 'markerarray' && markerNamespaces.length > 0)) && (
            <DisclosureSection
              label="Overlays"
              open={sectionOverlaysOpen}
              onToggle={setSectionOverlaysOpen}
            >
              {multiBag && (
                <label className="flex items-center gap-1.5 text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showRobotMarkers}
                    onChange={(e) => setShowRobotMarkers(e.target.checked)}
                    className="accent-accent-blue"
                  />
                  robot markers
                  <span className="text-text-tertiary text-[10px]">
                    (colored puck per loaded bag)
                  </span>
                </label>
              )}
              {spatialOverlayCandidates.length > 0 && (
                <div>
                  <div className="flex items-center justify-between text-text-tertiary text-[10px] mb-1">
                    <span>scene topics</span>
                    <span>{spatialOverlayTopics.length + 1} layers</span>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
                    {spatialOverlayCandidates.map((candidate) => {
                      const key = overlayKey(candidate.bagId, candidate.name);
                      const checked = spatialOverlayTopics.includes(key);
                      const shortType = candidate.type.split('/').pop() ?? candidate.type;
                      const candidateKind = detectKind(candidate.type);
                      const supportsPointStyle =
                        candidateKind === 'pointcloud' || candidateKind === 'laserscan';
                      const style = spatialOverlayStyles[key] ?? {};
                      const layerPointSize = style.pointSize ?? pointSize;
                      // Only shown once >1 bag is loaded, since a single-bag
                      // panel has nothing to disambiguate.
                      const bagMeta =
                        overlayBagMeta.size > 1 ? overlayBagMeta.get(candidate.bagId) : undefined;
                      const title = bagMeta
                        ? `${bagMeta.label}: ${candidate.name} (${candidate.type})`
                        : `${candidate.name} (${candidate.type})`;
                      return (
                        <div key={key}>
                          <label
                            className={checked ? 'flex items-center gap-1.5 cursor-pointer text-text-secondary' : 'flex items-center gap-1.5 cursor-pointer text-text-tertiary'}
                            title={title}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) =>
                                onToggleSpatialOverlay(candidate.bagId, candidate.name, event.target.checked)
                              }
                              className="accent-accent-cyan flex-shrink-0"
                            />
                            {bagMeta && (
                              <span
                                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: bagMeta.color }}
                              />
                            )}
                            <span className="truncate flex-1">{candidate.name}</span>
                            <span className="text-[9px] text-text-tertiary flex-shrink-0">
                              {shortType}
                            </span>
                          </label>
                          {checked && supportsPointStyle && (
                            <div className="ml-5 mt-1 space-y-1 rounded border border-border/70 p-1.5">
                              <label className="flex items-center gap-1.5 text-[9px] text-text-tertiary">
                                <span>size</span>
                                <input
                                  type="range"
                                  aria-label={candidate.name + ' point size'}
                                  min={1}
                                  max={8}
                                  step={0.5}
                                  value={layerPointSize}
                                  onChange={(event) =>
                                    onSetSpatialOverlayStyle(candidate.bagId, candidate.name, {
                                      pointSize: Number(event.target.value),
                                    })
                                  }
                                  className="min-w-0 flex-1 accent-accent-cyan"
                                />
                                <span className="w-8 text-right text-text-secondary">
                                  {layerPointSize.toFixed(1)}
                                </span>
                              </label>
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="color"
                                  aria-label={candidate.name + ' color'}
                                  value={style.color ?? '#22d3ee'}
                                  onChange={(event) =>
                                    onSetSpatialOverlayStyle(candidate.bagId, candidate.name, {
                                      color: event.target.value,
                                    })
                                  }
                                  className="h-5 w-7 cursor-pointer rounded border border-border bg-transparent"
                                />
                                <button
                                  type="button"
                                  aria-label={'Use automatic colors for ' + candidate.name}
                                  aria-pressed={style.color == null}
                                  onClick={() =>
                                    onSetSpatialOverlayStyle(candidate.bagId, candidate.name, { color: null })
                                  }
                                  className={
                                    style.color == null
                                      ? 'rounded border border-accent-cyan/40 px-1.5 text-accent-cyan'
                                      : 'rounded border border-border px-1.5 text-text-tertiary hover:border-accent-cyan/40'
                                  }
                                >
                                  auto
                                </button>
                              </div>
                            </div>
                          )}
                          {checked && candidateKind === 'occupancygrid' && (
                            <div className="ml-5 mt-1 space-y-1 rounded border border-border/70 p-1.5">
                              <div className="text-[9px] text-text-tertiary">map style</div>
                              <div className="flex gap-1">
                                {(['auto', 'map', 'costmap'] as MapColorSchemeChoice[]).map((v) => (
                                  <button
                                    key={v}
                                    type="button"
                                    onClick={() =>
                                      onSetSpatialOverlayStyle(candidate.bagId, candidate.name, {
                                        mapColorScheme: v,
                                      })
                                    }
                                    className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                                      (style.mapColorScheme ?? 'auto') === v
                                        ? 'bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/40'
                                        : 'border border-border text-text-tertiary hover:border-accent-cyan/40'
                                    }`}
                                  >
                                    {v}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-text-tertiary text-[10px] leading-tight mt-1">
                    Layers use TF to align with the selected world frame.
                  </div>
                </div>
              )}
              {sceneKind === 'markerarray' && markerNamespaces.length > 0 && (
                <div>
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
              {hasRobotModel && (
                <div>
                  <label
                    className="flex items-center gap-1.5 text-text-secondary cursor-pointer"
                    title={
                      robotName
                        ? `Robot model: ${robotName}${
                            robotHasJointStates ? ' (animating from /joint_states)' : ''
                          }`
                        : undefined
                    }
                  >
                    <input
                      type="checkbox"
                      checked={!robotHidden}
                      onChange={(e) => setRobotHidden(!e.target.checked)}
                      className="accent-accent-blue"
                    />
                    robot model
                  </label>
                  {!robotHasJointStates && (
                    <div className="text-text-tertiary text-[10px] mt-0.5">
                      no /joint_states - joints stay at rest
                    </div>
                  )}
                </div>
              )}
              {cameraFrustumCount > 0 && (
                <div>
                  <label
                    className="flex items-center gap-1.5 text-text-secondary cursor-pointer"
                    title="Render a wireframe pyramid in each camera's optical frame, sized by its CameraInfo intrinsics"
                  >
                    <input
                      type="checkbox"
                      checked={cameraFrustumsOn}
                      onChange={(e) => setCameraFrustumsOn(e.target.checked)}
                      className="accent-accent-cyan"
                    />
                    camera frustums{' '}
                    <span className="text-text-tertiary">({cameraFrustumCount})</span>
                  </label>
                  {cameraFrustumsOn && (
                    <div className="mt-1.5 flex items-center gap-2 text-[10px]">
                      <span className="text-text-tertiary w-12 flex-shrink-0">far</span>
                      <input
                        type="range"
                        min={0.5}
                        max={50}
                        step={0.5}
                        value={cameraFrustumFar}
                        onChange={(e) => setCameraFrustumFar(Number(e.target.value))}
                        className="flex-1 accent-accent-cyan"
                        aria-label="Camera frustum far plane distance"
                      />
                      <span className="text-text-secondary mono w-10 text-right">
                        {cameraFrustumFar.toFixed(1)}m
                      </span>
                    </div>
                  )}
                  {cameraFrustumsOn && cameraInfoTopics.length > 1 && (
                    <div className="mt-1.5 space-y-0.5">
                      <div className="text-text-tertiary text-[10px] mb-0.5">cameras</div>
                      {cameraInfoTopics.map((topic) => {
                        const hidden = hiddenFrustumTopics.includes(topic);
                        const shortName = topic.split('/').filter(Boolean).slice(-2).join('/') || topic;
                        return (
                          <label
                            key={topic}
                            className={`flex items-center gap-1.5 cursor-pointer text-[10px] ${
                              hidden ? 'text-text-tertiary' : 'text-text-secondary'
                            }`}
                            title={topic}
                          >
                            <input
                              type="checkbox"
                              checked={!hidden}
                              onChange={(e) => onToggleFrustumTopic(topic, !e.target.checked)}
                              className="accent-accent-cyan flex-shrink-0"
                            />
                            <span className="truncate">{shortName}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </DisclosureSection>
          )}
        </div>
        {/* Pinned footer - stays put regardless of section scroll/expand state. */}
        <div className="p-2.5 pt-1.5 border-t border-border/60 space-y-1">
          <div className="flex items-center justify-between text-text-tertiary text-[10px]">
            <span>defaults ({sceneKindLabel})</span>
            {hasSavedDefault && (
              <button
                onClick={onClearSavedDefault}
                className="text-text-tertiary hover:text-accent-rose underline decoration-dotted"
                title={`Forget the saved default for ${sceneKindLabel}. Future panels fall back to built-in defaults.`}
              >
                clear saved
              </button>
            )}
          </div>
          <div className="flex gap-1">
            <button
              onClick={onSaveAsDefault}
              className="flex-1 px-2 py-0.5 rounded-md transition-colors border border-border text-text-secondary hover:border-accent-blue/40 hover:text-accent-blue"
              title={`Persist this panel's current settings as the default for every new ${sceneKindLabel} panel (stored in your browser).`}
            >
              save as default
            </button>
            <button
              onClick={onResetToDefault}
              className="flex-1 px-2 py-0.5 rounded-md transition-colors border border-border text-text-secondary hover:border-accent-blue/40 hover:text-accent-blue"
              title={
                hasSavedDefault
                  ? `Apply the saved ${sceneKindLabel} default to this panel.`
                  : `Reset this panel to the built-in ${sceneKindLabel} defaults.`
              }
            >
              reset
            </button>
          </div>
          {hasSavedDefault && (
            <div className="text-text-tertiary text-[10px] leading-tight">
              saved default in effect for new panels
            </div>
          )}
        </div>
        </div>
      )}
    </OverlayCard>
  );
}

/**
 * DisclosureSection — collapsed-by-default group inside the Display card.
 * Native <details>/<summary> so no extra state or animation code is
 * needed; open state lives in the panel's settings store (via `open`/
 * `onToggle`) so it survives remounts and can travel through "save as
 * default" like every other display setting.
 */
function DisclosureSection({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details
      open={open}
      onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}
      className="group pt-1 border-t border-border/60"
    >
      <summary className="flex items-center gap-1.5 text-text-tertiary hover:text-text-secondary text-[10px] uppercase tracking-wide cursor-pointer select-none py-0.5 list-none [&::-webkit-details-marker]:hidden">
        <svg
          className="w-2.5 h-2.5 flex-shrink-0 transition-transform group-open:rotate-90"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        {label}
      </summary>
      <div className="pt-1.5 space-y-2">{children}</div>
    </details>
  );
}

function ClipBoundInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
}) {
  return (
    <input
      type="number"
      step="any"
      placeholder={placeholder}
      value={value ?? ''}
      onChange={(e) => {
        const v = parseFloat(e.target.value);
        onChange(Number.isFinite(v) ? v : null);
      }}
      className="w-full min-w-0 px-1.5 py-0.5 rounded bg-surface border border-border text-text-primary text-[10px] mono placeholder:text-text-muted focus:outline-none focus:border-accent-blue/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
    />
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
/**
 * Field-by-field equality check for two CameraIntrinsics snapshots.
 *
 * Used to coalesce identical playhead updates so the camera-frustum
 * lifecycle effect doesn't re-trigger on every tick when the publisher
 * is sending the same CameraInfo at 30 Hz (the common case).
 */
function cameraIntrinsicsEqual(a: CameraIntrinsics, b: CameraIntrinsics): boolean {
  if (a.fx !== b.fx || a.fy !== b.fy || a.cx !== b.cx || a.cy !== b.cy) return false;
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.frameId !== b.frameId) return false;
  if (a.distortionModel !== b.distortionModel) return false;
  if (a.distortionCoefficients.length !== b.distortionCoefficients.length) return false;
  for (let i = 0; i < a.distortionCoefficients.length; i++) {
    if (a.distortionCoefficients[i] !== b.distortionCoefficients[i]) return false;
  }
  return true;
}

/**
 * Hidden helper: read one `sensor_msgs/CameraInfo` topic via
 * `useMessageAtTime` and push the parsed intrinsics into the panel's
 * shared map. One component per topic so we can satisfy rules-of-hooks
 * (hooks called unconditionally per fixed identity) while still
 * supporting an arbitrary number of cameras per bag.
 */
function CameraInfoFeed({
  topic,
  bagId,
  playheadNs,
  onUpdate,
}: {
  topic: string;
  bagId: string | undefined;
  playheadNs: bigint;
  onUpdate: (topic: string, info: CameraIntrinsics | null) => void;
}) {
  const message = useMessageAtTime(topic, playheadNs, bagId);
  useEffect(() => {
    if (!message.message?.value) {
      onUpdate(topic, null);
      return;
    }
    const info = parseCameraInfo(
      message.message.value,
      message.message.timestamp,
    );
    onUpdate(topic, info);
  }, [topic, message.message, onUpdate]);
  useEffect(() => {
    // Cleanup: drop this topic's entry when the feed unmounts (bag swap).
    return () => onUpdate(topic, null);
  }, [topic, onUpdate]);
  return null;
}

