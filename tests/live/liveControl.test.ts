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
  serverSendBinary(bytes: Uint8Array) {
    this.emit('message', { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) });
  }
  serverSendText(obj: object) {
    this.emit('message', { data: JSON.stringify(obj) });
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
    expect(view()).toEqual({ enabled: true, sendFailed: false, services: [] });
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
    expect(view()).toEqual({ enabled: false, sendFailed: false, services: [] });
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


// ── Service calls ───────────────────────────────────────────────────────────

const JSON_SERVICES = [
  { id: 7, name: '/reset_odometry', type: 'std_srvs/srv/Empty', request: { encoding: 'json', schemaEncoding: 'ros2msg', schema: '' }, response: { encoding: 'json', schema: '' } },
  { id: 8, name: '/set_speed', type: 'demo/srv/SetSpeed', request: { encoding: 'json', schemaEncoding: 'ros2msg', schema: 'float64 speed' }, response: { encoding: 'json', schema: 'bool ok' } },
];

/** [serviceId, callId, encoding, payload] for each service call the client sent. */
function calls(s: FakeSocket) {
  return s.sent.flatMap((f) => {
    if (!('bytes' in f) || f.bytes[0] !== 2) return [];
    const v = new DataView(f.bytes.buffer, f.bytes.byteOffset);
    const n = v.getUint32(9, true);
    return [[v.getUint32(1, true), v.getUint32(5, true), new TextDecoder().decode(f.bytes.slice(13, 13 + n)), f.bytes.slice(13 + n)] as const];
  });
}
function respond(s: FakeSocket, serviceId: number, callId: number, encoding: string, payload: Uint8Array) {
  const enc = new TextEncoder().encode(encoding);
  const out = new Uint8Array(13 + enc.length + payload.length);
  const v = new DataView(out.buffer);
  out[0] = 3;
  v.setUint32(1, serviceId, true);
  v.setUint32(5, callId, true);
  v.setUint32(9, enc.length, true);
  out.set(enc, 13);
  out.set(payload, 13 + enc.length);
  s.serverSendBinary(out);
}

describe('service calls', () => {
  const withServices = () => {
    const c = connect({ capabilities: ['clientPublish', 'services'], supportedEncodings: ['json'] });
    sock().serverSendText({ op: 'advertiseServices', services: JSON_SERVICES });
    return c;
  };

  it('lists advertised services in the store, sorted, and drops unadvertised ones', () => {
    withServices();
    expect(view()!.services.map((s) => s.name)).toEqual(['/reset_odometry', '/set_speed']);
    sock().serverSendText({ op: 'unadvertiseServices', serviceIds: [7] });
    expect(view()!.services.map((s) => s.name)).toEqual(['/set_speed']);
  });

  it('offers no services when the server lacks the services capability', () => {
    connect({ capabilities: ['clientPublish'], supportedEncodings: ['json'] });
    sock().serverSendText({ op: 'advertiseServices', services: JSON_SERVICES });
    expect(view()!.services).toEqual([]);
  });

  it('is refused until control is enabled, and sends nothing', async () => {
    const c = withServices();
    await expect(c.callService(7, {})).rejects.toThrow(/Enable control/);
    expect(calls(sock())).toEqual([]);
  });

  it('sends the request in the service\'s encoding and resolves with the decoded answer', async () => {
    const c = withServices();
    c.enableControl('/cmd_vel', 'Twist');
    const p = c.callService(8, { speed: 0.5 });
    const [serviceId, callId, encoding, payload] = calls(sock())[0]!;
    expect([serviceId, encoding]).toEqual([8, 'json']);
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({ speed: 0.5 });
    respond(sock(), 8, callId, 'json', new TextEncoder().encode('{"ok":true}'));
    await expect(p).resolves.toEqual({ ok: true });
  });

  it('gives each call its own id, and answers match their own call out of order', async () => {
    const c = withServices();
    c.enableControl('/cmd_vel', 'Twist');
    const a = c.callService(8, { speed: 1 });
    const b = c.callService(8, { speed: 2 });
    const [first, second] = calls(sock());
    expect(first![1]).not.toBe(second![1]);
    respond(sock(), 8, second![1], 'json', new TextEncoder().encode('{"ok":"second"}'));
    respond(sock(), 8, first![1], 'json', new TextEncoder().encode('{"ok":"first"}'));
    await expect(Promise.all([a, b])).resolves.toEqual([{ ok: 'first' }, { ok: 'second' }]);
  });

  it('rejects with the server\'s message when the call fails', async () => {
    const c = withServices();
    c.enableControl('/cmd_vel', 'Twist');
    const p = c.callService(7, {});
    sock().serverSendText({ op: 'serviceCallFailure', serviceId: 7, callId: calls(sock())[0]![1], message: 'no such motor' });
    await expect(p).rejects.toThrow('no such motor');
  });

  it('times out with a message that says the call may still have run', async () => {
    const c = withServices();
    c.enableControl('/cmd_vel', 'Twist');
    const p = c.callService(7, {}, 2000);
    const rejected = expect(p).rejects.toThrow(/may still have run/);
    vi.advanceTimersByTime(2100);
    await rejected;
    respond(sock(), 7, calls(sock())[0]![1], 'json', new TextEncoder().encode('{}')); // a late answer is ignored
  });

  it('a dropped connection fails calls in flight instead of leaving them hanging', async () => {
    const c = withServices();
    c.enableControl('/cmd_vel', 'Twist');
    const p = c.callService(7, {});
    const rejected = expect(p).rejects.toThrow(/connection was lost/);
    sock().drop();
    await rejected;
    expect(view()!.services).toEqual([]);
  });

  it('an answer to a call nobody made is ignored', () => {
    const c = withServices();
    c.enableControl('/cmd_vel', 'Twist');
    expect(() => respond(sock(), 7, 999, 'json', new TextEncoder().encode('{}'))).not.toThrow();
  });

  it('a service that vanished cannot be called', async () => {
    const c = withServices();
    c.enableControl('/cmd_vel', 'Twist');
    sock().serverSendText({ op: 'unadvertiseServices', serviceIds: [7] });
    await expect(c.callService(7, {})).rejects.toThrow(/no longer advertised/);
  });

  it('a request that cannot be encoded rejects without sending', async () => {
    const c = connect({ capabilities: ['clientPublish', 'services'], supportedEncodings: ['json'] });
    sock().serverSendText({ op: 'advertiseServices', services: [{ id: 1, name: '/x', type: 'x/X', request: { encoding: 'protobuf', schema: '' }, response: { encoding: 'json', schema: '' } }] });
    c.enableControl('/cmd_vel', 'Twist');
    await expect(c.callService(1, {})).rejects.toThrow(/protobuf/);
    expect(calls(sock())).toEqual([]);
  });
});
