/**
 * Encoding the messages BAGEL publishes. A server tells us which encodings it
 * accepts; we write `geometry_msgs/Twist` (or `TwistStamped`) in the best one:
 * CDR for ROS 2, ROS 1 serialisation for a ROS 1 bridge, JSON as the fallback.
 */

import { parse as parseRosMsgDefinition } from '@foxglove/rosmsg';
import { MessageWriter as Ros2MessageWriter } from '@foxglove/rosmsg2-serialization';
import { MessageWriter as Ros1MessageWriter } from '@foxglove/rosmsg-serialization';

export type TwistKind = 'Twist' | 'TwistStamped';

export interface Twist {
  linear: number;
  angular: number;
}

export interface PublishCodec {
  encoding: 'cdr' | 'ros1' | 'json';
  schemaEncoding?: 'ros2msg' | 'ros1msg';
  schemaName: string;
  schema?: string;
  encode(twist: Twist): Uint8Array;
}

const RULE = '='.repeat(80);
const VECTOR3 = `${RULE}\nMSG: geometry_msgs/Vector3\nfloat64 x\nfloat64 y\nfloat64 z`;
const TWIST_SCHEMA = `geometry_msgs/Vector3 linear\ngeometry_msgs/Vector3 angular\n${VECTOR3}`;
/** ROS 2 headers are stamp + frame_id; ROS 1 headers also begin with a sequence number. */
const headerSchema = (ros2: boolean) =>
  `${RULE}\nMSG: std_msgs/Header\n${ros2 ? 'builtin_interfaces/Time stamp' : 'uint32 seq\ntime stamp'}\nstring frame_id\n${
    ros2 ? `${RULE}\nMSG: builtin_interfaces/Time\nint32 sec\nuint32 nanosec\n` : ''
  }`;
const TWIST_STAMPED_SCHEMA = (ros2: boolean) =>
  `std_msgs/Header header\ngeometry_msgs/Twist twist\n${headerSchema(ros2)}${RULE}\nMSG: geometry_msgs/Twist\ngeometry_msgs/Vector3 linear\ngeometry_msgs/Vector3 angular\n${VECTOR3}`;
const POSE_STAMPED_SCHEMA = (ros2: boolean) =>
  `std_msgs/Header header\ngeometry_msgs/Pose pose\n${headerSchema(ros2)}${RULE}\nMSG: geometry_msgs/Pose\ngeometry_msgs/Point position\ngeometry_msgs/Quaternion orientation\n` +
  `${RULE}\nMSG: geometry_msgs/Point\nfloat64 x\nfloat64 y\nfloat64 z\n${RULE}\nMSG: geometry_msgs/Quaternion\nfloat64 x\nfloat64 y\nfloat64 z\nfloat64 w`;

/** Forward speed on x, turn rate on z, everything else zero: a ground robot's command. */
function twistObject(t: Twist) {
  return { linear: { x: t.linear, y: 0, z: 0 }, angular: { x: 0, y: 0, z: t.angular } };
}

function headerObject(ros2: boolean, nowMs: number, frameId: string) {
  const sec = Math.floor(nowMs / 1000);
  const frac = Math.round((nowMs - sec * 1000) * 1e6);
  return ros2 ? { stamp: { sec, nanosec: frac }, frame_id: frameId } : { seq: 0, stamp: { sec, nsec: frac }, frame_id: frameId };
}

function stampedObject(t: Twist, ros2: boolean, nowMs: number) {
  return { header: headerObject(ros2, nowMs, ''), twist: twistObject(t) };
}

export interface CodecOptions {
  /** What the server said in serverInfo; undefined for old servers that say nothing. */
  supportedEncodings: readonly string[] | undefined;
  kind: TwistKind;
  /** `/msg/` in the type names the server already uses means ROS 2 naming. */
  ros2Names: boolean;
  /** For the timestamp in TwistStamped. */
  nowMs?: () => number;
}

