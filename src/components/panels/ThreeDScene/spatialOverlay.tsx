import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { useMessageAtTime } from '../../../hooks/useMessageAtTime';
import type { SpatialOverlayStyle } from '../../../store/threeDPanelStore';
import type { AxisClip, ColorMode, HeightAxis } from '../../../utils/pointcloud';
import {
  decodeOccupancyGrid,
  type OccupancyGridMessage,
} from '../../../utils/occupancyGrid';
import type { TFGraph } from '../TFTree/useTFGraph';
import {
  createLaserScan,
  createPointCloud,
  createPoseAxes,
  disposeObject,
  setCloudStyle,
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
  type MapPlaneObject,
} from './mapPlane';
import { detectKind } from './sceneKind';
import { useDecodedCloud } from './useDecodedPointCloud';
import { applyTransform } from './tfTransform';
import type { SceneRefs } from './useScene';
import type { SpatialOverlayTopic } from './spatialOverlayTopics';

interface SpatialOverlayProps {
  topic: SpatialOverlayTopic;
  bagId?: string;
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
}

/**
 * Renders a selected map, cloud, scan, or pose topic in an existing 3D
 * panel. Each layer owns an independent group so TF can place all topics in
 * the panel's selected world frame.
 */
export function SpatialOverlay(props: SpatialOverlayProps) {
  const kind = detectKind(props.topic.type);
  if (kind === 'pointcloud' || kind === 'laserscan') {
    return <CloudOverlay {...props} kind={kind} />;
  }
  if (kind === 'occupancygrid') return <MapOverlay {...props} />;
  if (kind === 'markerarray') return null;
  return <PoseOverlay {...props} />;
}

function CloudOverlay({
  topic,
  bagId,
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
    bagId,
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
    setCloudStyle(
      owned.cloud,
      kind === 'laserscan' ? layerPointSize + 1 : layerPointSize,
      style?.color,
    );
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
  bagId,
  playheadNs,
  sceneRef,
  graph,
  worldFrame,
  upFixMatrix,
  mapAlpha,
}: SpatialOverlayProps) {
  const state = useMessageAtTime(topic.name, playheadNs, bagId);
  const ownedRef = useRef<{ group: THREE.Group; map: MapPlaneObject } | null>(null);
  const transformCache = useRef<{ key: string; matrix: THREE.Matrix4 } | null>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const group = new THREE.Group();
    group.name = `overlay:${topic.name}`;
    const map = createMapPlane();
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
    const decoded = decodeOccupancyGrid(message.value as OccupancyGridMessage);
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
  }, [graph, sceneRef, state.message, upFixMatrix, worldFrame]);

  return null;
}

function PoseOverlay({
  topic,
  bagId,
  playheadNs,
  sceneRef,
  graph,
  worldFrame,
  upFixMatrix,
}: SpatialOverlayProps) {
  const state = useMessageAtTime(topic.name, playheadNs, bagId);
  const ownedRef = useRef<{ group: THREE.Group; pose: PoseAxesObject } | null>(null);
  const transformCache = useRef<{ key: string; matrix: THREE.Matrix4 } | null>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const group = new THREE.Group();
    group.name = `overlay:${topic.name}`;
    const pose = createPoseAxes(1);
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
  }, [sceneRef, topic.name]);

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
    updatePoseAxes(owned.pose, pose);
    scene.renderOnce();
  }, [graph, sceneRef, state.message, topic.type, upFixMatrix, worldFrame]);

  return null;
}

function pickFrameId(value: Record<string, unknown>): string | null {
  const header = value.header as { frame_id?: unknown } | undefined;
  return typeof header?.frame_id === 'string' && header.frame_id.length > 0
    ? header.frame_id
    : null;
}
