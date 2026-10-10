import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MessageReader as Ros2Reader } from '@foxglove/rosmsg2-serialization';
import { MessageReader as Ros1Reader } from '@foxglove/rosmsg-serialization';
import { parse } from '@foxglove/rosmsg';
import { pickGoalCodec, pickPublishCodec } from '../../src/live/controlCodec';
import { dragToGoal, formatGoal, pickGroundLocal } from '../../src/components/panels/ThreeDScene/goalTool';
import { LiveConnection } from '../../src/live/liveConnection';
import { useLiveStore } from '../../src/store/liveStore';

describe('dragToGoal', () => {
  it('points from the start toward the end, counter-clockwise from +x', () => {
    expect(dragToGoal({ x: 1, y: 2 }, { x: 2, y: 2 }, 0.01)).toEqual({ x: 1, y: 2, yaw: 0 });
    expect(dragToGoal({ x: 0, y: 0 }, { x: 0, y: 3 }, 0.01)!.yaw).toBeCloseTo(Math.PI / 2, 12);
    expect(dragToGoal({ x: 0, y: 0 }, { x: -1, y: 0 }, 0.01)!.yaw).toBeCloseTo(Math.PI, 12);
    expect(dragToGoal({ x: 0, y: 0 }, { x: 0, y: -1 }, 0.01)!.yaw).toBeCloseTo(-Math.PI / 2, 12);
  });
  it('a click, or nonsense, carries no heading', () => {
    expect(dragToGoal({ x: 1, y: 1 }, { x: 1, y: 1 }, 0.01)).toBeNull();
    expect(dragToGoal({ x: 1, y: 1 }, { x: 1.001, y: 1 }, 0.01)).toBeNull();
    expect(dragToGoal({ x: NaN, y: 1 }, { x: 1, y: 1 }, 0.01)).toBeNull();
  });
  it('formats degrees in [0, 360)', () => {
    expect(formatGoal({ x: 1, y: -2.5, yaw: -Math.PI / 2 })).toBe('x 1.00 m, y -2.50 m, facing 270 deg');
  });
});

describe('pickGroundLocal', () => {
  const canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) } as HTMLCanvasElement;
  const topDown = () => {
    const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    cam.position.set(0, 0, 20);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    return cam;
  };

  it('maps a pixel to the ground point under it', () => {
    const world = new THREE.Group();
    const p = pickGroundLocal(topDown(), canvas, 150, 50, world)!; // right and up of centre
    expect(p.x).toBeCloseTo(5, 6);
    expect(p.y).toBeCloseTo(5, 6);
  });

  it('answers in the world group\'s own frame when the group is moved and turned', () => {
    const world = new THREE.Group();
    world.position.set(3, -2, 0);
    world.rotation.z = Math.PI / 2;
    world.updateMatrixWorld();
    // The scene point (5, 5) is the group point R^-1 * ((5,5) - (3,-2)) = (7, -2).
    const p = pickGroundLocal(topDown(), canvas, 150, 50, world)!;
    expect(p.x).toBeCloseTo(7, 6);
    expect(p.y).toBeCloseTo(-2, 6);
  });

  it('a ray parallel to the ground hits nothing', () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    cam.position.set(0, 0, 5);
    cam.lookAt(10, 0, 5);
    cam.updateMatrixWorld();
    expect(pickGroundLocal(cam, canvas, 100, 100, new THREE.Group())).toBeNull();
  });
});

