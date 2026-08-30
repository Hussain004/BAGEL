import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useBagStore, resolveBagEntry } from '../../../store/bagStore';
import { useBagLocalPlayhead } from '../../../hooks/useBagLocalPlayhead';
import { useMessageAtTime } from '../../../hooks/useMessageAtTime';
import type { SpatialOverlayStyle } from '../../../store/threeDPanelStore';
import type { AxisClip, ColorMode, HeightAxis } from '../../../utils/pointcloud';
import {
  classifyMapPlaneTier,
  decodeOccupancyGrid,
  resolveOccupancyGridScheme,
  type OccupancyGridMessage,
} from '../../../utils/occupancyGrid';
import { useTFGraph, type TFGraph } from '../TFTree/useTFGraph';
import {
  createLaserScan,
  createPointCloud,
  createPoseAxes,
  disposeObject,
  setCloudStyle,
  setPoseAxesColor,
  setPoseAxesStyle,
  extractPose,
  updateCloud,
  updatePoseAxes,
  type CloudObject,
  type PoseAxesObject,
} from './sceneObjects';
import {
  createMapPlane,
  disposeMapPlane,
  setMapPlaneOpacity,
  updateMapPlane,
  MAP_PLANE_RENDER_ORDER,
  type MapPlaneObject,
} from './mapPlane';
import { detectKind } from './sceneKind';
import { useDecodedCloud } from './useDecodedPointCloud';
import { applyTransform } from './tfTransform';
import type { SceneRefs } from './useScene';
import type { SpatialOverlayTopic } from './spatialOverlayTopics';

interface SpatialOverlayProps {
  topic: SpatialOverlayTopic;
  playheadNs: bigint;
  sceneRef: RefObject<SceneRefs | null>;
  graph: TFGraph | null;
  worldFrame: string | null;
  upFixMatrix: THREE.Matrix4;
  colorMode: ColorMode;
  pointSize: number;
  maxRange?: number;
  heightAxis: HeightAxis;
  axisClip?: AxisClip;
  mapAlpha: number;
  style?: SpatialOverlayStyle;
  /** Show the small XYZ tripod next to pose displays (panel-wide setting). */
  showPoseAxesTripod: boolean;
}

/**
 * Public props: `graph` and `playheadNs` are resolved internally against the
 * topic's own bag, not supplied by the caller.
 */
type SpatialOverlayOwnProps = Omit<SpatialOverlayProps, 'graph' | 'playheadNs'>;

/**
 * Renders a selected map, cloud, scan, or pose topic in an existing 3D
 * panel. Each layer owns an independent group so TF can place all topics in
 * the panel's selected world frame.
 *
 * The overlay's topic can belong to a *different* bag than the panel it's
 * drawn in (multi-bag overlay, e.g. three robots' costmaps on one map), so
 * TF and playhead resolution both use the topic's own bag, not the panel's:
 * each robot's graph independently reaches the shared `worldFrame` (typically
 * "map"), and its playhead offset differs from the panel's under bag-start
 * or anchor alignment.
 */
export function SpatialOverlay(props: SpatialOverlayOwnProps) {
  const { graph } = useTFGraph(props.topic.bagId, props.topic.name);
  const playheadNs = useBagLocalPlayhead(props.topic.bagId);
  const kind = detectKind(props.topic.type);
  if (kind === 'pointcloud' || kind === 'laserscan') {
    return <CloudOverlay {...props} graph={graph} playheadNs={playheadNs} kind={kind} />;
  }
  if (kind === 'occupancygrid') return <MapOverlay {...props} graph={graph} playheadNs={playheadNs} />;
  if (kind === 'markerarray') return null;
  return <PoseOverlay {...props} graph={graph} playheadNs={playheadNs} />;
}

function CloudOverlay({
  topic,
  playheadNs,
  sceneRef,
  graph,
  worldFrame,
  upFixMatrix,
  colorMode,
  pointSize,
  style,
  maxRange,
  heightAxis,
  axisClip,
  kind,
}: SpatialOverlayProps & { kind: 'pointcloud' | 'laserscan' }) {
  const state = useDecodedCloud({
    kind,
    topicName: topic.name,
    timeNs: playheadNs,
    colorMode: kind === 'pointcloud' ? colorMode : undefined,
    maxRange: kind === 'pointcloud' ? maxRange : undefined,
    heightAxis: kind === 'pointcloud' ? heightAxis : undefined,
    axisClip: kind === 'pointcloud' ? axisClip : undefined,
    bagId: topic.bagId,
  });
  const ownedRef = useRef<{ group: THREE.Group; cloud: CloudObject } | null>(null);
  const transformCache = useRef<{ key: string; matrix: THREE.Matrix4 } | null>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const group = new THREE.Group();
    group.name = `overlay:${topic.name}`;
    const cloud = kind === 'pointcloud'
      ? createPointCloud(1)
      : createLaserScan(2);
    group.add(cloud.object);
    scene.scene.add(group);
    ownedRef.current = { group, cloud };
    scene.renderOnce();

    return () => {
      scene.scene.remove(group);
      disposeObject(group);
      ownedRef.current = null;
      scene.renderOnce();
    };
  }, [kind, sceneRef, topic.name]);

  useEffect(() => {
    const scene = sceneRef.current;
    const owned = ownedRef.current;
    if (!scene || !owned) return;
    const layerPointSize = style?.pointSize ?? pointSize;
    setCloudStyle(owned.cloud, layerPointSize, style?.color);
    scene.renderOnce();
  }, [kind, pointSize, sceneRef, style]);

  useEffect(() => {
    const scene = sceneRef.current;
    const owned = ownedRef.current;
    const cloud = state.cloud;
    if (!scene || !owned || !cloud) return;
    applyTransform(
      owned.group,
      graph,
      cloud.frameId ?? null,
      worldFrame,
      cloud.timestamp,
      transformCache,
      upFixMatrix,
    );
    updateCloud(owned.cloud, cloud);
    scene.renderOnce();
  }, [graph, sceneRef, state.cloud, upFixMatrix, worldFrame]);

  return null;
}

