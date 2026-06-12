/**
 * Unit tests for FoxgloveClient binary/text frame parsing.
 *
 * We avoid instantiating the real class (it opens a WebSocket in the
 * constructor) and instead test the parsing logic by calling the private
 * handlers indirectly via a real instance with a mock WebSocket injected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FoxgloveClient, type FoxgloveEvent } from '../../src/live/foxgloveClient';

// Minimal mock WebSocket that records sends and lets tests fire events.
class MockWs {
  readyState = 1; // OPEN
  binaryType = '';
  private listeners: Record<string, ((e: unknown) => void)[]> = {};

  send = vi.fn();
  close = vi.fn();

  addEventListener(type: string, cb: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }

  emit(type: string, event: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(event);
  }
}

// Replace global WebSocket before constructing FoxgloveClient.
let mockWs: MockWs;

function makeClient(onEvent: (e: FoxgloveEvent) => void) {
  mockWs = new MockWs();
  vi.stubGlobal('WebSocket', class {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = mockWs.readyState;
    binaryType = '';
    constructor(_url: string, _proto: string) {
      // Copy event plumbing from mockWs
    }
    addEventListener(type: string, cb: (e: unknown) => void) {
      mockWs.addEventListener(type, cb);
    }
    send(data: string) { mockWs.send(data); }
    close() { mockWs.close(); }
  });
  const client = new FoxgloveClient('ws://localhost:8765', onEvent);
  return client;
}

function buildMessageDataFrame(subId: number, logTimeNs: bigint, payload: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(13 + payload.byteLength);
  const view = new DataView(buf);
  view.setUint8(0, 1); // OP_MESSAGE_DATA
  view.setUint32(1, subId, true);
  const lo = Number(logTimeNs & 0xffffffffn);
  const hi = Number((logTimeNs >> 32n) & 0xffffffffn);
  view.setUint32(5, lo, true);
  view.setUint32(9, hi, true);
  new Uint8Array(buf, 13).set(payload);
  return buf;
}

function buildTimeFrame(timestampNs: bigint): ArrayBuffer {
  const buf = new ArrayBuffer(9);
  const view = new DataView(buf);
  view.setUint8(0, 2); // OP_TIME
  const lo = Number(timestampNs & 0xffffffffn);
  const hi = Number((timestampNs >> 32n) & 0xffffffffn);
  view.setUint32(1, lo, true);
  view.setUint32(5, hi, true);
  return buf;
}

describe('FoxgloveClient', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('emits open event on serverInfo text frame', () => {
    const events: FoxgloveEvent[] = [];
    makeClient((e) => events.push(e));
    mockWs.emit('message', {
      data: JSON.stringify({ op: 'serverInfo', name: 'TestServer', capabilities: ['subscribe'] }),
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'open', serverName: 'TestServer' });
  });

  it('emits advertise event on advertise text frame', () => {
    const events: FoxgloveEvent[] = [];
    makeClient((e) => events.push(e));
    const channels = [{ id: 1, topic: '/scan', encoding: 'cdr', schemaName: 'sensor_msgs/LaserScan', schema: '' }];
    mockWs.emit('message', { data: JSON.stringify({ op: 'advertise', channels }) });
    expect(events[0]).toMatchObject({ type: 'advertise', channels });
  });

  it('emits unadvertise event', () => {
    const events: FoxgloveEvent[] = [];
    makeClient((e) => events.push(e));
    mockWs.emit('message', { data: JSON.stringify({ op: 'unadvertise', channelIds: [1, 2] }) });
    expect(events[0]).toMatchObject({ type: 'unadvertise', channelIds: [1, 2] });
  });

  it('emits error on status level >= 2', () => {
    const events: FoxgloveEvent[] = [];
    makeClient((e) => events.push(e));
    mockWs.emit('message', { data: JSON.stringify({ op: 'status', level: 2, message: 'oops' }) });
    expect(events[0]).toMatchObject({ type: 'error', message: 'oops' });
  });

  it('does not emit error on status level < 2', () => {
    const events: FoxgloveEvent[] = [];
    makeClient((e) => events.push(e));
    mockWs.emit('message', { data: JSON.stringify({ op: 'status', level: 1, message: 'info' }) });
    expect(events).toHaveLength(0);
  });

  it('parses MESSAGE_DATA binary frame correctly', () => {
    const events: FoxgloveEvent[] = [];
    const client = makeClient((e) => events.push(e));
    // Subscribe first so subIdToChannelId mapping exists
    mockWs.readyState = 1;
    // Manually wire subId->channelId by calling subscribe
    // (we bypass it by checking channelId=0 default for unknown subId)
    const timeNs = 1_700_000_000_000_000_000n;
    const payload = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const frame = buildMessageDataFrame(42, timeNs, payload);
    mockWs.emit('message', { data: frame });
    expect(events[0]).toMatchObject({ type: 'message', subscriptionId: 42, logTimeNs: timeNs });
    expect((events[0] as Extract<FoxgloveEvent, { type: 'message' }>).data).toEqual(payload);
    void client; // silence unused var
  });

  it('parses TIME binary frame correctly', () => {
    const events: FoxgloveEvent[] = [];
    makeClient((e) => events.push(e));
    const ts = 9_999_999_999_999_999_999n;
    const frame = buildTimeFrame(ts);
    mockWs.emit('message', { data: frame });
    expect(events[0]).toMatchObject({ type: 'time', timestampNs: ts });
  });

  it('ignores too-short binary frames', () => {
    const events: FoxgloveEvent[] = [];
    makeClient((e) => events.push(e));
    // MESSAGE_DATA needs >= 13 bytes
    const short = new ArrayBuffer(5);
    new DataView(short).setUint8(0, 1);
    mockWs.emit('message', { data: short });
    expect(events).toHaveLength(0);
  });

  it('subscribe sends correct JSON and returns sub ids', () => {
    const events: FoxgloveEvent[] = [];
    const client = makeClient((e) => events.push(e));
    // Patch ws readyState to OPEN via mockWs
    // The real client's ws.readyState check uses its internal ws reference.
    // We can't easily stub that, but we can verify mockWs.send was called.
    // Force readyState by patching the mock class static
    // Actually, FoxgloveClient checks ws.readyState === WebSocket.OPEN.
    // Our stubbed class has readyState = mockWs.readyState = 1 = OPEN.
    const subIds = client.subscribe([10, 20]);
    expect(subIds).toHaveLength(2);
    expect(mockWs.send).toHaveBeenCalled();
    const msg = JSON.parse(mockWs.send.mock.calls[0][0] as string);
    expect(msg.op).toBe('subscribe');
    expect(msg.subscriptions).toHaveLength(2);
    expect(msg.subscriptions[0].channelId).toBe(10);
    expect(msg.subscriptions[1].channelId).toBe(20);
  });
});
