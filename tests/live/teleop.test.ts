import { describe, expect, it } from 'vitest';
import { MessageReader as Ros2Reader } from '@foxglove/rosmsg2-serialization';
import { MessageReader as Ros1Reader } from '@foxglove/rosmsg-serialization';
import { parse as parseRosMsgDefinition } from '@foxglove/rosmsg';
import { pickPublishCodec, type PublishCodec, type Twist } from '../../src/live/controlCodec';
import { MAX_ANGULAR, MAX_LINEAR, TAIL_ZEROS, TeleopController, type TeleopIo } from '../../src/live/teleop';
import {
  OP_CLIENT_MESSAGE_DATA,
  OP_SERVICE_CALL_REQUEST,
  OP_SERVICE_CALL_RESPONSE,
  decodeServiceResponse,
  encodeClientPublish,
  encodeServiceCall,
} from '../../src/live/clientProtocol';

// ── Wire bytes ──────────────────────────────────────────────────────────────

describe('client protocol frames', () => {
  it('publish is [0x01][channel u32 LE][payload]', () => {
    const f = encodeClientPublish(0x01020304, Uint8Array.from([9, 8, 7]));
    expect(Array.from(f)).toEqual([OP_CLIENT_MESSAGE_DATA, 4, 3, 2, 1, 9, 8, 7]);
    expect(Array.from(encodeClientPublish(7, new Uint8Array(0)))).toEqual([1, 7, 0, 0, 0]);
  });

  it('a service call is [0x02][service u32][call u32][encoding length u32][encoding][payload]', () => {
    const f = encodeServiceCall({ serviceId: 5, callId: 0x0a0b, encoding: 'json', payload: Uint8Array.from([1, 2]) });
    expect(Array.from(f)).toEqual([OP_SERVICE_CALL_REQUEST, 5, 0, 0, 0, 0x0b, 0x0a, 0, 0, 4, 0, 0, 0, 0x6a, 0x73, 0x6f, 0x6e, 1, 2]);
  });

  it('a service response decodes, including an empty payload and a long encoding name', () => {
    const body = encodeServiceCall({ serviceId: 9, callId: 3, encoding: 'cdr', payload: Uint8Array.from([5, 6, 7]) });
    body[0] = OP_SERVICE_CALL_RESPONSE;
    expect(decodeServiceResponse(body.buffer)).toEqual({ serviceId: 9, callId: 3, encoding: 'cdr', payload: Uint8Array.from([5, 6, 7]) });
    const empty = encodeServiceCall({ serviceId: 1, callId: 2, encoding: 'x'.repeat(40), payload: new Uint8Array(0) });
    empty[0] = OP_SERVICE_CALL_RESPONSE;
    expect(decodeServiceResponse(empty.buffer)!.payload).toHaveLength(0);
    expect(decodeServiceResponse(empty.buffer)!.encoding).toBe('x'.repeat(40));
  });

  it('rejects short frames, wrong opcodes and lengths that run past the end', () => {
    expect(decodeServiceResponse(new ArrayBuffer(12))).toBeNull();
    const wrong = encodeServiceCall({ serviceId: 1, callId: 1, encoding: 'json', payload: new Uint8Array(0) });
    expect(decodeServiceResponse(wrong.buffer)).toBeNull(); // opcode 0x02, not 0x03
    const lying = new Uint8Array(13);
    lying[0] = OP_SERVICE_CALL_RESPONSE;
    lying[9] = 200;
    expect(decodeServiceResponse(lying.buffer)).toBeNull();
  });
});

// ── Encoders ────────────────────────────────────────────────────────────────