describe('goal codecs', () => {
  const goal = { x: 1.5, y: -2, yaw: Math.PI / 2 };
  const now = () => 1_700_000_000_250.5;

  it('CDR PoseStamped decodes with the standard reader: frame, stamp, position and yaw as a quaternion', () => {
    const c = pickGoalCodec({ supportedEncodings: ['cdr'], ros2Names: true, nowMs: now })!;
    expect(c.schemaName).toBe('geometry_msgs/msg/PoseStamped');
    const v = new Ros2Reader(parse(c.schema!, { ros2: true })).readMessage(c.encode(goal, 'map')) as {
      header: { stamp: { sec: number; nanosec: number }; frame_id: string };
      pose: { position: { x: number; y: number; z: number }; orientation: { x: number; y: number; z: number; w: number } };
    };
    expect(v.header).toEqual({ stamp: { sec: 1_700_000_000, nanosec: 250_500_000 }, frame_id: 'map' });
    expect(v.pose.position).toEqual({ x: 1.5, y: -2, z: 0 });
    expect(v.pose.orientation.z).toBeCloseTo(Math.SQRT1_2, 12);
    expect(v.pose.orientation.w).toBeCloseTo(Math.SQRT1_2, 12);
    expect(v.pose.orientation.x).toBe(0);
  });

  it('ROS 1 PoseStamped includes the sequence number in its header', () => {
    const c = pickGoalCodec({ supportedEncodings: ['ros1'], ros2Names: false, nowMs: now })!;
    expect(c.schemaName).toBe('geometry_msgs/PoseStamped');
    const v = new Ros1Reader(parse(c.schema!, { ros2: false })).readMessage(c.encode(goal, 'odom')) as { header: { seq: number; frame_id: string; stamp: { sec: number; nsec: number } } };
    expect(v.header).toEqual({ seq: 0, stamp: { sec: 1_700_000_000, nsec: 250_500_000 }, frame_id: 'odom' });
  });

  it('ROS 1 TwistStamped has the sequence number too (its header was wrong without it)', () => {
    const c = pickPublishCodec({ supportedEncodings: ['ros1'], kind: 'TwistStamped', ros2Names: false, nowMs: now })!;
    const bytes = c.encode({ linear: 0.5, angular: 0 });
    const v = new Ros1Reader(parse(c.schema!, { ros2: false })).readMessage(bytes) as { header: { seq: number }; twist: { linear: { x: number } } };
    expect(v.header.seq).toBe(0);
    expect(v.twist.linear.x).toBe(0.5);
    // seq (4) + sec (4) + nsec (4) + frame_id length (4) + 6 doubles (48)
    expect(bytes.length).toBe(16 + 48);
  });

  it('JSON PoseStamped, and no codec when the server speaks none we write', () => {
    const c = pickGoalCodec({ supportedEncodings: ['json'], ros2Names: true, nowMs: now })!;
    const v = JSON.parse(new TextDecoder().decode(c.encode({ x: 0, y: 0, yaw: 0 }, 'map')));
    expect(v.header.frame_id).toBe('map');
    expect(v.pose.orientation).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect(pickGoalCodec({ supportedEncodings: ['protobuf'], ros2Names: true })).toBeNull();
  });

  it('a heading of any size gives a unit quaternion', () => {
    const c = pickGoalCodec({ supportedEncodings: ['json'], ros2Names: true })!;
    for (const yaw of [-7, -Math.PI, 0, 0.1, Math.PI, 6.5, 100]) {
      const q = JSON.parse(new TextDecoder().decode(c.encode({ x: 0, y: 0, yaw }, 'm'))).pose.orientation;
      expect(Math.hypot(q.x, q.y, q.z, q.w)).toBeCloseTo(1, 12);
    }
  });
});

// ── Through the real connection ─────────────────────────────────────────────

class Sock {
  static OPEN = 1;
  static CLOSED = 3;
  static all: Sock[] = [];
  readyState = 0;
  binaryType = '';
  sent: Array<string | Uint8Array> = [];
  private l: Record<string, Array<(e: unknown) => void>> = {};
  constructor() {
    Sock.all.push(this);
  }
  addEventListener(t: string, cb: (e: unknown) => void) {
    (this.l[t] ??= []).push(cb);
  }
  send(d: string | Uint8Array) {
    if (this.readyState !== 1) throw new Error('closed');
    this.sent.push(typeof d === 'string' ? d : new Uint8Array(d));
  }
  close() {
    this.drop();
  }
  open(info: object) {
    this.readyState = 1;
    this.emit('message', { data: JSON.stringify({ op: 'serverInfo', name: 'f', ...info }) });
  }
  drop() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', { code: 1006, reason: '' });
  }
  private emit(t: string, e: unknown) {
    for (const cb of this.l[t] ?? []) cb(e);
  }
  get ops(): string[] {
    return this.sent.map((f) => (typeof f === 'string' ? (JSON.parse(f) as { op: string }).op : `bin${f[0]}:ch${new DataView(f.buffer, f.byteOffset).getUint32(1, true)}`));
  }
}

