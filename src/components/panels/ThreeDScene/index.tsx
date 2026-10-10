import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useBagStore, resolveBagEntry } from '../../../store/bagStore';
import { useBagLocalPlayhead } from '../../../hooks/useBagLocalPlayhead';
import { OverlayCard } from '../shared/OverlayCard';
import { PanelErrorState } from '../shared/PanelStates';
import {
  useThreeDPanelStore,
  type MapColorSchemeChoice,
  type PoseDisplayStyle,
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
} from './sceneKind';
import { useRobotModelStore } from '../../../store/robotModelStore';
import { useJointStates } from '../../../hooks/useJointStates';
import {
  buildRobotSubtree,
  type RobotSubtree,
  type RobotSubtreeWarning,
} from './robotModel';
import { PanelShell } from '../PanelShell';
import { getTopicColor } from '../../../utils/color';
import { nsToSeconds } from '../../../utils/time';
import { useMessageAtTime } from '../../../hooks/useMessageAtTime';
import { useTopicMessages } from '../../../hooks/useTopicMessages';
import { useTFGraph } from '../TFTree/useTFGraph';
import type { ColorMode } from '../../../utils/pointcloud';
import { useScene, MIN_ZOOM_LEVEL, MAX_ZOOM_LEVEL } from './useScene';
import {
  pickScenePoint,
} from './measureTool';
import {
  computeFit,
  createGroundGrid,
  createLaserScan,
  createPointCloud,
  createPoseAxes,
  createWorldAxes,
  disposeObject,
  extractPose,
  pickFrameId,
  setCloudStyle,
  setPoseAxesColor,
  setPoseAxesStyle,
  updateCloud,
  updatePoseAxes,
  type CloudObject,
  type PoseAxesObject,
} from './sceneObjects';
import { buildAxisClip } from './clipBox';
import { applyTransform, pickWorldFrame } from './tfTransform';
import { useDecodedCloud } from './useDecodedPointCloud';
import { SpatialOverlay } from './spatialOverlay';
import {
  getSpatialOverlayCandidates,
  overlayKey,
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
import { ControlsCard } from './DisplayCard';
import { useMeasureTool } from './useMeasureTool';
import { usePointInspector } from './usePointInspector';
import { useCameraFrustums } from './useCameraFrustums';
import { CameraInfoFeed } from './CameraInfoFeed';
import {
  computeMarkerBounds,
  findCutoffIndex,
  makeUpFix,
  pickMarkerFrame,
  upAxisToHeightAxis,
} from './sceneHelpers';

interface ThreeDSceneProps {
  panelId: string;
  topicName: string;
  type: string;
  /** Which bag the panel reads from (multi-bag). Defaults to focused bag. */
  bagId?: string;
}

/**
 * Hard cap on marker messages we decode for a panel: 50,000. Real-world bags
 * rarely exceed a few thousand MarkerArray messages per topic; the cap exists
 * so a pathological bag (debug topic publishing at 100 Hz for an hour, which
 * is 360k messages) doesn't OOM the worker. Hitting it just means
 * later-than-cutoff markers won't appear when scrubbing past the limit.
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

/**
 * ThreeDScene - Three.js-powered 3D viewer for spatial ROS2 topics.
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
  // forces a remount of this panel - local useState would reset to defaults
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
    poseDisplayStyle,
    poseFlattenOrientation,
    showPoseAxesTripod,
    poseColor,
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
  // Toggle helpers read the *fresh* store entry (not this render's closure)
  // so rapid successive updates - e.g. several namespace chips flipped in one
  // tick - each build on the previous write instead of a stale snapshot.
  const freshSettings = () =>
    useThreeDPanelStore.getState().byId[panelId] ?? effectiveDefaults;
  const toggleNamespaceHidden = (ns: string, hidden: boolean) => {
    const cur = new Set(freshSettings().hiddenMarkerNamespaces);
    if (hidden) cur.add(ns);
    else cur.delete(ns);
    updateSettings(panelId, { hiddenMarkerNamespaces: Array.from(cur).sort() });
  };
  // "Show all": one patch clearing the whole list. Looping
  // `toggleNamespaceHidden` here would recompute every write from the same
  // stale render-captured array, so all but the last chip would reappear.
  const showAllNamespaces = () =>
    updateSettings(panelId, { hiddenMarkerNamespaces: [] });
  const setMapAlpha = (v: number) => updateSettings(panelId, { mapAlpha: v });
  const setMapColorScheme = (v: MapColorSchemeChoice) =>
    updateSettings(panelId, { mapColorScheme: v });
  const setShowRobotMarkers = (v: boolean) => updateSettings(panelId, { showRobotMarkers: v });
  const setPoseDisplayStyle = (v: PoseDisplayStyle) =>
    updateSettings(panelId, { poseDisplayStyle: v });
  const setPoseFlattenOrientation = (v: boolean) =>
    updateSettings(panelId, { poseFlattenOrientation: v });
  const setShowPoseAxesTripod = (v: boolean) =>
    updateSettings(panelId, { showPoseAxesTripod: v });
  const setPoseColor = (v: string | null) => updateSettings(panelId, { poseColor: v });
  const setCameraFrustumsOn = (v: boolean) =>
    updateSettings(panelId, { cameraFrustumsOn: v });
  const setCameraFrustumFar = (v: number) =>
    updateSettings(panelId, { cameraFrustumFar: v });
  const toggleFrustumTopicHidden = (t: string, hidden: boolean) => {
    const cur = new Set(freshSettings().hiddenFrustumTopics);
    if (hidden) cur.add(t);
    else cur.delete(t);
    updateSettings(panelId, { hiddenFrustumTopics: Array.from(cur).sort() });
  };
  const toggleSpatialOverlay = (candidateBagId: string, topic: string, visible: boolean) => {
    const key = overlayKey(candidateBagId, topic);
    const current = new Set(freshSettings().spatialOverlayTopics);
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
    const styles = freshSettings().spatialOverlayStyles;
    updateSettings(panelId, {
      spatialOverlayStyles: {
        ...styles,
        [key]: { ...styles[key], ...patch },
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

  // Built inside useMemo: `useDecodedCloud` lists `axisClip` in its effect
  // deps, so a fresh object every paint would re-fire the worker decode on
  // each render in a self-sustaining loop.
  const axisClip = useMemo(
    () =>
      buildAxisClip({
        clipBoxOn,
        clipXMin,
        clipXMax,
        clipYMin,
        clipYMax,
        clipZMin,
        clipZMax,
      }),
    [clipBoxOn, clipXMin, clipXMax, clipYMin, clipYMax, clipZMin, clipZMax],
  );

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
  // Height colormap follows the up-axis - picking "-X up" means the most
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
    // PointCloud2 / CustomCloud - pass it conditionally to keep scans' cache
    // key minimal.
    heightAxis: sceneKind === 'pointcloud' ? heightAxis : undefined,
    axisClip: sceneKind === 'pointcloud' ? axisClip : undefined,
    bagId,
    // Only cloud-shaped panels want the worker decode; pose / map / marker
    // panels mount this hook unconditionally (rules of hooks) and pass false
    // so they don't burn a round-trip per playhead tick on unread results.
    enabled: isCloud,
  });
  const poseState = useMessageAtTime(topicName, playheadNs, bagId);
  // Marker streams are unlike clouds and poses: every marker persists in the
  // scene until DELETE or lifetime expiry, so we need the full history up to
  // the playhead - not just the message at the playhead. The hook is gated
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

  // Dedupe accumulator appends - the cloud-effect can fire on the same
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
      // Accumulator only makes sense for full point clouds - laser scans
      // already represent a single 2D ring per frame and don't benefit much
      // from running concatenation.
      owned.accumulator = new CloudAccumulator(accumBudget, pointSize);
      owned.accumulator.object.visible = false;
      refs.worldGroup.add(owned.accumulator.object);
    } else if (sceneKind === 'laserscan') {
      owned.cloud = createLaserScan(pointSize);
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
    } else if (sceneKind === 'path') {
      // Drawn by the <SpatialOverlay> mounted for the primary topic below, so
      // a path looks identical whether it is the panel's topic or an overlay.
    } else {
      owned.poseAxes = createPoseAxes(1.0, bagEntry?.color ?? '#ffffff');
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
      setCloudStyle(owned.cloud, pointSize, sceneKind === 'laserscan' ? laserScanColor : null);
    }
    if (owned.accumulator) owned.accumulator.setPointSize(pointSize);
    refs.renderOnce();
  }, [laserScanColor, pointSize, sceneKind, sceneRef]);

  // Pose display style (arrow/robot) + orientation-tripod visibility + color.
  useEffect(() => {
    const owned = objectsRef.current;
    const refs = sceneRef.current;
    if (!refs || !owned?.poseAxes) return;
    setPoseAxesStyle(owned.poseAxes, poseDisplayStyle, showPoseAxesTripod);
    setPoseAxesColor(owned.poseAxes, poseColor ?? bagEntry?.color ?? '#ffffff');
    refs.renderOnce();
  }, [poseDisplayStyle, showPoseAxesTripod, poseColor, bagEntry?.color, sceneRef]);

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
  // panel renders into actually *changes* - world frame, topic, or up-axis.
  // Both the accumulator's stored points and the pivot are expressed in
  // render-space coordinates that get invalidated by any of these changes.
  //
  // We compare against the previous deps via a ref so we don't clear on the
  // initial mount (or on a remount, when settings are being restored from
  // the per-panel store). Without this, a remount triggered by adding a
  // sibling panel would silently null out the user's pivot.
  // Measure tool state lives up here because the coordinate-change effect below clears it.
  const { measureOn, setMeasureOn, measurePts, setMeasurePts, measureReadout } = useMeasureTool(sceneRef, objectsRef);

  const hoveredPoint = usePointInspector({
    sceneRef,
    getCloudObject: () => objectsRef.current?.cloud?.object ?? null,
    cloud,
    enabled: sceneKind === 'pointcloud' && !measureOn,
  });

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
    setMeasurePts([]);
    refs.renderOnce();
  }, [worldFrame, topicName, upAxis, sceneRef, setPivot, setMeasurePts]);

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
  // nothing's hit - e.g. the user clicked empty space - we fall back to the
  // z=0 ground plane, which is the conventional ROS world floor.
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    const canvas = refs.renderer.domElement;
    const handlePointerDown = (event: PointerEvent) => {
      if (!event.shiftKey || event.button !== 0) return;
      // Block OrbitControls from interpreting this as a drag-start.
      event.preventDefault();
      event.stopPropagation();

      // Try both the live frame and the accumulated cloud - either is fair
      // game as a pivot target.
      const targets: THREE.Object3D[] = [];
      const cloudObj = objectsRef.current?.cloud?.object;
      const accumObj = objectsRef.current?.accumulator?.object;
      if (cloudObj) targets.push(cloudObj);
      if (accumObj && accumObj.visible) targets.push(accumObj);
      const viewRadius = refs.camera.position.distanceTo(refs.controls.target);
      const hit = pickScenePoint(refs.camera, viewRadius, canvas, event.clientX, event.clientY, targets);
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
    // coordinates - consistent with the live frame and with previously
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
  // playhead ticks that hit the same map message don't re-upload - typical
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

    updateMapPlane(owned.mapPlane, decoded, scheme);
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
      updatePoseAxes(owned.poseAxes, pose, poseFlattenOrientation);
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
  }, [poseMessage, graph, worldFrame, type, sceneRef, upFixMatrix, poseFlattenOrientation]);

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
  //      to the new cutoff - replaying selected ranges is messier than it
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

  // Clear the watermark when the topic / panel mounts - re-ingest happens
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
  // Non-fatal URDF build warnings (missing links, unloadable meshes), surfaced
  // as an amber hint in the Overlays section instead of being dropped.
  const [robotWarnings, setRobotWarnings] = useState<RobotSubtreeWarning[]>([]);

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
        setRobotWarnings([]);
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
      // Read the hide flag from the store, not this effect's closure: the
      // closure captured whatever `robotHidden` was when the effect ran, so
      // a toggle during the async build would be overwritten on arrival.
      subtree.root.visible = !useRobotModelStore.getState().hiddenInPanel[panelId];
      refs.worldGroup.add(subtree.root);
      setRobotWarnings(subtree.warnings);
      // Force the per-tick transform effect below to re-apply at first paint.
      robotTransformCacheRef.current = null;
      refs.renderOnce();
    });

    return () => {
      cancelled = true;
    };
    // Only rebuild when the loaded URDF or the scene mount changes. The hide
    // flag has its own visibility effect below, and the panel's scene kind
    // never changes after mount (kinds are fixed per topic), so neither
    // belongs here: each extra dep meant a full async rebuild (mesh loads)
    // for a setting that only toggles `visible`.
  }, [sceneRef, robotModel, panelId]);

  // Unmount-only: dispose the robot subtree. Declared after `useScene` (whose
  // teardown detaches `externallyOwned` nodes before its own dispose pass), so
  // React runs that detach first and this cleanup only frees what the subtree
  // owns. Deliberately NOT the build effect's cleanup above: that one must
  // keep working for mid-life rebuilds (model swap, scene remount), where the
  // incoming build disposes the previous tree itself.
  useEffect(() => {
    return () => {
      const subtree = robotRef.current;
      if (!subtree) return;
      subtree.dispose();
      robotRef.current = null;
    };
  }, []);

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
  const { cameraInfoTopics, handleCameraInfoUpdate } = useCameraFrustums({
    sceneRef,
    bag,
    graph,
    worldFrame,
    playheadNs,
    upFixMatrix,
    cameraFrustumsOn,
    cameraFrustumFar,
    hiddenFrustumTopics,
  });

  // First-frame autofit. Subsequent frames leave the camera alone so playback
  // doesn't yank the view around.
  const hasAutoFitRef = useRef(false);
  useEffect(() => {
    if (hasAutoFitRef.current) return;
    const refs = sceneRef.current;
    if (!refs || !stats.bounds) return;
    const { target, radius } = computeFit(stats.bounds, refs.userGroup.matrix);
    refs.resetCamera(target, radius);
    // Re-apply a stored custom pivot after the fit so a reopened panel orbits
    // around the point the user picked, not the fit centre. The first-line
    // guard means later pivot edits (shift+click, reset) never re-run the fit.
    if (pivot) refs.setOrbitTarget(new THREE.Vector3(pivot.x, pivot.y, pivot.z));
    hasAutoFitRef.current = true;
  }, [stats.bounds, pivot, sceneRef]);

  const accent = getTopicColor(topicName, type);
  const startNs = bag?.startTime ?? 0n;

  const handleResetCamera = () => {
    const refs = sceneRef.current;
    if (!refs) return;
    const { target, radius } = computeFit(stats.bounds, refs.userGroup.matrix);
    refs.resetCamera(target, radius);
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
    const { target } = computeFit(stats.bounds, refs.userGroup.matrix);
    refs.setOrbitTarget(target);
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
  // type; the point count is only shown for the two kinds where `stats.points`
  // really is a point count (on a map it is a cell count, on a pose it is a
  // hard-coded 1, so including it made the summary read "Pose scene, 1 points").
  const countsPoints = sceneKind === 'pointcloud' || sceneKind === 'laserscan';
  const sceneSummary = `${SCENE_KIND_LABELS[sceneKind]} scene${
    stats.sourceFrame ? `, frame ${stats.sourceFrame}` : ''
  }${countsPoints && stats.points > 0 ? `, ${stats.points.toLocaleString()} points` : ''}`;

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
      {sceneReady && sceneKind === 'path' && (
        <SpatialOverlay
          key="primary-path"
          topic={{ bagId: resolvedBagId ?? '', name: topicName, type }}
          sceneRef={sceneRef}
          worldFrame={worldFrame}
          upFixMatrix={upFixMatrix}
          colorMode={colorMode}
          pointSize={pointSize}
          style={spatialOverlayStyles[overlayKey(resolvedBagId ?? '', topicName)]}
          heightAxis={heightAxis}
          mapAlpha={mapAlpha}
          showPoseAxesTripod={showPoseAxesTripod}
        />
      )}
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
            showPoseAxesTripod={showPoseAxesTripod}
          />
        ))}
      {sceneReady &&
        showRobotMarkers &&
        overlayBagMeta.size > 1 &&
        bagOrder.filter((id) => allBags.has(id)).map((id) => (
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
        <div className="flex-1 min-h-[260px] relative bg-bg-primary/60 overflow-hidden group">
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

          <div className="absolute top-2 right-2 flex flex-col gap-1.5 items-end opacity-0 pointer-coarse:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
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
              <button
                type="button"
                aria-pressed={measureOn}
                onClick={() => {
                  setMeasureOn((v) => !v);
                  setMeasurePts([]);
                }}
                className={
                  measureOn
                    ? 'px-2 py-1 rounded-md text-xs mono border border-accent-amber/60 bg-accent-amber/15 text-accent-amber'
                    : 'px-2 py-1 rounded-md text-xs mono bg-surface/80 border border-border hover:border-accent-blue/40 hover:text-accent-blue text-text-secondary transition-colors'
                }
                title="Measure the distance between two points (Esc clears)"
              >
                Measure
              </button>
            </div>
            <label className="flex items-center gap-2 rounded-md border border-border bg-surface/80 px-2 py-1 text-[10px] mono text-text-tertiary">
              <span>zoom</span>
              <input
                type="range"
                aria-label="Zoom"
                min={Math.log2(MIN_ZOOM_LEVEL)}
                max={Math.log2(MAX_ZOOM_LEVEL)}
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
              onShowAllNamespaces={showAllNamespaces}
              mapAlpha={mapAlpha}
              setMapAlpha={setMapAlpha}
              mapColorScheme={mapColorScheme}
              setMapColorScheme={setMapColorScheme}
              showRobotMarkers={showRobotMarkers}
              setShowRobotMarkers={setShowRobotMarkers}
              multiBag={overlayBagMeta.size > 1}
              poseDisplayStyle={poseDisplayStyle}
              setPoseDisplayStyle={setPoseDisplayStyle}
              poseFlattenOrientation={poseFlattenOrientation}
              setPoseFlattenOrientation={setPoseFlattenOrientation}
              showPoseAxesTripod={showPoseAxesTripod}
              setShowPoseAxesTripod={setShowPoseAxesTripod}
              poseColor={poseColor}
              setPoseColor={setPoseColor}
              bagColor={bagEntry?.color ?? '#ffffff'}
              spatialOverlayCandidates={spatialOverlayCandidates}
              spatialOverlayTopics={spatialOverlayTopics}
              onToggleSpatialOverlay={toggleSpatialOverlay}
              spatialOverlayStyles={spatialOverlayStyles}
              onSetSpatialOverlayStyle={setSpatialOverlayStyle}
              overlayBagMeta={overlayBagMeta}
              selectedOverlayCount={selectedSpatialOverlays.length}
              hasPointCloudLayer={hasPointCloudLayer}
              hasPointLayer={hasPointLayer}
              hasMapLayer={hasMapLayer}
              hasRobotModel={!!robotModel}
              robotName={robotModel?.sourceName ?? null}
              robotHidden={robotHidden}
              setRobotHidden={(hidden) => setRobotHidden(panelId, hidden)}
              robotWarnings={robotWarnings}
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

          {hoveredPoint && (
            <div
              className="pointer-events-none absolute z-10 rounded-md border border-border bg-surface/95 px-2 py-1 text-[10px] mono leading-tight text-text-secondary shadow-panel"
              style={{ left: hoveredPoint.x + 12, top: hoveredPoint.y + 12 }}
              data-testid="point-inspector"
              role="status"
            >
              <div className="text-text-primary">point {hoveredPoint.index.toLocaleString()}</div>
              <div>
                x {hoveredPoint.position.x.toFixed(3)}  y {hoveredPoint.position.y.toFixed(3)}  z{' '}
                {hoveredPoint.position.z.toFixed(3)} m
              </div>
              {hoveredPoint.intensity !== null && <div>intensity {Number(hoveredPoint.intensity.toPrecision(5))}</div>}
              {hoveredPoint.ring !== null && <div>ring {hoveredPoint.ring}</div>}
              <div className="text-text-muted">{topicName}</div>
            </div>
          )}
          {measureOn && (
            <div
              className="absolute bottom-2 left-2 right-2 rounded-md border border-accent-amber/40 bg-surface/90 px-2 py-1 text-[10px] mono text-text-secondary"
              data-testid="measure-readout"
              role="status"
            >
              {measureReadout ??
                (measurePts.length === 1 ? 'Click a second point' : 'Click two points to measure')}
            </div>
          )}
          <OverlayCard variant="subtle" className="absolute top-2 left-2 text-text-muted text-[10px] mono leading-tight px-2 py-1 max-w-[60%]">
            <div className="text-text-secondary">
              {SCENE_KIND_LABELS[sceneKind]}
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
              <div className="text-text-tertiary">no /tf - rendering in topic frame</div>
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
                  : sceneKind === 'path'
                    ? `${type.split('/').pop()} layer`
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