describe('publish codecs', () => {
  const fixedNow = () => 1_700_000_000_250.5;

  it('CDR twist decodes with the reader the live view uses, for ground-robot axes only', () => {
    const codec = pickPublishCodec({ supportedEncodings: ['cdr', 'json'], kind: 'Twist', ros2Names: true })!;
    expect(codec.encoding).toBe('cdr');
    expect(codec.schemaName).toBe('geometry_msgs/msg/Twist');
    const reader = new Ros2Reader(parseRosMsgDefinition(codec.schema!, { ros2: true }));
    expect(reader.readMessage(codec.encode({ linear: 0.25, angular: -0.5 }))).toEqual({ linear: { x: 0.25, y: 0, z: 0 }, angular: { x: 0, y: 0, z: -0.5 } });
  });

  it('CDR TwistStamped carries a header stamped now', () => {
    const codec = pickPublishCodec({ supportedEncodings: ['cdr'], kind: 'TwistStamped', ros2Names: true, nowMs: fixedNow })!;
    expect(codec.schemaName).toBe('geometry_msgs/msg/TwistStamped');
    const reader = new Ros2Reader(parseRosMsgDefinition(codec.schema!, { ros2: true }));
    const v = reader.readMessage(codec.encode({ linear: 1, angular: 0 })) as { header: { stamp: { sec: number; nanosec: number }; frame_id: string }; twist: { linear: { x: number } } };
    expect(v.header.stamp.sec).toBe(1_700_000_000);
    expect(v.header.stamp.nanosec).toBe(250_500_000);
    expect(v.header.frame_id).toBe('');
    expect(v.twist.linear.x).toBe(1);
  });

  it('ROS 1 serialisation round-trips, with ROS 1 type names', () => {
    const codec = pickPublishCodec({ supportedEncodings: ['ros1'], kind: 'Twist', ros2Names: false })!;
    expect(codec).toMatchObject({ encoding: 'ros1', schemaEncoding: 'ros1msg', schemaName: 'geometry_msgs/Twist' });
    const reader = new Ros1Reader(parseRosMsgDefinition(codec.schema!, { ros2: false }));
    expect(reader.readMessage(codec.encode({ linear: 0.1, angular: 0.2 }))).toEqual({ linear: { x: 0.1, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0.2 } });
    const stamped = pickPublishCodec({ supportedEncodings: ['ros1'], kind: 'TwistStamped', ros2Names: false, nowMs: fixedNow })!;
    const r2 = new Ros1Reader(parseRosMsgDefinition(stamped.schema!, { ros2: false }));
    const v = r2.readMessage(stamped.encode({ linear: 0, angular: 1 })) as { header: { stamp: { sec: number; nsec: number } } };
    expect(v.header.stamp).toEqual({ sec: 1_700_000_000, nsec: 250_500_000 });
  });

  it('falls back to JSON, and also when the server says nothing', () => {
    for (const supportedEncodings of [['json'], undefined]) {
      const codec = pickPublishCodec({ supportedEncodings, kind: 'Twist', ros2Names: true })!;
      expect(codec.encoding).toBe('json');
      expect(JSON.parse(new TextDecoder().decode(codec.encode({ linear: 0.5, angular: 0 })))).toEqual({ linear: { x: 0.5, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } });
    }
    expect(pickPublishCodec({ supportedEncodings: ['protobuf'], kind: 'Twist', ros2Names: true })).toBeNull();
  });

  it('prefers CDR over ROS 1 over JSON', () => {
    expect(pickPublishCodec({ supportedEncodings: ['json', 'ros1', 'cdr'], kind: 'Twist', ros2Names: true })!.encoding).toBe('cdr');
    expect(pickPublishCodec({ supportedEncodings: ['json', 'ros1'], kind: 'Twist', ros2Names: true })!.encoding).toBe('ros1');
  });

  it('writes a negative zero as zero-valued and every speed exactly', () => {
    const codec = pickPublishCodec({ supportedEncodings: ['cdr'], kind: 'Twist', ros2Names: true })!;
    const reader = new Ros2Reader(parseRosMsgDefinition(codec.schema!, { ros2: true }));
    for (const linear of [0, -0, 0.2, -2, 1e-9]) {
      const v = reader.readMessage(codec.encode({ linear, angular: 0 })) as { linear: { x: number } };
      expect(v.linear.x === linear).toBe(true);
    }
  });
});

// ── The teleop state machine ────────────────────────────────────────────────

class Rig {
  sent: Twist[] = [];
  advertised: string[] = [];
  unadvertised = 0;
  open = true;
  accept = true;
  private timers = new Map<number, () => void>();
  private nextTimer = 1;
  changes = 0;

  codec: PublishCodec = {
    encoding: 'json',
    schemaName: 'geometry_msgs/msg/Twist',
    encode: (t) => new TextEncoder().encode(JSON.stringify(t)),
  };

  io: TeleopIo = {
    advertise: (topic) => {
      if (!this.accept) return false;
      this.advertised.push(topic);
      return true;
    },
    unadvertise: () => {
      this.unadvertised++;
    },
    send: (payload) => {
      if (!this.open) return false;
      this.sent.push(JSON.parse(new TextDecoder().decode(payload)) as Twist);
      return true;
    },
    setInterval: (fn) => {
      const id = this.nextTimer++;
      this.timers.set(id, fn);
      return id;
    },
    clearInterval: (h) => {
      this.timers.delete(h as number);
    },
  };

  c = new TeleopController(this.io, () => this.changes++);