function MapOverlay({
  topic,
  playheadNs,
  sceneRef,
  graph,
  worldFrame,
  upFixMatrix,
  mapAlpha,
  style,
}: SpatialOverlayProps) {
  const state = useMessageAtTime(topic.name, playheadNs, topic.bagId);
  const ownedRef = useRef<{ group: THREE.Group; map: MapPlaneObject } | null>(null);
  const transformCache = useRef<{ key: string; matrix: THREE.Matrix4 } | null>(null);
  const scheme = resolveOccupancyGridScheme(style?.mapColorScheme ?? 'auto', topic.name);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const group = new THREE.Group();
    group.name = `overlay:${topic.name}`;
    const map = createMapPlane(MAP_PLANE_RENDER_ORDER[classifyMapPlaneTier(topic.name)]);
    setMapPlaneOpacity(map, 1);
    group.add(map.object);
    scene.scene.add(group);
    ownedRef.current = { group, map };
    scene.renderOnce();

    return () => {
      scene.scene.remove(group);
      disposeMapPlane(map);
      ownedRef.current = null;
      scene.renderOnce();
    };
  }, [sceneRef, topic.name]);

  useEffect(() => {
    const scene = sceneRef.current;
    const owned = ownedRef.current;
    if (!scene || !owned) return;
    setMapPlaneOpacity(owned.map, mapAlpha);
    scene.renderOnce();
  }, [mapAlpha, sceneRef]);

  useEffect(() => {
    const scene = sceneRef.current;
    const owned = ownedRef.current;
    const message = state.message;
    if (!scene || !owned || !message?.value) return;
    const decoded = decodeOccupancyGrid(message.value as OccupancyGridMessage, scheme);
    if (!decoded) return;
    applyTransform(
      owned.group,
      graph,
      pickFrameId(message.value),
      worldFrame,
      message.timestamp,
      transformCache,
      upFixMatrix,
    );
    updateMapPlane(owned.map, decoded);
    scene.renderOnce();
  }, [graph, sceneRef, state.message, upFixMatrix, worldFrame, scheme]);

  return null;
}

function PoseOverlay({
  topic,
  playheadNs,
  sceneRef,
  graph,
  worldFrame,
  upFixMatrix,
  style,
  showPoseAxesTripod,
}: SpatialOverlayProps) {
  const state = useMessageAtTime(topic.name, playheadNs, topic.bagId);
  const bagColor = useBagStore((s) => resolveBagEntry(s, topic.bagId)?.color ?? '#ffffff');
  const color = style?.color ?? bagColor;
  const ownedRef = useRef<{ group: THREE.Group; pose: PoseAxesObject } | null>(null);
  const transformCache = useRef<{ key: string; matrix: THREE.Matrix4 } | null>(null);
  const poseDisplayStyle = style?.poseDisplayStyle ?? 'arrow';
  const flattenOrientation = style?.poseFlattenOrientation ?? false;

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const group = new THREE.Group();
    group.name = `overlay:${topic.name}`;
    const pose = createPoseAxes(1, color);
    group.add(pose.object);
    scene.scene.add(group);
    ownedRef.current = { group, pose };
    scene.renderOnce();

    return () => {
      scene.scene.remove(group);
      disposeObject(group);
      ownedRef.current = null;
      scene.renderOnce();
    };
    // initial color only - the style effect below keeps it in sync afterward.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneRef, topic.name]);

  useEffect(() => {
    const owned = ownedRef.current;
    const scene = sceneRef.current;
    if (!scene || !owned) return;
    setPoseAxesStyle(owned.pose, poseDisplayStyle, showPoseAxesTripod);
    setPoseAxesColor(owned.pose, color);
    scene.renderOnce();
  }, [poseDisplayStyle, showPoseAxesTripod, color, sceneRef]);

  useEffect(() => {
    const scene = sceneRef.current;
    const owned = ownedRef.current;
    const message = state.message;
    if (!scene || !owned || !message?.value) return;
    const pose = extractPose(message.value, topic.type);
    if (!pose) return;
    applyTransform(
      owned.group,
      graph,
      pickFrameId(message.value),
      worldFrame,
      message.timestamp,
      transformCache,
      upFixMatrix,
    );
    updatePoseAxes(owned.pose, pose, flattenOrientation);
    scene.renderOnce();
  }, [graph, sceneRef, state.message, topic.type, upFixMatrix, worldFrame, flattenOrientation]);

  return null;
}

function pickFrameId(value: Record<string, unknown>): string | null {
  const header = value.header as { frame_id?: unknown } | undefined;
  return typeof header?.frame_id === 'string' && header.frame_id.length > 0
    ? header.frame_id
    : null;
}
