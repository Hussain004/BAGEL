/**
 * Build a small synthetic MCAP file bundled with BAGEL as "Try a sample bag".
 *
 * The real test fixtures in test_files/ are 250 MB – 3.7 GB which is too big
 * to ship in the public web bundle. This script generates a self-contained
 * 30-second synthetic bag (~50 KB) with:
 *
 *   - /odom (nav_msgs/Odometry)      — 10 Hz figure-eight pose, gives the
 *                                       Trajectory + Plot panels something
 *                                       interesting to render.
 *   - /imu/data (sensor_msgs/Imu)     — 50 Hz angular velocity + accel, drives
 *                                       the Plot panel.
 *   - /scan (sensor_msgs/LaserScan)   — 10 Hz radial scan, exercises the
 *                                       LaserScan branch of the 3D panel.
 *   - /tf (tf2_msgs/TFMessage)        — 10 Hz odom→base_link, exercises the
 *                                       TF tree + TF-aware rendering.
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
  const events = [];
  for (const ch of channels) {
    const period = 1_000_000_000n / BigInt(ch.hz);
    const count = ch.hz * DURATION_SEC;
    for (let i = 0; i < count; i++) {
      events.push({ ch, t: START_TIME_NS + BigInt(i) * period });
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