  get timersRunning(): number {
    return this.timers.size;
  }
  tick(n = 1): void {
    for (let i = 0; i < n; i++) for (const fn of [...this.timers.values()]) fn();
  }
  get last(): Twist | undefined {
    return this.sent[this.sent.length - 1];
  }
}

const isZero = (t: Twist | undefined) => !!t && t.linear === 0 && t.angular === 0;

describe('TeleopController safety rules', () => {
  it('sends nothing until armed, whatever the controls do', () => {
    const r = new Rig();
    r.c.drive(1, 1);
    r.c.release();
    r.tick(5);
    expect(r.sent).toEqual([]);
    expect(r.timersRunning).toBe(0);
    expect(r.advertised).toEqual([]);
  });

  it('arming advertises the topic, and fails closed if the server will not take it', () => {
    const r = new Rig();
    r.accept = false;
    expect(r.c.enable('/cmd_vel', r.codec)).toBe(false);
    expect(r.c.enabled).toBe(false);
    r.c.drive(0.1, 0);
    expect(r.sent).toEqual([]);
    r.accept = true;
    expect(r.c.enable('/cmd_vel', r.codec)).toBe(true);
    expect(r.c.enabled).toBe(true);
    expect(r.advertised).toEqual(['/cmd_vel']);
  });

  it('driving publishes at once, then every tick, clamped to the limits', () => {
    const r = new Rig();
    r.c.enable('/cmd_vel', r.codec);
    r.c.setLimits(0.3, 0.6);
    r.c.drive(5, -5);
    expect(r.sent).toEqual([{ linear: 0.3, angular: -0.6 }]);
    r.tick(3);
    expect(r.sent).toHaveLength(4);
    expect(r.sent.every((t) => t.linear === 0.3 && t.angular === -0.6)).toBe(true);
  });

  it('limits cannot exceed the hard ceilings, and nonsense becomes zero', () => {
    const r = new Rig();
    r.c.enable('/cmd_vel', r.codec);
    r.c.setLimits(50, 50);
    expect(r.c.limits).toEqual({ linear: MAX_LINEAR, angular: MAX_ANGULAR });
    r.c.drive(NaN, Infinity); // non-finite means zero, not full speed
    expect(r.sent).toEqual([]);
    r.c.drive(NaN, 99);
    expect(r.sent).toEqual([{ linear: 0, angular: MAX_ANGULAR }]);
    r.c.setLimits(NaN, -3);
    expect(r.c.limits).toEqual({ linear: 0, angular: 0 });
  });

  it('release sends a zero immediately, then the tail zeros, then goes quiet', () => {
    const r = new Rig();
    r.c.enable('/cmd_vel', r.codec);
    r.c.drive(0.2, 0);
    r.c.release();
    expect(isZero(r.last)).toBe(true);
    const before = r.sent.length;
    r.tick(10);
    expect(r.sent.length - before).toBe(TAIL_ZEROS);
    expect(r.sent.slice(-TAIL_ZEROS - 1).every(isZero)).toBe(true);
    expect(r.timersRunning).toBe(0);
    r.tick(10);
    expect(r.sent.length - before).toBe(TAIL_ZEROS); // silence after the tail
  });

  it('releasing when nothing was sent does not publish a pointless zero', () => {
    const r = new Rig();
    r.c.enable('/cmd_vel', r.codec);
    r.c.release();
    expect(r.sent).toEqual([]);
  });

  it('driving again during the tail cancels it', () => {
    const r = new Rig();
    r.c.enable('/cmd_vel', r.codec);
    r.c.drive(0.1, 0);
    r.c.release();
    r.c.drive(0.1, 0);
    r.tick(5);
    expect(r.sent.slice(-5).every((t) => t.linear === 0.1)).toBe(true);
  });

  it('driving zero is a release', () => {
    const r = new Rig();
    r.c.enable('/cmd_vel', r.codec);
    r.c.drive(0.1, 0);
    r.c.drive(0, 0);
    expect(isZero(r.last)).toBe(true);
  });

  it('disarming mid-drive sends a zero before withdrawing the channel, and stops publishing', () => {
    const r = new Rig();
    r.c.enable('/cmd_vel', r.codec);
    r.c.drive(0.2, 0);
    r.c.disable();
    expect(isZero(r.last)).toBe(true);
    expect(r.unadvertised).toBe(1);
    expect(r.c.enabled).toBe(false);
    const n = r.sent.length;
    r.tick(5);
    r.c.drive(1, 1);
    expect(r.sent.length).toBe(n);
    expect(r.timersRunning).toBe(0);
  });

  it('a lost connection disarms without sending, and a reconnect does not resume driving', () => {
    const r = new Rig();
    r.c.enable('/cmd_vel', r.codec);
    r.c.drive(0.2, 0);
    const n = r.sent.length;
    r.open = false;
    r.c.connectionLost();
    expect(r.c.enabled).toBe(false);
    expect(r.timersRunning).toBe(0);
    expect(r.sent.length).toBe(n);
    r.open = true; // "reconnected"
    r.tick(5);
    r.c.drive(0.2, 0);
    expect(r.sent.length).toBe(n); // still silent: nothing re-armed it
  });

  it('flags a failed send so the screen can say the robot may not have stopped', () => {
    const r = new Rig();
    r.c.enable('/cmd_vel', r.codec);
    r.c.drive(0.2, 0);
    expect(r.c.sendFailed).toBe(false);
    r.open = false;
    r.c.release();
    expect(r.c.sendFailed).toBe(true);
  });

  it('arming again while armed disarms first (a zero, then a fresh channel)', () => {
    const r = new Rig();
    r.c.enable('/cmd_vel', r.codec);
    r.c.drive(0.2, 0);
    r.c.enable('/other', r.codec);
    expect(r.unadvertised).toBe(1);
    expect(r.advertised).toEqual(['/cmd_vel', '/other']);
    expect(isZero(r.last)).toBe(true);
    expect(r.c.enabled).toBe(true);
  });

  it('lowering the limit while moving lowers the command in flight', () => {
    const r = new Rig();
    r.c.enable('/cmd_vel', r.codec);
    r.c.setLimits(1, 1);
    r.c.drive(0.9, 0);
    r.c.setLimits(0.1, 1);
    r.tick();
    expect(r.last).toEqual({ linear: 0.1, angular: 0 });
  });

  it('notifies on arming and disarming only', () => {
    const r = new Rig();
    r.c.enable('/cmd_vel', r.codec);
    r.c.drive(0.1, 0);
    r.tick(3);
    r.c.disable();
    expect(r.changes).toBe(2);
  });
});

