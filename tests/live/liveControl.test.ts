/**
 * The real LiveConnection and FoxgloveClient against a fake Foxglove server:
 * what actually goes down the wire when someone arms control, drives, lets go,
 * or the connection drops.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageReader as Ros2Reader } from '@foxglove/rosmsg2-serialization';
import { parse as parseRosMsgDefinition } from '@foxglove/rosmsg';
import { LiveConnection } from '../../src/live/liveConnection';
import { useControlStore } from '../../src/store/controlStore';
import { useLiveStore } from '../../src/store/liveStore';

type Frame = { text: string } | { bytes: Uint8Array };

class FakeSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = 0;
  binaryType = '';
  sent: Frame[] = [];
  private listeners: Record<string, Array<(e: unknown) => void>> = {};
  constructor(readonly url: string, readonly protocol: string) {
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, cb: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  send(data: string | Uint8Array) {
    if (this.readyState !== 1) throw new Error('send on a socket that is not open');
    this.sent.push(typeof data === 'string' ? { text: data } : { bytes: new Uint8Array(data) });
  }
  close() {
    this.drop(1000, 'client closed');
  }
  // ── the server's side ──
  serverOpen(info: object) {
    this.readyState = 1;
    this.emit('message', { data: JSON.stringify({ op: 'serverInfo', name: 'fake', ...info }) });
  }
  drop(code = 1006, reason = 'gone') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close', { code, reason });
  }
  private emit(type: string, event: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
  get texts(): Array<Record<string, unknown>> {
    return this.sent.flatMap((f) => ('text' in f ? [JSON.parse(f.text) as Record<string, unknown>] : []));
  }
  /** Published messages as [channelId, payload]. */
  get published(): Array<[number, Uint8Array]> {
    return this.sent.flatMap((f) => ('bytes' in f && f.bytes[0] === 1 ? [[new DataView(f.bytes.buffer, f.bytes.byteOffset).getUint32(1, true), f.bytes.slice(5)] as [number, Uint8Array]] : []));
  }
}

const cdrReader = (schema: string) => new Ros2Reader(parseRosMsgDefinition(schema, { ros2: true }));

let conn: LiveConnection | null = null;
const sock = () => FakeSocket.instances[FakeSocket.instances.length - 1]!;
const CAPS = ['clientPublish', 'services'];

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});
afterEach(() => {
  conn?.disconnect();
  conn = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useLiveStore.setState({ statuses: new Map() });
});

const connect = (info: object = { capabilities: CAPS, supportedEncodings: ['cdr', 'json'] }) => {
  conn = new LiveConnection('bag-1', 'ws://robot:8765', () => {});
  sock().serverOpen(info);
  return conn;
};
const view = () => useControlStore.getState().views.get('bag-1');
const decodeTwist = (payload: Uint8Array) => {
  const schema = (sock().texts.find((t) => t.op === 'advertise') as { channels: Array<{ schema: string }> }).channels[0]!.schema;
  return cdrReader(schema).readMessage(payload) as { linear: { x: number }; angular: { z: number } };
};

describe('arming control', () => {
  it('advertises a client channel with the schema and encoding the server accepts', () => {
    const c = connect();
    expect(c.canPublish).toBe(true);
    expect(c.enableControl('/cmd_vel', 'Twist')).toBeNull();
    const adv = sock().texts.find((t) => t.op === 'advertise') as { channels: Array<Record<string, unknown>> };
    expect(adv.channels).toHaveLength(1);
    expect(adv.channels[0]).toMatchObject({ id: 1, topic: '/cmd_vel', encoding: 'cdr', schemaName: 'geometry_msgs/msg/Twist', schemaEncoding: 'ros2msg' });
    expect(view()).toEqual({ enabled: true, sendFailed: false });
  });

  it('refuses, and stays disarmed, when the server does not allow client publishing', () => {
    const c = connect({ capabilities: ['services'], supportedEncodings: ['cdr'] });
    expect(c.canPublish).toBe(false);
    expect(c.enableControl('/cmd_vel', 'Twist')).toMatch(/clientPublish/);
    expect(sock().sent).toEqual([]);
    expect(view()?.enabled).toBeFalsy();
  });

  it('refuses an invalid topic name before sending anything', () => {
    const c = connect();
    for (const bad of ['', 'cmd_vel', '/cmd vel', '/a;b', '/']) expect(c.enableControl(bad, 'Twist'), bad).toMatch(/topic/i);
    expect(sock().sent).toEqual([]);
  });

  it('uses JSON when the server only speaks JSON, and ROS 1 names for a ROS 1 bridge', () => {
    const c = connect({ capabilities: CAPS, supportedEncodings: ['json'] });
    c.enableControl('/cmd_vel', 'Twist');
    const adv = sock().texts.find((t) => t.op === 'advertise') as { channels: Array<Record<string, unknown>> };
    expect(adv.channels[0]).toMatchObject({ encoding: 'json', schemaName: 'geometry_msgs/msg/Twist' });
    expect(adv.channels[0]).not.toHaveProperty('schema');
  });
});