export function pickPublishCodec(opts: CodecOptions): PublishCodec | null {
  const { supportedEncodings: enc, kind } = opts;
  const now = opts.nowMs ?? Date.now;
  const name = (ros2: boolean) => `geometry_msgs/${ros2 ? 'msg/' : ''}${kind}`;
  const stamped = kind === 'TwistStamped';

  if (enc?.includes('cdr')) {
    const schema = stamped ? TWIST_STAMPED_SCHEMA(true) : TWIST_SCHEMA;
    const writer = new Ros2MessageWriter(parseRosMsgDefinition(schema, { ros2: true }));
    return {
      encoding: 'cdr',
      schemaEncoding: 'ros2msg',
      schemaName: name(true),
      schema,
      encode: (t) => writer.writeMessage(stamped ? stampedObject(t, true, now()) : twistObject(t)),
    };
  }
  if (enc?.includes('ros1')) {
    const schema = stamped ? TWIST_STAMPED_SCHEMA(false) : TWIST_SCHEMA;
    const writer = new Ros1MessageWriter(parseRosMsgDefinition(schema, { ros2: false }));
    return {
      encoding: 'ros1',
      schemaEncoding: 'ros1msg',
      schemaName: name(false),
      schema,
      encode: (t) => writer.writeMessage(stamped ? stampedObject(t, false, now()) : twistObject(t)),
    };
  }
  if (!enc || enc.includes('json')) {
    const ros2 = opts.ros2Names;
    return {
      encoding: 'json',
      schemaName: name(ros2),
      encode: (t) => new TextEncoder().encode(JSON.stringify(stamped ? stampedObject(t, ros2, now()) : twistObject(t))),
    };
  }
  return null;
}

// ── Navigation goals ───────────────────────────────────────────────────────

/** A 2D goal: a position on the ground and the direction to face, in the frame named at send time. */
export interface Goal2D {
  x: number;
  y: number;
  /** Radians, counter-clockwise from +x. */
  yaw: number;
}

export interface GoalCodec {
  encoding: 'cdr' | 'ros1' | 'json';
  schemaEncoding?: 'ros2msg' | 'ros1msg';
  schemaName: string;
  schema?: string;
  encode(goal: Goal2D, frameId: string): Uint8Array;
}

function poseStampedObject(g: Goal2D, ros2: boolean, nowMs: number, frameId: string) {
  return {
    header: headerObject(ros2, nowMs, frameId),
    pose: { position: { x: g.x, y: g.y, z: 0 }, orientation: { x: 0, y: 0, z: Math.sin(g.yaw / 2), w: Math.cos(g.yaw / 2) } },
  };
}

/** The same encoding choice as for Twist, for `geometry_msgs/PoseStamped` (what `/goal_pose` takes). */
export function pickGoalCodec(opts: Omit<CodecOptions, 'kind'>): GoalCodec | null {
  const enc = opts.supportedEncodings;
  const now = opts.nowMs ?? Date.now;
  const name = (ros2: boolean) => `geometry_msgs/${ros2 ? 'msg/' : ''}PoseStamped`;
  if (enc?.includes('cdr')) {
    const schema = POSE_STAMPED_SCHEMA(true);
    const writer = new Ros2MessageWriter(parseRosMsgDefinition(schema, { ros2: true }));
    return { encoding: 'cdr', schemaEncoding: 'ros2msg', schemaName: name(true), schema, encode: (g, f) => writer.writeMessage(poseStampedObject(g, true, now(), f)) };
  }
  if (enc?.includes('ros1')) {
    const schema = POSE_STAMPED_SCHEMA(false);
    const writer = new Ros1MessageWriter(parseRosMsgDefinition(schema, { ros2: false }));
    return { encoding: 'ros1', schemaEncoding: 'ros1msg', schemaName: name(false), schema, encode: (g, f) => writer.writeMessage(poseStampedObject(g, false, now(), f)) };
  }
  if (!enc || enc.includes('json')) {
    const ros2 = opts.ros2Names;
    return { encoding: 'json', schemaName: name(ros2), encode: (g, f) => new TextEncoder().encode(JSON.stringify(poseStampedObject(g, ros2, now(), f))) };
  }
  return null;
}
