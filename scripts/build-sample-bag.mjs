/**
 * Build the sample MCAP bundled with BAGEL as "Explore sample data".
 *
 * A 30 second synthetic robot run through a small street scene. Every sensor
 * sees the SAME analytic world (scripts/sample-world.mjs), so the pieces agree
 * with each other: LiDAR points land on the buildings and cars in the camera
 * image, the detections box the cars and people you can see, and the map shows
 * what the robot has scanned.
 *
 *   /lidar/points (PointCloud2)       4 Hz, 16-beam sweep with intensity
 *   /camera/image_raw (Image)         2 Hz, 320x240 rendered view with barrel
 *                                     distortion baked in ("undistort" works)
 *   /camera/camera_info (CameraInfo)  auto-pairs with the image; K, D, frame
 *   /detections (Detection2DArray)    2 Hz, boxes for cars and people
 *   /detections_3d (Detection3DArray) 2 Hz, the same cars and people as 3D boxes
 *   /robot/mode (std_msgs/String)     IDLE / EXPLORING / AVOIDING / RETURNING
 *   /battery (BatteryState)           drains through 20% near the end
 *   /rosout (rcl_interfaces/Log)      the story in log lines
 *   /plan (nav_msgs/Path)             the route ahead, in 3D
 *   /particles (PoseArray)            a localisation particle cloud
 *   /odom, /imu/data, /scan, /tf, /markers, /map, /gps/fix,
 *   /camera_rear/camera_info          as before
 *
 * Things to try: play it; project /lidar/points onto the camera; use Find on
 * /battery to jump to when it fell below 20%; open /robot/mode as a state
 * timeline; plot /odom x against y.
 *
 * Run:    node scripts/build-sample-bag.mjs
 * Output: public/sample-bags/tour.mcap  (zstd-compressed chunks)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { zstdCompressSync } from 'node:zlib';

import { McapWriter } from '@mcap/core';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';
import rosmsgCommon from '@foxglove/rosmsg-msgs-common';

import {
  CAM,
  CAMERA_MOUNT,
  LIDAR_MOUNT,
  castRay,
  MODES,
  OPTICAL_QUAT,
  detect,
  detect3d,
  figureEightPose,
  hash01,
  lidarSweep,
  mountWorld,
  occupiedAt,
  renderCamera,
  toWorldDir,
} from './sample-world.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUTPUT_PATH = join(REPO_ROOT, 'public', 'sample-bags', 'tour.mcap');

// ── Bag parameters ───────────────────────────────────────────────────────
const DURATION_SEC = 30;
const ODOM_HZ = 10;
const IMU_HZ = 50;
const SCAN_HZ = 10;
const TF_HZ = 10;
// Markers tick slowly - they're persistent in the scene and the renderer just
// MODIFYs the existing entries each tick, so 1 Hz is plenty for the demo while
// keeping the bag tiny.
const MARKER_HZ = 1;
// Maps publish even slower - SLAM toolboxes typically emit at 0.5-1 Hz and the
// renderer only uploads to GPU when the content fingerprint changes.
const MAP_HZ = 0.5;
// GPS receivers are usually 1 Hz commodity units - match that.
const GPS_HZ = 1;
// Camera image stream: 2 Hz keeps the bag size reasonable (~1.3 MB total)
// while giving the ImageViewer panel enough frames to scrub through.
const CAMERA_HZ = 2;

// ── Camera intrinsics ───────────────────────────────────────────────────
// Front camera: the rendered view in sample-world.mjs. D = [k1, k2, p1, p2, k3]
// is applied when the image is rendered, so the raw frames are barrel
// distorted exactly as a real lens would deliver them and the "undistort"
// button straightens the building edges.
const CAM_W = CAM.w;
const CAM_H = CAM.h;
const CAM_FX = CAM.fx;
const CAM_FY = CAM.fy;
const CAM_CX = CAM.cx;
const CAM_CY = CAM.cy;
const CAM_D = CAM.d;

// Rear camera: CameraInfo only (no image stream), so the 3D panel has a second
// frustum with different intrinsics.
const CAM_REAR_W = 96;
const CAM_REAR_H = 72;
const CAM_REAR_FX = 65.0;
const CAM_REAR_FY = 65.0;
const CAM_REAR_CX = 48.0;
const CAM_REAR_CY = 36.0;
const CAM_REAR_D = [-0.15, 0.03, 0.0, 0.0, 0.0];

// Occupancy grid: 40 m x 40 m at 0.2 m / cell, centred on the start, big enough
// for the buildings that ring the loop.
const MAP_RESOLUTION = 0.2;
const MAP_WIDTH = 200;
const MAP_HEIGHT = 200;
const MAP_ORIGIN_X = -20.0;
const MAP_ORIGIN_Y = -20.0;

// Anchor the GPS trace somewhere recognisable so the OSM tile underlay shows
// familiar streets when toggled on. King's Parade, Cambridge UK - close enough
// to King's College that the figure-eight straddles a couple of city blocks at
// the demo zoom level.
const GPS_ORIGIN_LAT = 52.2043;
const GPS_ORIGIN_LON = 0.1149;
// Earth radius at the equator, used for the local-cartesian → lat/lon back-
// projection. Equirectangular is fine at this scale (sub-100m).
const EARTH_RADIUS_M = 6378137.0;

// Pick an absolute start time so timestamps look like real bag epochs but
// don't change between runs (keeps the output bytes stable).
const START_TIME_NS = 1_700_000_000_000_000_000n;

// ── MCAP requires a Buffer-like writable interface. We collect into a
// dynamic Uint8Array and let the writer grow it as needed.
function makeMemoryWritable() {
  let buffer = new Uint8Array(64 * 1024);
  let size = 0;
  return {
    async write(data) {
      const next = size + data.byteLength;
      if (next > buffer.byteLength) {
        let cap = buffer.byteLength;
        while (cap < next) cap *= 2;
        const grown = new Uint8Array(cap);
        grown.set(buffer.subarray(0, size));
        buffer = grown;
      }
      buffer.set(data, size);
      size = next;
    },
    position() {
      return BigInt(size);
    },
    getBytes() {
      return buffer.subarray(0, size);
    },
  };
}

// ── Resolve message definitions ─────────────────────────────────────────
const defs = rosmsgCommon.ros2galactic;

// vision_msgs is not in the bundled registry; Humble layout.
const f = (type, name, extra = {}) => ({ type, name, isComplex: !/^(string|float64|float32|bool|u?int(8|16|32|64))$/.test(type), ...extra });
const EXTRA_DEFS = {
  'vision_msgs/Detection2DArray': { name: 'vision_msgs/Detection2DArray', definitions: [f('std_msgs/Header', 'header'), f('vision_msgs/Detection2D', 'detections', { isArray: true })] },
  'vision_msgs/Detection2D': { name: 'vision_msgs/Detection2D', definitions: [f('std_msgs/Header', 'header'), f('vision_msgs/ObjectHypothesisWithPose', 'results', { isArray: true }), f('vision_msgs/BoundingBox2D', 'bbox'), f('string', 'id')] },
  'vision_msgs/ObjectHypothesisWithPose': { name: 'vision_msgs/ObjectHypothesisWithPose', definitions: [f('vision_msgs/ObjectHypothesis', 'hypothesis'), f('geometry_msgs/PoseWithCovariance', 'pose')] },
  'vision_msgs/ObjectHypothesis': { name: 'vision_msgs/ObjectHypothesis', definitions: [f('string', 'class_id'), f('float64', 'score')] },
  'vision_msgs/BoundingBox2D': { name: 'vision_msgs/BoundingBox2D', definitions: [f('vision_msgs/Pose2D', 'center'), f('float64', 'size_x'), f('float64', 'size_y')] },
  'vision_msgs/Pose2D': { name: 'vision_msgs/Pose2D', definitions: [f('vision_msgs/Point2D', 'position'), f('float64', 'theta')] },
  'vision_msgs/Detection3DArray': { name: 'vision_msgs/Detection3DArray', definitions: [f('std_msgs/Header', 'header'), f('vision_msgs/Detection3D', 'detections', { isArray: true })] },
  'vision_msgs/Detection3D': { name: 'vision_msgs/Detection3D', definitions: [f('std_msgs/Header', 'header'), f('vision_msgs/ObjectHypothesisWithPose', 'results', { isArray: true }), f('vision_msgs/BoundingBox3D', 'bbox'), f('string', 'id')] },
  'vision_msgs/BoundingBox3D': { name: 'vision_msgs/BoundingBox3D', definitions: [f('geometry_msgs/Pose', 'center'), f('geometry_msgs/Vector3', 'size')] },
  'vision_msgs/Point2D': { name: 'vision_msgs/Point2D', definitions: [f('float64', 'x'), f('float64', 'y')] },
};

function pickDef(typeName) {
  // The common-msg package uses ROS1-style names ("nav_msgs/Odometry") while
  // ROS2 type strings use "nav_msgs/msg/Odometry". Try both forms.
  const bare = typeName.replace('/msg/', '/');
  return EXTRA_DEFS[bare] ?? defs[typeName] ?? defs[bare];
}

/**
 * Collect the root message definition plus every nested complex type that
 * appears anywhere in its tree. MessageWriter wants a flat array with the
 * root first and dependencies after.
 */
