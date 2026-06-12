/**
 * Foxglove WebSocket client - foxglove.websocket.v1 protocol.
 *
 * Handles the binary/JSON framing, channel subscriptions, and connection
 * lifecycle. Consumers receive typed FoxgloveEvent objects; they do not need
 * to know anything about the wire format.
 *
 * Binary ops from server (uint8 prefix):
 *   1 = MESSAGE_DATA: [op:1][subId:4 LE][logTimeNs:8 LE][data:...]
 *   2 = TIME:         [op:1][timestampNs:8 LE]
 *
 * JSON text frames from server: op in { serverInfo, advertise, unadvertise, status }
 * JSON text frames from client: op in { subscribe, unsubscribe }
 */

export interface FoxgloveChannel {
  id: number;
  topic: string;
  encoding: string;
  schemaName: string;
  schema: string;
  schemaEncoding?: string;
}

type ServerTextOp =
  | { op: 'serverInfo'; name: string; capabilities: string[]; supportedEncodings?: string[] }
  | { op: 'advertise'; channels: FoxgloveChannel[] }
  | { op: 'unadvertise'; channelIds: number[] }
  | { op: 'status'; level: number; message: string };

export type FoxgloveEvent =
  | { type: 'open'; serverName: string; capabilities: string[] }
  | { type: 'close'; code: number; reason: string }
  | { type: 'advertise'; channels: FoxgloveChannel[] }
  | { type: 'unadvertise'; channelIds: number[] }
  | { type: 'message'; subscriptionId: number; channelId: number; logTimeNs: bigint; data: Uint8Array }
  | { type: 'time'; timestampNs: bigint }
  | { type: 'error'; message: string };

const OP_MESSAGE_DATA = 1;
const OP_TIME = 2;

export class FoxgloveClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly onEvent: (e: FoxgloveEvent) => void;
  private subIdToChannelId = new Map<number, number>();
  private nextSubId = 1;
  private disposed = false;

  constructor(url: string, onEvent: (e: FoxgloveEvent) => void) {
    this.url = url;
    this.onEvent = onEvent;
    this.openSocket();
  }

  private openSocket(): void {
    if (this.disposed) return;
    try {
      const ws = new WebSocket(this.url, 'foxglove.websocket.v1');
      ws.binaryType = 'arraybuffer';
      this.ws = ws;

      ws.addEventListener('message', (e) => {
        if (typeof e.data === 'string') {
          this.handleText(e.data);
        } else {
          this.handleBinary(e.data as ArrayBuffer);
        }
      });

      ws.addEventListener('close', (e) => {
        this.ws = null;
        if (!this.disposed) {
          this.onEvent({ type: 'close', code: e.code, reason: e.reason });
        }
      });

      ws.addEventListener('error', () => {
        this.onEvent({ type: 'error', message: 'WebSocket connection error' });
      });
    } catch (err) {
      this.onEvent({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to open WebSocket',
      });
    }
  }

  private handleText(raw: string): void {
    let msg: ServerTextOp;
    try {
      msg = JSON.parse(raw) as ServerTextOp;
    } catch {
      return;
    }

    switch (msg.op) {
      case 'serverInfo':
        this.onEvent({
          type: 'open',
          serverName: msg.name,
          capabilities: msg.capabilities,
        });
        break;

      case 'advertise':
        this.onEvent({ type: 'advertise', channels: msg.channels });
        break;

      case 'unadvertise':
        this.onEvent({ type: 'unadvertise', channelIds: msg.channelIds });
        break;

      case 'status':
        // Level 2 = error, per foxglove.websocket.v1 spec.
        if (msg.level >= 2) {
          this.onEvent({ type: 'error', message: msg.message });
        }
        break;
    }
  }

  private handleBinary(buf: ArrayBuffer): void {
    if (buf.byteLength < 1) return;
    const view = new DataView(buf);
    const op = view.getUint8(0);

    if (op === OP_MESSAGE_DATA) {
      if (buf.byteLength < 13) return;
      const subId = view.getUint32(1, true);
      // u64 little-endian as two u32 halves (JS lacks native u64 reads).
      const lo = BigInt(view.getUint32(5, true));
      const hi = BigInt(view.getUint32(9, true));
      const logTimeNs = (hi << 32n) | lo;
      const data = new Uint8Array(buf, 13);
      const channelId = this.subIdToChannelId.get(subId) ?? 0;
      this.onEvent({ type: 'message', subscriptionId: subId, channelId, logTimeNs, data });
      return;
    }

    if (op === OP_TIME) {
      if (buf.byteLength < 9) return;
      const lo = BigInt(view.getUint32(1, true));
      const hi = BigInt(view.getUint32(5, true));
      const timestampNs = (hi << 32n) | lo;
      this.onEvent({ type: 'time', timestampNs });
    }
  }

  /**
   * Subscribe to channels by channel ID. Returns the assigned subscription IDs
   * in the same order as the input. Returns empty array when not connected.
   */
  subscribe(channelIds: number[]): number[] {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return [];
    const subscriptions = channelIds.map((channelId) => {
      const id = this.nextSubId++;
      this.subIdToChannelId.set(id, channelId);
      return { id, channelId };
    });
    this.ws.send(JSON.stringify({ op: 'subscribe', subscriptions }));
    return subscriptions.map((s) => s.id);
  }

  /** Unsubscribe by subscription ID (not channel ID). */
  unsubscribe(subIds: number[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const id of subIds) this.subIdToChannelId.delete(id);
    this.ws.send(JSON.stringify({ op: 'unsubscribe', subscriptionIds: subIds }));
  }

  dispose(): void {
    this.disposed = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }
}
