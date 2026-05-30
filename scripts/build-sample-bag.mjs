/**
 * Build a small synthetic MCAP file bundled with BAGEL as "Try a sample bag".
 *
 * The real test fixtures in test_files/ are 250 MB – 3.7 GB which is too big
 * to ship in the public web bundle. This script generates a self-contained
 * 30-second synthetic bag (~50 KB) with:
 *
 *   - /odom (nav_msgs/Odometry)             — 10 Hz figure-eight pose, gives
 *                                              the Trajectory + Plot panels
 *                                              something interesting to render.
 *   - /imu/data (sensor_msgs/Imu)            — 50 Hz angular velocity + accel,
 *                                              drives the Plot panel.
 *   - /scan (sensor_msgs/LaserScan)          — 10 Hz radial scan, exercises
 *                                              the LaserScan branch of the
 *                                              3D panel.
 *   - /tf (tf2_msgs/TFMessage)               — 10 Hz odom→base_link, exercises
 *                                              the TF tree + TF-aware rendering.
 *   - /markers (visualization_msgs/MarkerArray) — 1 Hz set of debug primitives
 *                                              in two namespaces (`status` in
 *                                              base_link, `planning` in odom)
 *                                              to exercise the v0.8 marker
 *                                              renderer (cube/sphere/cylinder/
 *                                              arrow/line_strip/points/text).
 *   - /map (nav_msgs/OccupancyGrid)          — 0.5 Hz synthetic SLAM map that
 *                                              expands outward over the bag.
 *                                              Exercises the v0.9 map plane
 *                                              renderer (cost ramp + origin
 *                                              pose + TF-resolved placement).
 *   - /gps/fix (sensor_msgs/NavSatFix)       — 1 Hz GPS trace, the figure-eight
 *                                              projected onto realistic lat/lon
 *                                              somewhere recognisable (around
 *                                              Cambridge, UK so the OSM tile
 *                                              underlay shows familiar streets
 *                                              when the toggle is flipped on).
 *
 * Run:    node scripts/build-sample-bag.mjs
 * Output: public/sample-bags/tour.mcap
 *
 * The script is idempotent. Re-running with the same inputs produces the same
 * bytes, so it's safe to commit the result. We commit it rather than running
 * on every build because the deps (mcap/foxglove serialization) are already
 * in node_modules and re-running adds latency without changing output.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { McapWriter } from '@mcap/core';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';
import rosmsgCommon from '@foxglove/rosmsg-msgs-common';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const OUTPUT_PATH = join(REPO_ROOT, 'public', 'sample-bags', 'tour.mcap');

// ── Bag parameters ───────────────────────────────────────────────────────
const DURATION_SEC = 30;
const ODOM_HZ = 10;
const IMU_HZ = 50;
const SCAN_HZ = 10;
const TF_HZ = 10;
// Markers tick slowly — they're persistent in the scene and the renderer just
// MODIFYs the existing entries each tick, so 1 Hz is plenty for the demo while
// keeping the bag tiny.
const MARKER_HZ = 1;
// Maps publish even slower — SLAM toolboxes typically emit at 0.5-1 Hz and the
// renderer only uploads to GPU when the content fingerprint changes.
const MAP_HZ = 0.5;
// GPS receivers are usually 1 Hz commodity units — match that.
const GPS_HZ = 1;

// Occupancy grid sizing: 10 m × 10 m at 0.1 m / cell.
// Origin at (-5, -5) so the figure-eight (radius ~5) fits inside.
const MAP_RESOLUTION = 0.1;
const MAP_WIDTH = 100;
const MAP_HEIGHT = 100;
const MAP_ORIGIN_X = -5.0;
const MAP_ORIGIN_Y = -5.0;

// Anchor the GPS trace somewhere recognisable so the OSM tile underlay shows
// familiar streets when toggled on. King's Parade, Cambridge UK — close enough
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

function pickDef(typeName) {
  // The common-msg package uses ROS1-style names ("nav_msgs/Odometry") while
  // ROS2 type strings use "nav_msgs/msg/Odometry". Try both forms.
  const bare = typeName.replace('/msg/', '/');
  return defs[typeName] ?? defs[bare];
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
  // MSG: pkg/Type`. Fields stay in declaration order — splitting simple
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
  const nsec = Number(ns % 1_000_000_000n);
  return { stamp: { sec, nsec }, frame_id: frameId };
}

function quatFromYaw(yaw) {
  const half = yaw / 2;
  return { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) };
}

function figureEightPose(t) {
  // Lemniscate of Bernoulli — a friendly closed loop the trajectory panel
  // can render at a glance.
  const a = 5.0;
  const k = 0.4; // angular velocity along the curve
  const phi = t * k;
  const denom = 1 + Math.sin(phi) * Math.sin(phi);
  const x = (a * Math.cos(phi)) / denom;
  const y = (a * Math.sin(phi) * Math.cos(phi)) / denom;
  // Heading is the curve's tangent.
  const dx = -a * Math.sin(phi) / denom - (a * Math.cos(phi) * Math.sin(2 * phi)) / (denom * denom);
  const dy = (a * Math.cos(2 * phi)) / denom - (a * Math.sin(phi) * Math.cos(phi) * Math.sin(2 * phi)) / (denom * denom);
  const yaw = Math.atan2(dy, dx);
  return { x, y, yaw };
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

function buildScanMessage(timeNs) {
  const t = Number(timeNs - START_TIME_NS) / 1e9;
  const N = 360;
  const ranges = new Array(N);
  for (let i = 0; i < N; i++) {
    const angle = (i / N) * Math.PI * 2;
    // A pulsing rectangular "room" plus a moving dot — gives the 3D panel
    // something visually obvious to look at while scrubbing.
    const baseRoom = 3.0 + 0.5 * Math.cos(2 * angle);
    const wobble = 0.1 * Math.sin(t * 1.5 + angle * 3);
    ranges[i] = baseRoom + wobble;
  }
  const intensities = new Array(N).fill(100);
  return {
    header: header('laser', timeNs),
    angle_min: 0,
    angle_max: Math.PI * 2,
    angle_increment: (Math.PI * 2) / N,
    time_increment: 0,
    scan_time: 1.0 / SCAN_HZ,
    range_min: 0.1,
    range_max: 10.0,
    ranges,
    intensities,
  };
}

function buildTfMessage(timeNs) {
  const t = Number(timeNs - START_TIME_NS) / 1e9;
  const { x, y, yaw } = figureEightPose(t);
  return {
    transforms: [
      {
        header: header('odom', timeNs),
        child_frame_id: 'base_link',
        transform: {
          translation: { x, y, z: 0 },
          rotation: quatFromYaw(yaw),
        },
      },
      {
        header: header('base_link', timeNs),
        child_frame_id: 'laser',
        transform: {
          translation: { x: 0.2, y: 0, z: 0.3 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
      {
        header: header('base_link', timeNs),
        child_frame_id: 'imu_link',
        transform: {
          translation: { x: 0, y: 0, z: 0.1 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
        },
      },
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
 * The same (ns, id) pairs are emitted on every tick — every message is an
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
    lifetime: { sec: 0, nsec: 0 },
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
  // Path runs through the entire 30-second lemniscate — sampled at 0.5s.
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
    lifetime: { sec: 0, nsec: 0 },
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
 * linearly with bag time so scrubbing forwards reveals more of the map — the
 * classic "watching slam_toolbox build the map" experience that map rendering
 * in v0.9 exists to make legible.
 */