function collectDefinitions(rootTypeName) {
  const root = pickDef(rootTypeName);
  if (!root) throw new Error(`Missing message definition for ${rootTypeName}`);
  const out = [root];
  const seen = new Set([root.name]);
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const field of current.definitions) {
      if (!field.isComplex) continue;
      if (seen.has(field.type)) continue;
      const childDef = pickDef(field.type);
      if (!childDef) {
        throw new Error(
          `Missing dependency ${field.type} required by ${current.name}.${field.name}`,
        );
      }
      seen.add(childDef.name);
      out.push(childDef);
      queue.push(childDef);
    }
  }
  return out;
}

function loadWriter(typeName) {
  const definitions = collectDefinitions(typeName);
  return { writer: new MessageWriter(definitions), def: definitions };
}

function flattenSchemaText(defs) {
  // Emit a concatenated .msg schema in the canonical MCAP-for-ROS2 form:
  // root definition first, then each dependency separated by `=====...=====
  // MSG: pkg/Type`. Fields stay in declaration order - splitting simple
  // from complex would change the wire-format order and produce garbage on
  // deserialize.
  const SEP = '================================================================================';

  function emitOne(entry, isRoot) {
    const lines = [];
    if (!isRoot) lines.push(`MSG: ${entry.name}`);
    for (const field of entry.definitions) {
      let line = '';
      if (field.isConstant) {
        line = `${field.type} ${field.name}=${field.value}`;
      } else {
        line = field.type;
        if (field.isArray) {
          line += field.arrayLength != null ? `[${field.arrayLength}]` : '[]';
        }
        line += ` ${field.name}`;
        if (field.defaultValue !== undefined) {
          line += ` ${field.defaultValue}`;
        }
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  const parts = defs.map((entry, i) => emitOne(entry, i === 0));
  return parts.join(`\n${SEP}\n`) + '\n';
}

// ── Helpers for synthetic data ──────────────────────────────────────────
function header(frameId, ns) {
  const sec = Number(ns / 1_000_000_000n);
  // builtin_interfaces/Time names the sub-second field `nanosec`; writing
  // `nsec` here used to serialize it as 0 because MessageWriter looks fields
  // up by name and encodes unknown numeric fields as 0.
  const nanosec = Number(ns % 1_000_000_000n);
  return { stamp: { sec, nanosec }, frame_id: frameId };
}

function quatFromYaw(yaw) {
  const half = yaw / 2;
  return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
}

// ── Per-topic encoders ──────────────────────────────────────────────────
function buildOdomMessage(timeNs) {
  const t = Number(timeNs - START_TIME_NS) / 1e9;
  const { x, y, yaw } = figureEightPose(t);
  return {
    header: header('odom', timeNs),
    child_frame_id: 'base_link',
    pose: {
      pose: {
        position: { x, y, z: 0 },
        orientation: quatFromYaw(yaw),
      },
      covariance: new Array(36).fill(0),
    },
    twist: {
      twist: {
        linear: { x: 0.5, y: 0, z: 0 },
        angular: { x: 0, y: 0, z: 0.4 },
      },
      covariance: new Array(36).fill(0),
    },
  };
}

function buildImuMessage(timeNs) {
  const t = Number(timeNs - START_TIME_NS) / 1e9;
  return {
    header: header('imu_link', timeNs),
    orientation: quatFromYaw(0.2 * Math.sin(t * 0.4)),
    orientation_covariance: new Array(9).fill(0),
    angular_velocity: {
      x: 0.05 * Math.sin(t * 2),
      y: 0.05 * Math.cos(t * 1.7),
      z: 0.4 + 0.1 * Math.sin(t * 0.4),
    },
    angular_velocity_covariance: new Array(9).fill(0),
    linear_acceleration: {
      x: 0.1 * Math.sin(t * 3),
      y: 0.1 * Math.cos(t * 2.4),
      z: 9.81 + 0.05 * Math.sin(t * 5),
    },
    linear_acceleration_covariance: new Array(9).fill(0),
  };
}

// The 2D scanner sits low on the robot and sees the same boxes as everything else.
const SCAN_MOUNT = { x: 0.2, y: 0, z: 0.3 };
const SCAN_RANGE_MAX = 12;

function buildScanMessage(timeNs) {
  const t = Number(timeNs - START_TIME_NS) / 1e9;
  const pose = figureEightPose(t);
  const origin = mountWorld(pose, SCAN_MOUNT);
  const N = 360;
  const ranges = new Array(N);
  const intensities = new Array(N);
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2;
    const hit = castRay(origin, toWorldDir(pose.yaw, Math.cos(angle), Math.sin(angle), 0), SCAN_RANGE_MAX);
    ranges[i] = hit ? hit.t : Infinity;
    intensities[i] = hit ? 100 : 0;
  }
  return {
    header: header('laser', timeNs),
    angle_min: 0,
    angle_max: Math.PI * 2,
    angle_increment: (Math.PI * 2) / N,
    time_increment: 0,
    scan_time: 1.0 / SCAN_HZ,
    range_min: 0.1,
    range_max: SCAN_RANGE_MAX,
    ranges,
    intensities,
  };
}

function buildTfMessage(timeNs) {
  const t = Number(timeNs - START_TIME_NS) / 1e9;
  const { x, y, yaw } = figureEightPose(t);
  const still = { x: 0, y: 0, z: 0, w: 1 };
  const tf = (parent, child, translation, rotation = still) => ({
    header: header(parent, timeNs),
    child_frame_id: child,
    transform: { translation, rotation },
  });
  return {
    transforms: [
      // map is the fixed world; odom coincides with it in this demo.
      tf('map', 'odom', { x: 0, y: 0, z: 0 }),
      tf('odom', 'base_link', { x, y, z: 0 }, quatFromYaw(yaw)),
      tf('base_link', 'laser', SCAN_MOUNT),
      tf('base_link', 'imu_link', { x: 0, y: 0, z: 0.1 }),
      tf('base_link', 'lidar_link', LIDAR_MOUNT),
      // Optical frames: x right, y down, z forward. Forward is +x in base_link.
      tf('base_link', 'camera_optical_link', CAMERA_MOUNT, OPTICAL_QUAT.front),
      // The rear camera looks backwards (-x).
      tf('base_link', 'camera_rear_optical_link', { x: -0.28, y: 0, z: 0.75 }, OPTICAL_QUAT.rear),
    ],
  };
}

/**
 * Build a MarkerArray that demonstrates the v0.8 primitive renderer.
 *
 * Two namespaces:
 *   - `status`   markers ride along with the robot (frame_id = base_link).
 *                A cube body, a sphere head with a text label hovering above,
 *                a forward-pointing arrow, a cylinder mast.
 *   - `planning` markers sit in the world frame (frame_id = odom). A line
 *                strip drawing the planned figure-eight path, plus a
 *                cube-list of "waypoints" at sample points along it.
 *
 * Marker types covered: CUBE(1), SPHERE(2), CYLINDER(3), ARROW(0),
 * LINE_STRIP(4), CUBE_LIST(6), POINTS(8), TEXT_VIEW_FACING(9).
 *
 * The same (ns, id) pairs are emitted on every tick - every message is an
 * ADD/MODIFY so the renderer just updates positions in place. No DELETE
 * is exercised here (lifetime expiry is fine for that on a real bag).
 */
function buildMarkerArrayMessage(timeNs) {
  const t = Number(timeNs - START_TIME_NS) / 1e9;
  const baseHeader = (frame) => header(frame, timeNs);

  // ── status: rides with the robot ───────────────────────────────────────
  const body = {
    header: baseHeader('base_link'),
    ns: 'status',
    id: 0,
    type: 1, // CUBE
    action: 0,
    pose: {
      position: { x: 0, y: 0, z: 0.25 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    scale: { x: 0.6, y: 0.4, z: 0.3 },
    color: { r: 0.2, g: 0.7, b: 1.0, a: 0.9 },
    lifetime: { sec: 0, nanosec: 0 },
    frame_locked: true,
    points: [],
    colors: [],
    text: '',
    mesh_resource: '',
    mesh_use_embedded_materials: false,
  };

  const head = {
    ...body,
    id: 1,
    type: 2, // SPHERE
    pose: {
      position: { x: 0.1, y: 0, z: 0.55 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    scale: { x: 0.3, y: 0.3, z: 0.3 },
    color: { r: 1.0, g: 0.6, b: 0.2, a: 0.95 },
  };

  const label = {
    ...body,
    id: 2,
    type: 9, // TEXT_VIEW_FACING
    pose: {
      position: { x: 0, y: 0, z: 0.85 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    scale: { x: 0, y: 0, z: 0.2 },
    color: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
    text: 'robot',
  };

  const arrow = {
    ...body,
    id: 3,
    type: 0, // ARROW
    pose: {
      position: { x: 0.35, y: 0, z: 0.25 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    scale: { x: 0.5, y: 0.06, z: 0.12 },
    color: { r: 1.0, g: 0.2, b: 0.2, a: 1.0 },
  };

  const mast = {
    ...body,
    id: 4,
    type: 3, // CYLINDER
    pose: {
      position: { x: -0.2, y: 0, z: 0.45 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    scale: { x: 0.05, y: 0.05, z: 0.5 },
    color: { r: 0.6, g: 0.6, b: 0.6, a: 1.0 },
  };

  // ── planning: world-frame path + waypoints ─────────────────────────────
  // Path runs through the entire 30-second lemniscate - sampled at 0.5s.
  const pathPoints = [];
  for (let s = 0; s <= 30; s += 0.5) {
    const p = figureEightPose(s);
    pathPoints.push({ x: p.x, y: p.y, z: 0.02 });
  }
  const path = {
    header: baseHeader('odom'),
    ns: 'planning',
    id: 0,
    type: 4, // LINE_STRIP
    action: 0,
    pose: {
      position: { x: 0, y: 0, z: 0 },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
    },
    scale: { x: 0.08, y: 0, z: 0 },
    color: { r: 0.4, g: 1.0, b: 0.6, a: 0.9 },
    lifetime: { sec: 0, nanosec: 0 },
    frame_locked: false,
    points: pathPoints,
    colors: [],
    text: '',
    mesh_resource: '',
    mesh_use_embedded_materials: false,
  };

  // Highlight the next ~5 seconds of path as a cube-list of waypoints.
  const waypointPoints = [];
  for (let dt = 0; dt <= 5; dt += 1) {
    const p = figureEightPose(t + dt);
    waypointPoints.push({ x: p.x, y: p.y, z: 0.1 });
  }
  const waypoints = {
    ...path,
    id: 1,
    type: 6, // CUBE_LIST
    scale: { x: 0.2, y: 0.2, z: 0.2 },
    color: { r: 1.0, g: 0.9, b: 0.2, a: 0.85 },
    points: waypointPoints,
  };

  // Scattered "feature" points around the path centre, fixed across the run.
  const featurePoints = [];
  for (let i = 0; i < 25; i++) {
    const a = i * 0.42; // deterministic spread
    featurePoints.push({
      x: 7 * Math.cos(a) + 0.3 * (i % 3),
      y: 5 * Math.sin(a * 1.3),
      z: 0.05,
    });
  }
  const features = {
    ...path,
    id: 2,
    type: 8, // POINTS
    scale: { x: 0.08, y: 0.08, z: 0 },
    color: { r: 0.8, g: 0.4, b: 1.0, a: 0.9 },
    points: featurePoints,
  };

  return {
    markers: [body, head, label, arrow, mast, path, waypoints, features],
  };
}

/**
 * Build a synthetic OccupancyGrid that "grows" over the bag duration to
 * mimic an incremental SLAM run.
 *
 * The map is a square room (outer walls = occupied, interior = free) with a
 * couple of obstacles. Cells outside an exploration radius around the robot's
 * current position are flagged unknown (-1). The exploration radius grows
 * linearly with bag time so scrubbing forwards reveals more of the map - the
 * classic "watching slam_toolbox build the map" experience that map rendering
 * in v0.9 exists to make legible.
 */
function buildOccupancyGridMessage(timeNs) {
  const t = Number(timeNs - START_TIME_NS) / 1e9;
  const { x: robotX, y: robotY } = figureEightPose(t);
  // Reveal outwards from the robot as the run goes on.
  const exploredRadius = 4 + (t / DURATION_SEC) * 20;
  const exploredR2 = exploredRadius * exploredRadius;

  const data = new Array(MAP_WIDTH * MAP_HEIGHT);
  for (let row = 0; row < MAP_HEIGHT; row++) {
    for (let col = 0; col < MAP_WIDTH; col++) {
      const worldX = MAP_ORIGIN_X + (col + 0.5) * MAP_RESOLUTION;
      const worldY = MAP_ORIGIN_Y + (row + 0.5) * MAP_RESOLUTION;
      const dx = worldX - robotX;
      const dy = worldY - robotY;
      data[row * MAP_WIDTH + col] =
        dx * dx + dy * dy > exploredR2 ? -1 : occupiedAt(worldX, worldY) ? 100 : 0;
    }
  }

  return {
    header: header('map', timeNs),
    info: {
      map_load_time: { sec: 0, nanosec: 0 },
      resolution: MAP_RESOLUTION,
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      origin: {
        position: { x: MAP_ORIGIN_X, y: MAP_ORIGIN_Y, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    },
    data,
  };
}

/**
 * Project the figure-eight pose onto realistic lat/lon around the configured
 * GPS origin so the OSM tile underlay can show a recognisable city layout.
 * Equirectangular projection is fine at sub-100m scale.
 */
function buildNavSatFixMessage(timeNs) {
  const t = Number(timeNs - START_TIME_NS) / 1e9;
  const { x, y } = figureEightPose(t);
  // The figure-eight has radius ~5 m; scale it up so it spans a few blocks on
  // the OSM underlay (~120 m peak-to-peak) - large enough to actually see the
  // shape against streets at the demo zoom level.
  const scale = 12.0;
  const dxMeters = x * scale;
  const dyMeters = y * scale;
  // y → latitude (north positive), x → longitude (east positive).
  const lat = GPS_ORIGIN_LAT + (dyMeters / EARTH_RADIUS_M) * (180 / Math.PI);
  const lon =
    GPS_ORIGIN_LON +
    (dxMeters / (EARTH_RADIUS_M * Math.cos((GPS_ORIGIN_LAT * Math.PI) / 180))) *
      (180 / Math.PI);

  return {
    header: header('gps_link', timeNs),
    status: {
      status: 0, // STATUS_FIX
      service: 1, // SERVICE_GPS
    },
    latitude: lat,
    longitude: lon,
    altitude: 25.0 + 0.2 * Math.sin(t * 0.5), // gentle altitude wobble
    position_covariance: new Array(9).fill(0),
    position_covariance_type: 0, // COVARIANCE_TYPE_UNKNOWN
  };
}

// ── Camera message builders (v1.3.4) ────────────────────────────────────

function buildCameraImageMessage(timeNs) {
  const t = Number(timeNs - START_TIME_NS) / 1e9;
  return {
    header: header('camera_optical_link', timeNs),
    height: CAM_H,
    width: CAM_W,
    encoding: 'rgb8',
    is_bigendian: 0,
    step: CAM_W * 3,
    data: renderCamera(figureEightPose(t)),
  };
}

function buildCameraInfoMessage(timeNs) {
  return {
    header: header('camera_optical_link', timeNs),
    height: CAM_H,
    width: CAM_W,
    distortion_model: 'plumb_bob',
    d: CAM_D,
    k: [CAM_FX, 0, CAM_CX, 0, CAM_FY, CAM_CY, 0, 0, 1],
    r: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    p: [CAM_FX, 0, CAM_CX, 0, 0, CAM_FY, CAM_CY, 0, 0, 0, 1, 0],
    binning_x: 0,
    binning_y: 0,
    roi: { x_offset: 0, y_offset: 0, height: 0, width: 0, do_rectify: false },
  };
}

function buildCameraRearInfoMessage(timeNs) {
  return {
    header: header('camera_rear_optical_link', timeNs),
    height: CAM_REAR_H,
    width: CAM_REAR_W,
    distortion_model: 'plumb_bob',
    d: CAM_REAR_D,
    k: [CAM_REAR_FX, 0, CAM_REAR_CX, 0, CAM_REAR_FY, CAM_REAR_CY, 0, 0, 1],
    r: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    p: [CAM_REAR_FX, 0, CAM_REAR_CX, 0, 0, CAM_REAR_FY, CAM_REAR_CY, 0, 0, 0, 1, 0],
    binning_x: 0,
    binning_y: 0,
    roi: { x_offset: 0, y_offset: 0, height: 0, width: 0, do_rectify: false },
  };
}

// ── The story: lidar, detections, state, battery, logs, plan ─────────────
const POINTS_HZ = 4;
const DETECTION_HZ = CAMERA_HZ;
const MODE_HZ = 2;
const BATTERY_HZ = 1;
const PLAN_HZ = 1;
const PARTICLES_HZ = 2;

const secondsOf = (timeNs) => Number(timeNs - START_TIME_NS) / 1e9;
const frameOf = (timeNs, hz) => Math.round(secondsOf(timeNs) * hz);

function buildPointCloudMessage(timeNs) {
  const pts = lidarSweep(figureEightPose(secondsOf(timeNs)), frameOf(timeNs, POINTS_HZ));
  const f32 = new Float32Array(pts.length * 4);
  pts.forEach((p, i) => f32.set(p, i * 4));
  const field = (name, offset) => ({ name, offset, datatype: 7, count: 1 });
  return {
    header: header('lidar_link', timeNs),
    height: 1,
    width: pts.length,
    fields: [field('x', 0), field('y', 4), field('z', 8), field('intensity', 12)],
    is_bigendian: false,
    point_step: 16,
    row_step: pts.length * 16,
    data: new Uint8Array(f32.buffer),
    is_dense: true,
  };
}

function buildDetectionsMessage(timeNs) {
  const boxes = detect(figureEightPose(secondsOf(timeNs)), frameOf(timeNs, DETECTION_HZ));
  const zeroPose = {
    pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    covariance: new Array(36).fill(0),
  };
  return {
    header: header('camera_optical_link', timeNs),
    detections: boxes.map((b) => ({
      header: header('camera_optical_link', timeNs),
      results: [{ hypothesis: { class_id: b.cls, score: b.score }, pose: zeroPose }],
      bbox: { center: { position: { x: b.cx, y: b.cy }, theta: 0 }, size_x: b.w, size_y: b.h },
      id: '',
    })),
  };
}

function buildDetections3dMessage(timeNs) {
  const boxes = detect3d(figureEightPose(secondsOf(timeNs)), frameOf(timeNs, DETECTION_HZ));
  const zeroPose = {
    pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
    covariance: new Array(36).fill(0),
  };
  return {
    header: header('map', timeNs),
    detections: boxes.map((b) => ({
      header: header('map', timeNs),
      results: [{ hypothesis: { class_id: b.cls, score: b.score }, pose: zeroPose }],
      bbox: {
        center: { position: { x: b.centre[0], y: b.centre[1], z: b.centre[2] }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
        size: { x: b.size[0], y: b.size[1], z: b.size[2] },
      },
      id: '',
    })),
  };
}

function modeAt(t) {
  return (MODES.find((m) => t >= m.from && t < m.to) ?? MODES[MODES.length - 1]).name;
}

function buildModeMessage(timeNs) {
  return { data: modeAt(secondsOf(timeNs)) };
}

// Battery drains from 90% to 12% over the run, crossing 20% near the end.
const batteryAt = (t) => 0.9 - (0.78 * t) / DURATION_SEC;
const BATTERY_LOW_T = ((0.9 - 0.2) / 0.78) * DURATION_SEC;

function buildBatteryMessage(timeNs) {
  const t = secondsOf(timeNs);
  const pct = batteryAt(t);
  return {
    header: header('base_link', timeNs),
    voltage: 21.0 + 4.2 * pct,
    temperature: 31 + 0.08 * t,
    current: -3.2 - 0.4 * Math.sin(t * 0.9),
    charge: 20 * pct,
    capacity: 20,
    design_capacity: 20,
    percentage: pct,
    power_supply_status: 2, // discharging
    power_supply_health: 1, // good
    power_supply_technology: 3, // Li-ion
    present: true,
    cell_voltage: [],
    cell_temperature: [],
    location: 'base',
    serial_number: '',
  };
}

// Log lines tell the story of the run; times match MODES and the battery curve.
const LOG_LEVEL = { INFO: 20, WARN: 30, ERROR: 40 };
const LOG_LINES = [
  [0.4, 'INFO', 'bagel_demo', 'Node started, map and costmaps loaded'],
  [2.0, 'INFO', 'mode_manager', 'Mode IDLE -> EXPLORING'],
  [6.0, 'INFO', 'localization', 'Pose converged, covariance 0.04 m'],
  [11.9, 'WARN', 'perception', 'Person detected 3.1 m ahead, slowing down'],
  [12.0, 'INFO', 'mode_manager', 'Mode EXPLORING -> AVOIDING'],
  [14.5, 'INFO', 'mode_manager', 'Path clear, mode AVOIDING -> EXPLORING'],
  [18.0, 'INFO', 'planner', 'Waypoint 3 of 5 reached'],
  [21.4, 'WARN', 'perception', 'Person detected 3.0 m ahead, slowing down'],
  [21.5, 'INFO', 'mode_manager', 'Mode EXPLORING -> AVOIDING'],
  [23.5, 'INFO', 'mode_manager', 'Mode AVOIDING -> RETURNING, heading to the dock'],
  [BATTERY_LOW_T, 'WARN', 'power', 'Battery at 20%, returning is now a priority'],
  [28.0, 'ERROR', 'docking', 'Dock beacon not visible, falling back to odometry'],
];

function buildLogMessage(timeNs) {
  const t = secondsOf(timeNs);
  const line = LOG_LINES.reduce((best, l) => (Math.abs(l[0] - t) < Math.abs(best[0] - t) ? l : best));
  return {
    stamp: header('', timeNs).stamp,
    level: LOG_LEVEL[line[1]],
    name: line[2],
    msg: line[3],
    file: `${line[2]}.cpp`,
    function: 'tick',
    line: 100 + Math.round(line[0]),
  };
}

function poseStamped(timeNs, x, y, yaw) {
  return {
    header: header('odom', timeNs),
    pose: { position: { x, y, z: 0 }, orientation: quatFromYaw(yaw) },
  };
}

// The route ahead: the next 12 seconds of the figure eight, 0.5 s apart.
function buildPlanMessage(timeNs) {
  const t = secondsOf(timeNs);
  const poses = [];
  for (let k = 0; k <= 24; k++) {
    const p = figureEightPose(t + k * 0.5);
    poses.push(poseStamped(timeNs, p.x, p.y, p.yaw));
  }
  return { header: header('odom', timeNs), poses };
}

// A localisation particle cloud around the robot, tightening as the run goes on.
function buildParticlesMessage(timeNs) {
  const t = secondsOf(timeNs);
  const frame = frameOf(timeNs, PARTICLES_HZ);
  const p = figureEightPose(t);
  const spread = 0.5 * Math.exp(-t / 9) + 0.08;
  const poses = [];
  for (let i = 0; i < 40; i++) {
    const gx = hashSigned(frame, i, 1) * spread;
    const gy = hashSigned(frame, i, 2) * spread;
    const gyaw = hashSigned(frame, i, 3) * spread * 0.8;
    poses.push({
      position: { x: p.x + gx, y: p.y + gy, z: 0 },
      orientation: quatFromYaw(p.yaw + gyaw),
    });
  }
  return { header: header('odom', timeNs), poses };
}

function hashSigned(a, b, c) {
  return hash01(a, b, c) * 2 - 1;
}

// ── Drive the writer ────────────────────────────────────────────────────
async function main() {
  const writable = makeMemoryWritable();
  const writer = new McapWriter({
    writable,
    useChunks: true,
    useStatistics: true,
    useChunkIndex: true,
    useMessageIndex: true,
    useSummaryOffsets: true,
    // Rendered frames and point clouds shrink a lot; BAGEL reads zstd chunks.
    compressChunk: (chunkData) => ({ compression: 'zstd', compressedData: zstdCompressSync(chunkData) }),
  });

  await writer.start({ profile: 'ros2', library: 'bagel-sample-bag-generator' });

  const topics = [
    {
      topic: '/odom',
      type: 'nav_msgs/msg/Odometry',
      hz: ODOM_HZ,
      build: buildOdomMessage,
    },
    {
      topic: '/imu/data',
      type: 'sensor_msgs/msg/Imu',
      hz: IMU_HZ,
      build: buildImuMessage,
    },
    {
      topic: '/scan',
      type: 'sensor_msgs/msg/LaserScan',
      hz: SCAN_HZ,
      build: buildScanMessage,
    },
    {
      topic: '/tf',
      type: 'tf2_msgs/msg/TFMessage',
      hz: TF_HZ,
      build: buildTfMessage,
    },
    {
      topic: '/markers',
      type: 'visualization_msgs/msg/MarkerArray',
      hz: MARKER_HZ,
      build: buildMarkerArrayMessage,
    },
    {
      topic: '/map',
      type: 'nav_msgs/msg/OccupancyGrid',
      hz: MAP_HZ,
      build: buildOccupancyGridMessage,
    },
    {
      topic: '/gps/fix',
      type: 'sensor_msgs/msg/NavSatFix',
      hz: GPS_HZ,
      build: buildNavSatFixMessage,
    },
    {
      topic: '/camera/image_raw',
      type: 'sensor_msgs/msg/Image',
      hz: CAMERA_HZ,
      build: buildCameraImageMessage,
    },
    {
      topic: '/camera/camera_info',
      type: 'sensor_msgs/msg/CameraInfo',
      hz: CAMERA_HZ,
      build: buildCameraInfoMessage,
    },
    {
      topic: '/camera_rear/camera_info',
      type: 'sensor_msgs/msg/CameraInfo',
      hz: GPS_HZ,
      build: buildCameraRearInfoMessage,
    },
    { topic: '/lidar/points', type: 'sensor_msgs/msg/PointCloud2', hz: POINTS_HZ, build: buildPointCloudMessage },
    { topic: '/detections', type: 'vision_msgs/msg/Detection2DArray', hz: DETECTION_HZ, build: buildDetectionsMessage },
    { topic: '/detections_3d', type: 'vision_msgs/msg/Detection3DArray', hz: DETECTION_HZ, build: buildDetections3dMessage },
    { topic: '/robot/mode', type: 'std_msgs/msg/String', hz: MODE_HZ, build: buildModeMessage },
    { topic: '/battery', type: 'sensor_msgs/msg/BatteryState', hz: BATTERY_HZ, build: buildBatteryMessage },
    { topic: '/rosout', type: 'rcl_interfaces/msg/Log', times: LOG_LINES.map((l) => l[0]), build: buildLogMessage },
    { topic: '/plan', type: 'nav_msgs/msg/Path', hz: PLAN_HZ, build: buildPlanMessage },
    { topic: '/particles', type: 'geometry_msgs/msg/PoseArray', hz: PARTICLES_HZ, build: buildParticlesMessage },
  ];

  // Register schemas + channels and stash encoders.
  const channels = [];
  for (const t of topics) {
    const { writer: mw, def } = loadWriter(t.type);
    const schemaId = await writer.registerSchema({
      name: t.type,
      encoding: 'ros2msg',
      data: new TextEncoder().encode(flattenSchemaText(def)),
    });
    const channelId = await writer.registerChannel({
      schemaId,
      topic: t.topic,
      messageEncoding: 'cdr',
      metadata: new Map([['rosbag2', 'true']]),
    });
    channels.push({ ...t, mw, channelId });
  }

  // Interleave messages in time order so the bag plays back naturally.
  // Hz can be fractional (e.g. 0.5 Hz for the map), so compute the period as
  // a float then round to integer ns - BigInt(0.5) throws.
  const events = [];
  for (const ch of channels) {
    if (ch.times) {
      for (const sec of ch.times) events.push({ ch, t: START_TIME_NS + BigInt(Math.round(sec * 1e9)) });
      continue;
    }
    const periodNs = BigInt(Math.round(1_000_000_000 / ch.hz));
    const count = Math.max(1, Math.floor(ch.hz * DURATION_SEC));
    for (let i = 0; i < count; i++) {
      events.push({ ch, t: START_TIME_NS + BigInt(i) * periodNs });
    }
  }
  events.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  let sequence = 0;
  for (const e of events) {
    const value = e.ch.build(e.t);
    const data = e.ch.mw.writeMessage(value);
    await writer.addMessage({
      channelId: e.ch.channelId,
      sequence: sequence++,
      logTime: e.t,
      publishTime: e.t,
      data,
    });
  }

  await writer.end();

  const bytes = writable.getBytes();
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, bytes);
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`  ${(bytes.byteLength / 1024).toFixed(1)} KB`);
  console.log(`  ${events.length.toLocaleString()} messages across ${channels.length} topics`);
  console.log(`  ${DURATION_SEC}s duration`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