describe('the safety property, over random sequences', () => {
  // A small seeded generator so a failure reproduces.
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it('after any sequence that ends in a release, the last command sent is zero and nothing is left running', () => {
    for (let seed = 1; seed <= 400; seed++) {
      const rand = rng(seed);
      const r = new Rig();
      const ops: string[] = [];
      const steps = 5 + Math.floor(rand() * 40);
      for (let i = 0; i < steps; i++) {
        const k = Math.floor(rand() * 8);
        if (k === 0) { ops.push('enable'); r.c.enable('/cmd_vel', r.codec); }
        else if (k === 1) { ops.push('disable'); r.c.disable(); }
        else if (k <= 3) { const l = (rand() - 0.5) * 6, a = (rand() - 0.5) * 8; ops.push(`drive ${l.toFixed(2)} ${a.toFixed(2)}`); r.c.drive(l, a); }
        else if (k === 4) { ops.push('release'); r.c.release(); }
        else if (k === 5) { ops.push('limits'); r.c.setLimits(rand() * 3, rand() * 4); }
        else { ops.push('tick'); r.tick(1 + Math.floor(rand() * 3)); }
      }
      ops.push('release');
      r.c.release();
      r.tick(20);
      const trace = `seed ${seed}: ${ops.join(', ')}`;
      expect(r.timersRunning, trace).toBe(0);
      const everMoved = r.sent.some((t) => !isZero(t));
      if (everMoved) expect(isZero(r.last), trace).toBe(true);
      // Never beyond the hard ceilings.
      expect(r.sent.every((t) => Math.abs(t.linear) <= MAX_LINEAR && Math.abs(t.angular) <= MAX_ANGULAR), trace).toBe(true);
    }
  });

  it('after a lost connection, nothing more is ever sent, whatever the controls do', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const rand = rng(seed * 7919);
      const r = new Rig();
      r.c.enable('/cmd_vel', r.codec);
      for (let i = 0; i < 6; i++) { r.c.drive(rand(), rand()); r.tick(); }
      r.c.connectionLost();
      const n = r.sent.length;
      for (let i = 0; i < 20; i++) {
        const k = Math.floor(rand() * 4);
        if (k === 0) r.c.drive(rand(), rand());
        else if (k === 1) r.c.release();
        else if (k === 2) r.c.disable();
        else r.tick();
      }
      expect(r.sent.length, `seed ${seed}`).toBe(n);
      expect(r.timersRunning).toBe(0);
    }
  });
});