function buildOccupancyGridMessage(timeNs) {
  const t = Number(timeNs - START_TIME_NS) / 1e9;
  const { x: robotX, y: robotY } = figureEightPose(t);
  // Reveal a generous radius that fully covers the map by the end of the bag.
  const exploredRadius = 1.5 + (t / DURATION_SEC) * 9.0;
  const exploredR2 = exploredRadius * exploredRadius;

  const data = new Array(MAP_WIDTH * MAP_HEIGHT);
  for (let row = 0; row < MAP_HEIGHT; row++) {
    for (let col = 0; col < MAP_WIDTH; col++) {
      const idx = row * MAP_WIDTH + col;
      const worldX = MAP_ORIGIN_X + (col + 0.5) * MAP_RESOLUTION;
      const worldY = MAP_ORIGIN_Y + (row + 0.5) * MAP_RESOLUTION;
      const dx = worldX - robotX;
      const dy = worldY - robotY;
      // Cells the robot hasn't "seen" yet stay unknown.
      if (dx * dx + dy * dy > exploredR2) {
        data[idx] = -1;
        continue;
      }
      // Outer walls of the room (2 cells thick on each edge so they're visible
      // at the chosen resolution).
      const onOuterWall =
        col < 2 || col >= MAP_WIDTH - 2 || row < 2 || row >= MAP_HEIGHT - 2;
      // Two rectangular pillars in the interior.
      const inPillarA =
        col >= 30 && col < 38 && row >= 30 && row < 38;
      const inPillarB =
        col >= 65 && col < 72 && row >= 60 && row < 68;
      // A diagonal corridor wall — exercises the linear-cost ramp.
      const corridorDist = Math.abs((col - 50) + (row - 50));
      const onCorridorWall = corridorDist === 25 && col > 50 && row > 30 && row < 70;

      if (onOuterWall || inPillarA || inPillarB) {
        data[idx] = 100; // fully occupied
      } else if (onCorridorWall) {
        // Mid-cost ramp to demonstrate the 1-99 gradient in the renderer.
        data[idx] = 70;
      } else {
        data[idx] = 0; // free
      }
    }
  }

  return {
    header: header('map', timeNs),
    info: {
      map_load_time: { sec: 0, nsec: 0 },
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
  // the OSM underlay (~120 m peak-to-peak) — large enough to actually see the
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
  // a float then round to integer ns — BigInt(0.5) throws.
  const events = [];
  for (const ch of channels) {
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
