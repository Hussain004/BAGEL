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
const TWIST_STAMPED_SCHEMA = (ros2: boolean) =>
  `std_msgs/Header header\ngeometry_msgs/Twist twist\n${RULE}\nMSG: std_msgs/Header\n${
    ros2 ? 'builtin_interfaces/Time stamp' : 'time stamp'
  }\nstring frame_id\n${
    ros2 ? `${RULE}\nMSG: builtin_interfaces/Time\nint32 sec\nuint32 nanosec\n` : ''
  }${RULE}\nMSG: geometry_msgs/Twist\ngeometry_msgs/Vector3 linear\ngeometry_msgs/Vector3 angular\n${VECTOR3}`;

/** Forward speed on x, turn rate on z, everything else zero: a ground robot's command. */
function twistObject(t: Twist) {
  return { linear: { x: t.linear, y: 0, z: 0 }, angular: { x: 0, y: 0, z: t.angular } };
}

function stampedObject(t: Twist, ros2: boolean, nowMs: number) {
  const sec = Math.floor(nowMs / 1000);
  const frac = Math.round((nowMs - sec * 1000) * 1e6);
  return {
    header: { stamp: ros2 ? { sec, nanosec: frac } : { sec, nsec: frac }, frame_id: '' },
    twist: twistObject(t),
  };
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