describe('driving over the wire', () => {
  it('publishes at 10 Hz while held and a zero on release, on the channel it advertised', () => {
    const c = connect();
    c.enableControl('/cmd_vel', 'Twist');
    c.teleop.setLimits(0.5, 1);
    c.teleop.drive(0.3, 0.2);
    vi.advanceTimersByTime(450); // immediate + 4 ticks
    const moving = sock().published;
    expect(moving.length).toBe(5);
    expect(moving.every(([id]) => id === 1)).toBe(true);
    expect(decodeTwist(moving[0]![1])).toMatchObject({ linear: { x: expect.closeTo(0.3, 5) }, angular: { z: expect.closeTo(0.2, 5) } });

    c.teleop.release();
    const all = sock().published;
    const last = decodeTwist(all[all.length - 1]![1]);
    expect(last.linear.x).toBe(0);
    expect(last.angular.z).toBe(0);
    vi.advanceTimersByTime(1000);
    const settled = sock().published.length;
    vi.advanceTimersByTime(5000);
    expect(sock().published.length).toBe(settled); // quiet again
  });

  it('disarming sends a zero, then withdraws the channel, in that order', () => {
    const c = connect();
    c.enableControl('/cmd_vel', 'Twist');
    c.teleop.drive(0.1, 0);
    c.teleop.disable();
    const order = sock().sent.map((f) => ('text' in f ? (JSON.parse(f.text) as { op: string }).op : 'publish'));
    expect(order.slice(-2)).toEqual(['publish', 'unadvertise']);
    const all = sock().published;
    expect(decodeTwist(all[all.length - 1]![1]).linear.x).toBe(0);
    expect(view()?.enabled).toBe(false);
  });

  it('closing the connection while driving stops the robot first', () => {
    const c = connect();
    c.enableControl('/cmd_vel', 'Twist');
    c.teleop.drive(0.1, 0);
    const s = sock();
    c.disconnect();
    conn = null;
    const all = s.published;
    expect(decodeTwist(all[all.length - 1]![1]).linear.x).toBe(0);
    expect(useControlStore.getState().views.has('bag-1')).toBe(false);
  });
});

describe('a dropped connection', () => {
  it('disarms without sending, and the reconnected socket starts disarmed and silent', () => {
    const c = connect();
    c.enableControl('/cmd_vel', 'Twist');
    c.teleop.drive(0.1, 0);
    const first = sock();
    const before = first.published.length;
    first.drop();
    expect(view()?.enabled).toBe(false);
    expect(first.published.length).toBe(before);

    // The controls are still being held in the page.
    c.teleop.drive(0.1, 0);
    vi.advanceTimersByTime(1500); // reconnect backoff is 1 s
    expect(FakeSocket.instances.length).toBe(2);
    const second = sock();
    second.serverOpen({ capabilities: CAPS, supportedEncodings: ['cdr'] });
    c.teleop.drive(0.1, 0);
    vi.advanceTimersByTime(2000);
    expect(second.sent).toEqual([]); // nothing, not even an advertise
    expect(view()).toEqual({ enabled: false, sendFailed: false });
  });

  it('arming again after a reconnect works and advertises on the new socket', () => {
    const c = connect();
    c.enableControl('/cmd_vel', 'Twist');
    sock().drop();
    vi.advanceTimersByTime(1500);
    sock().serverOpen({ capabilities: CAPS, supportedEncodings: ['cdr'] });
    expect(c.enableControl('/cmd_vel', 'Twist')).toBeNull();
    expect(sock().texts.some((t) => t.op === 'advertise')).toBe(true);
  });
});