let conn: LiveConnection | null = null;
const sock = () => Sock.all[Sock.all.length - 1]!;
beforeEach(() => {
  vi.useFakeTimers();
  Sock.all = [];
  vi.stubGlobal('WebSocket', Sock);
});
afterEach(() => {
  conn?.disconnect();
  conn = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useLiveStore.setState({ statuses: new Map() });
});
const connect = () => {
  conn = new LiveConnection('g1', 'ws://r:1', () => {});
  sock().open({ capabilities: ['clientPublish'], supportedEncodings: ['json'] });
  return conn;
};
const GOAL = { x: 1, y: 2, yaw: 0.5 };

describe('publishGoal', () => {
  it('is refused until control is enabled, and sends nothing', () => {
    const c = connect();
    expect(c.publishGoal('/goal_pose', GOAL, 'map')).toMatch(/Enable control/);
    expect(sock().sent).toEqual([]);
  });

  it('refuses without a frame, a bad topic or a non-finite goal, before advertising', () => {
    const c = connect();
    c.enableControl('/cmd_vel', 'Twist');
    const n = sock().sent.length;
    expect(c.publishGoal('/goal_pose', GOAL, '')).toMatch(/fixed frame/);
    expect(c.publishGoal('goal pose', GOAL, 'map')).toMatch(/topic/i);
    expect(c.publishGoal('/goal_pose', { x: NaN, y: 0, yaw: 0 }, 'map')).toMatch(/valid/);
    expect(sock().sent.length).toBe(n);
  });

  it('advertises its own channel once, then reuses it, and re-advertises for a new topic', () => {
    const c = connect();
    c.enableControl('/cmd_vel', 'Twist');
    expect(c.publishGoal('/goal_pose', GOAL, 'map')).toBeNull();
    expect(c.publishGoal('/goal_pose', GOAL, 'map')).toBeNull();
    expect(sock().ops.slice(-3)).toEqual(['advertise', 'bin1:ch2', 'bin1:ch2']);
    expect(c.publishGoal('/other_goal', GOAL, 'map')).toBeNull();
    expect(sock().ops.slice(-3)).toEqual(['unadvertise', 'advertise', 'bin1:ch2']);
    const frame = sock().sent[sock().sent.length - 1] as Uint8Array;
    expect(JSON.parse(new TextDecoder().decode(frame.slice(5))).header.frame_id).toBe('map');
  });

  it('disarming withdraws the goal channel, and goals are refused again', () => {
    const c = connect();
    c.enableControl('/cmd_vel', 'Twist');
    c.publishGoal('/goal_pose', GOAL, 'map');
    c.teleop.disable();
    const ops = sock().ops;
    expect(ops.filter((o) => o === 'unadvertise')).toHaveLength(2); // cmd_vel and the goal channel
    expect(c.publishGoal('/goal_pose', GOAL, 'map')).toMatch(/Enable control/);
  });

  it('a drop forgets the channel; after a reconnect and re-arm it advertises afresh', () => {
    const c = connect();
    c.enableControl('/cmd_vel', 'Twist');
    c.publishGoal('/goal_pose', GOAL, 'map');
    sock().drop();
    vi.advanceTimersByTime(1500);
    sock().open({ capabilities: ['clientPublish'], supportedEncodings: ['json'] });
    expect(sock().sent).toEqual([]); // nothing on the new socket until someone arms it
    c.enableControl('/cmd_vel', 'Twist');
    c.publishGoal('/goal_pose', GOAL, 'map');
    expect(sock().ops).toEqual(['advertise', 'advertise', 'bin1:ch2']);
  });
});
