/**
 * LiveConnection - orchestrates a single Foxglove WebSocket connection.
 *
 * Responsibilities:
 *   - Creates and owns a FoxgloveClient, reconnects on drop.
 *   - Subscribes each channel exactly once per connection: the `open`
 *     resubscribe and the `advertise` handler share a per-connection set.
 *   - Decodes incoming messages and pushes them into a LiveRingBuffer.
 *   - Throttles liveStore revision bumps to one per animation frame so
 *     React re-renders cap at ~60 Hz regardless of message rate.
 *   - Maintains a BagSummary (topics, time range, message count) and
 *     notifies the owner (bagStore) when it changes.
 *   - Tracks the sim clock from the /clock topic so messages without a
 *     logTimeNs header (e.g. from sim bridges that omit it) get a consistent
 *     sim-time timestamp instead of wall-clock time.
 *   - Exposes disconnect() for graceful shutdown.
 *
 * Reconnect strategy: exponential backoff 1s, 2s, 4s, 8s, 16s, 30s (max).
 * Manual disconnect() cancels any pending reconnect.
 */

import { FoxgloveClient, type FoxgloveChannel, type FoxgloveEvent, type FoxgloveService } from './foxgloveClient';
import { LiveRingBuffer } from './liveRingBuffer';
import { LiveRecorder } from './liveRecorder';
import { decodeLiveMessage } from './liveDecoder';
import { useLiveStore, type LiveStatus } from '../store/liveStore';
import { useControlStore } from '../store/controlStore';
import { CAP_CLIENT_PUBLISH, CAP_SERVICES } from './clientProtocol';
import { pickGoalCodec, pickPublishCodec, type Goal2D, type GoalCodec, type TwistKind } from './controlCodec';
import { TeleopController } from './teleop';
import { decodeResponse, encodeRequest } from './serviceCodec';
import type { BagSummary, TopicInfo } from '../types/bag';

export type SummaryCallback = (summary: BagSummary) => void;

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export class LiveConnection {
  readonly bagId: string;
  readonly ringBuffer = new LiveRingBuffer();

  private readonly wsUrl: string;
  private readonly onSummaryUpdate: SummaryCallback;

  private client: FoxgloveClient | null = null;
  private channels = new Map<number, FoxgloveChannel>();
  // Channel ids already subscribed on the CURRENT connection. Cleared on open
  // and close so both subscription paths (open resubscribe and advertise) can
  // consult it without ever sending a duplicate subscribe on one connection.
  private subscribedChannelIds = new Set<number>();

  private destroyed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private summaryDirty = false;
  private summaryTimer: ReturnType<typeof setInterval> | null = null;
  private cachedSummary: BagSummary;

  private pendingRevBump = false;
  private revBumpHandle: ReturnType<typeof requestAnimationFrame> | null = null;
  private recorder: LiveRecorder | null = null;

  // Sim clock: channel ID of the /clock topic (null when not advertised), and
  // the latest decoded sim time in nanoseconds. Used as the timestamp fallback
  // for messages that arrive with logTimeNs === 0n (no header stamp), which
  // happens on some Foxglove bridges in simulation mode.
  private clockChannelId: number | null = null;
  private simClockNs: bigint | null = null;

  // What the server offered in serverInfo; empty until it connects.
  private capabilities: readonly string[] = [];
  private supportedEncodings: readonly string[] | undefined;

  // Services the server offers, and calls waiting for an answer.
  private services = new Map<number, FoxgloveService>();
  private pendingCalls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>; service: FoxgloveService }>();
  private nextCallId = 1;

  /** Driving the robot: disarmed on creation, on every connect, and on every drop. */
  readonly teleop: TeleopController;
  private static readonly TELEOP_CHANNEL_ID = 1;
  private static readonly GOAL_CHANNEL_ID = 2;
  /** The goal topic currently advertised on this connection, with its codec. */
  private goalChannel: { topic: string; codec: GoalCodec } | null = null;

  constructor(bagId: string, wsUrl: string, onSummaryUpdate: SummaryCallback) {
    this.bagId = bagId;
    this.wsUrl = wsUrl;
    this.onSummaryUpdate = onSummaryUpdate;
    this.cachedSummary = buildSummary(wsUrl, [], 0n, 0n, 0);
    this.teleop = new TeleopController(
      {
        advertise: (topic, codec) =>
          this.client?.advertiseClientChannel({
            id: LiveConnection.TELEOP_CHANNEL_ID,
            topic,
            encoding: codec.encoding,
            schemaName: codec.schemaName,
            ...(codec.schema ? { schema: codec.schema, schemaEncoding: codec.schemaEncoding } : {}),
          }) ?? false,
        unadvertise: () => {
          this.client?.unadvertiseClientChannel(LiveConnection.TELEOP_CHANNEL_ID);
        },
        send: (payload) => this.client?.publish(LiveConnection.TELEOP_CHANNEL_ID, payload) ?? false,
        setInterval: (fn, ms) => setInterval(fn, ms),
        clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
      },
      () => this.mirrorControl(),
    );
    this.connect();
    // Flush summary stats to bagStore at 1 Hz so toolbar numbers stay fresh
    // without a re-render per message.
    this.summaryTimer = setInterval(() => this.flushSummary(), 1000);
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────

  private connect(): void {
    if (this.destroyed) return;
    this.setStatus('connecting');
    this.client = new FoxgloveClient(this.wsUrl, (e) => this.handleEvent(e));
  }

  private scheduleReconnect(): void {
    const delay = BACKOFF_MS[Math.min(this.reconnectAttempt, BACKOFF_MS.length - 1)];
    this.reconnectAttempt++;
    const delaySec = Math.round(delay / 1000);
    this.setStatus(
      'reconnecting',
      `Retrying in ${delaySec}s (attempt ${this.reconnectAttempt})`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // ── Event handling ────────────────────────────────────────────────────────

  private handleEvent(event: FoxgloveEvent): void {
    if (this.destroyed) return;

    switch (event.type) {
      case 'open':
        // A new connection is never armed, whatever the last one was doing.
        this.teleop.connectionLost();
        this.capabilities = event.capabilities;
        this.supportedEncodings = event.supportedEncodings;
        this.mirrorControl();
        this.reconnectAttempt = 0;
        this.setStatus('connected', event.serverName);
        // Fresh connection: nothing has been subscribed on it yet, then
        // re-subscribe to all channels known from before the reconnect.
        this.subscribedChannelIds.clear();
        if (this.channels.size > 0) {
          this.subscribeToChannels(Array.from(this.channels.values()));
        }
        break;

      case 'advertise':
        for (const ch of event.channels) {
          this.channels.set(ch.id, ch);
          if (ch.topic === '/clock') this.clockChannelId = ch.id;
        }
        this.subscribeToChannels(event.channels);
        this.pushSummaryTopics();
        break;

      case 'unadvertise':
        for (const id of event.channelIds) {
          if (id === this.clockChannelId) {
            this.clockChannelId = null;
            this.simClockNs = null;
            useLiveStore.getState().setSimTime(this.bagId, false);
          }
          this.channels.delete(id);
          // So a channel that is re-advertised later gets subscribed again.
          this.subscribedChannelIds.delete(id);
        }
        this.pushSummaryTopics();
        break;

      case 'message': {
        // Messages whose channel id is unknown (or missing) are dropped
        // rather than folded into channel 0, which would mis-attribute data
        // to whichever topic happens to own channel 0.
        const ch = this.channels.get(event.channelId);
        if (!ch) break;

        const value = decodeLiveMessage(ch.encoding, ch.schemaEncoding, ch.schema, event.data);
        if (value === null) break;

        // Track sim time from /clock so messages with no logTimeNs header
        // get a consistent sim timestamp rather than jumping to wall time.
        if (event.channelId === this.clockChannelId) {
          const ns = extractClockNs(value);
          if (ns !== null) {
            const wasSimTime = this.simClockNs !== null;
            this.simClockNs = ns;
            if (!wasSimTime) useLiveStore.getState().setSimTime(this.bagId, true);
          }
        }

        const timeNs =
          event.logTimeNs > 0n
            ? event.logTimeNs
            : (this.simClockNs ?? BigInt(Date.now()) * 1_000_000n);

        this.ringBuffer.push(ch.topic, timeNs, value);
        this.recorder?.addMessage(ch, timeNs, event.data);
        this.summaryDirty = true;
        this.scheduleBump(timeNs);
        break;
      }

      case 'services':
        for (const svc of event.services) this.services.set(svc.id, svc);
        this.mirrorControl();
        break;

      case 'unadvertiseServices':
        for (const id of event.serviceIds) this.services.delete(id);
        this.mirrorControl();
        break;

      case 'serviceResponse': {
        const call = this.pendingCalls.get(event.callId);
        if (!call) break;
        this.settle(event.callId);
        try {
          call.resolve(decodeResponse(call.service, event.encoding, event.payload));
        } catch (e) {
          call.reject(e instanceof Error ? e : new Error(String(e)));
        }
        break;
      }

      case 'serviceFailure': {
        const call = this.pendingCalls.get(event.callId);
        if (!call) break;
        this.settle(event.callId);
        call.reject(new Error(event.message || 'The service call failed.'));
        break;
      }

      case 'close':
        this.services.clear();
        this.failPendingCalls('The connection was lost before the service answered.');
        this.teleop.connectionLost();
        this.mirrorControl();
        this.client = null;
        this.subscribedChannelIds.clear();
        if (!this.destroyed) {
          // scheduleReconnect sets its own 'reconnecting' status with the
          // attempt count + delay, so the UI can show more than a dot.
          this.scheduleReconnect();
        } else {
          this.setStatus('disconnected');
        }
        break;

      case 'error':
        this.setStatus('error', event.message);
        break;

      case 'time':
        // Server clock ticks - not needed beyond the per-message logTimeNs.
        break;
    }
  }

  // ── Subscription helpers ─────────────────────────────────────────────────

  /**
   * Subscribe to any of `channels` that have not already been subscribed on
   * the current connection. Both the `open` resubscribe path and the
   * `advertise` path go through here, so a channel that is both known at open
   * and re-advertised afterwards is subscribed exactly once per connection,
   * while channels advertised later (genuinely new ones) still get subscribed.
   */
  private subscribeToChannels(channels: FoxgloveChannel[]): void {
    if (!this.client) return;
    const pending = channels.filter((c) => !this.subscribedChannelIds.has(c.id));
    if (pending.length === 0) return;
    // subscribe() returns one subscription id per channel, or [] when the
    // socket is not open. Only mark as subscribed when the client accepted
    // the full request.
    const ids = this.client.subscribe(pending.map((c) => c.id));
    if (ids.length === pending.length) {
      for (const c of pending) this.subscribedChannelIds.add(c.id);
    }
  }

  // ── Summary maintenance ──────────────────────────────────────────────────

  private pushSummaryTopics(): void {
    const topics = this.buildTopicList();
    this.cachedSummary = { ...this.cachedSummary, topics };
    this.onSummaryUpdate(this.cachedSummary);
  }

  private flushSummary(): void {
    if (!this.summaryDirty) return;
    this.summaryDirty = false;
    const range = this.ringBuffer.getTimeRange();
    const startTime = range?.startNs ?? this.cachedSummary.startTime;
    const endTime = range?.endNs ?? this.cachedSummary.endTime;
    const duration = startTime === 0n ? 0 : Number(endTime - startTime) / 1e9;
    this.cachedSummary = buildSummary(
      this.wsUrl,
      this.buildTopicList(),
      startTime,
      endTime,
      this.ringBuffer.totalPushed,
      duration,
    );
    this.onSummaryUpdate(this.cachedSummary);
    if (this.recorder) {
      useLiveStore.getState().setRecording(this.bagId, {
        messageCount: this.recorder.messageCount,
        byteCount: this.recorder.byteCount,
        isFull: this.recorder.isFull,
        topicFilter: this.recorder.topicFilter,
      });
    }
  }

  private buildTopicList(): TopicInfo[] {
    return Array.from(this.channels.values()).map((ch) => ({
      name: ch.topic,
      type: ch.schemaName,
      messageCount: this.ringBuffer.getTopicMessageCount(ch.topic),
      serializationFormat: ch.encoding,
      frequency: undefined,
    }));
  }

  // ── Revision bump (rAF-throttled) ─────────────────────────────────────────

  private scheduleBump(timeNs: bigint): void {
    if (this.pendingRevBump) return;
    this.pendingRevBump = true;

    const doIt = () => {
      this.pendingRevBump = false;
      this.revBumpHandle = null;
      // Guard the non-cancellable microtask path (and any rAF that raced the
      // cancel): a bump after disconnect()/removeEntry() would re-materialize
      // store entries that were just deleted.
      if (this.destroyed) return;
      const range = this.ringBuffer.getTimeRange();
      useLiveStore.getState().bumpRevision(this.bagId, range?.endNs ?? timeNs);
    };

    if (typeof requestAnimationFrame !== 'undefined') {
      this.revBumpHandle = requestAnimationFrame(doIt);
    } else {
      // Node / test environments: fire synchronously after a microtask.
      Promise.resolve().then(doIt);
    }
  }

  /** Cancel any pending revision bump so it cannot fire after teardown. */
  private cancelPendingBump(): void {
    if (this.revBumpHandle !== null) {
      cancelAnimationFrame(this.revBumpHandle);
      this.revBumpHandle = null;
    }
    this.pendingRevBump = false;
  }

  // ── Status helper ─────────────────────────────────────────────────────────

  private setStatus(status: LiveStatus, detail?: string): void {
    useLiveStore.getState().setStatus(this.bagId, status, detail);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get status(): LiveStatus {
    return useLiveStore.getState().statuses.get(this.bagId) ?? 'connecting';
  }

  get summary(): BagSummary {
    return this.cachedSummary;
  }

  get isRecording(): boolean {
    return this.recorder !== null;
  }

  startRecording(topicFilter?: ReadonlySet<string> | null): void {
    if (this.recorder) return;
    this.recorder = new LiveRecorder(topicFilter);
    useLiveStore.getState().setRecording(this.bagId, {
      messageCount: 0,
      byteCount: 0,
      isFull: false,
      topicFilter: topicFilter ?? null,
    });
  }

  async stopRecording(): Promise<Uint8Array> {
    const r = this.recorder;
    this.recorder = null;
    useLiveStore.getState().setRecording(this.bagId, null);
    if (!r) throw new Error('Not recording');
    return r.finish();
  }

  // ── Control (publishing) ────────────────────────────────────────────────

  /** Whether the server allows clients to publish. */
  get canPublish(): boolean {
    return this.capabilities.includes(CAP_CLIENT_PUBLISH);
  }

  /**
   * Arm control on `topic`. Returns an error message when it cannot be done,
   * and stays disarmed in that case.
   */
  enableControl(topic: string, kind: TwistKind): string | null {
    if (!this.client || this.status !== 'connected') return 'Not connected.';
    if (!this.canPublish) return 'This server does not allow clients to publish (no clientPublish capability).';
    if (!/^\/[A-Za-z0-9_/~]+$/.test(topic)) return 'Enter a topic name such as /cmd_vel.';
    const ros2Names = Array.from(this.channels.values()).some((c) => c.schemaName.includes('/msg/')) || this.channels.size === 0;
    const codec = pickPublishCodec({ supportedEncodings: this.supportedEncodings, kind, ros2Names });
    if (!codec) return 'The server accepts none of the encodings BAGEL can write (cdr, ros1, json).';
    if (!this.teleop.enable(topic, codec)) return 'The connection is not open.';
    return null;
  }

  /**
   * Send a navigation goal (a `PoseStamped`) to `topic` in `frameId`. Counts as a
   * command, so it needs control enabled; returns an error message or null.
   */
  publishGoal(topic: string, goal: Goal2D, frameId: string): string | null {
    if (!this.teleop.enabled) return 'Enable control first: a goal makes the robot move.';
    if (!this.client || this.status !== 'connected') return 'Not connected.';
    if (!frameId) return 'Pick a fixed frame for the 3D view first (Display > Coordinate frame); a goal needs one.';
    if (!/^\/[A-Za-z0-9_/~]+$/.test(topic)) return 'Enter a topic name such as /goal_pose.';
    if (![goal.x, goal.y, goal.yaw].every(Number.isFinite)) return 'The goal is not a valid pose.';
    if (!this.goalChannel || this.goalChannel.topic !== topic) {
      const ros2Names = Array.from(this.channels.values()).some((c) => c.schemaName.includes('/msg/')) || this.channels.size === 0;
      const codec = pickGoalCodec({ supportedEncodings: this.supportedEncodings, ros2Names });
      if (!codec) return 'The server accepts none of the encodings BAGEL can write (cdr, ros1, json).';
      if (this.goalChannel) this.client.unadvertiseClientChannel(LiveConnection.GOAL_CHANNEL_ID);
      const ok = this.client.advertiseClientChannel({
        id: LiveConnection.GOAL_CHANNEL_ID,
        topic,
        encoding: codec.encoding,
        schemaName: codec.schemaName,
        ...(codec.schema ? { schema: codec.schema, schemaEncoding: codec.schemaEncoding } : {}),
      });
      if (!ok) return 'The connection is not open.';
      this.goalChannel = { topic, codec };
    }
    return this.client.publish(LiveConnection.GOAL_CHANNEL_ID, this.goalChannel.codec.encode(goal, frameId)) ? null : 'The goal could not be sent.';
  }

  /** Withdraw the goal channel (on disarm and on a drop) so nothing can publish to it unarmed. */
  private dropGoalChannel(): void {
    if (!this.goalChannel) return;
    this.client?.unadvertiseClientChannel(LiveConnection.GOAL_CHANNEL_ID);
    this.goalChannel = null;
  }

  private mirrorControl(): void {
    if (this.destroyed) return;
    if (!this.teleop.enabled) this.dropGoalChannel();
    useControlStore.getState().set(this.bagId, {
      enabled: this.teleop.enabled,
      sendFailed: this.teleop.sendFailed,
      services: this.canCallServices ? Array.from(this.services.values()).sort((a, b) => a.name.localeCompare(b.name)) : [],
    });
  }

  get canCallServices(): boolean {
    return this.capabilities.includes(CAP_SERVICES);
  }

  /**
   * Call a service and wait for its answer. Counts as sending a command, so it
   * is refused unless control has been enabled, exactly like driving.
   */
  callService(serviceId: number, request: unknown, timeoutMs = 10_000): Promise<unknown> {
    if (!this.teleop.enabled) return Promise.reject(new Error('Enable control first: service calls can change what the robot does.'));
    const service = this.services.get(serviceId);
    if (!service) return Promise.reject(new Error('That service is no longer advertised.'));
    return new Promise((resolve, reject) => {
      let encoded;
      try {
        encoded = encodeRequest(service, request);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const callId = this.nextCallId++;
      if (!this.client?.callService(serviceId, callId, encoded.encoding, encoded.payload)) {
        reject(new Error('The connection is not open.'));
        return;
      }
      const timer = setTimeout(() => {
        this.pendingCalls.delete(callId);
        reject(new Error(`No answer from ${service.name} after ${Math.round(timeoutMs / 1000)} s. The call may still have run.`));
      }, timeoutMs);
      this.pendingCalls.set(callId, { resolve, reject, timer, service });
    });
  }

  private settle(callId: number): void {
    const call = this.pendingCalls.get(callId);
    if (call) clearTimeout(call.timer);
    this.pendingCalls.delete(callId);
  }

  private failPendingCalls(message: string): void {
    for (const [id, call] of [...this.pendingCalls]) {
      this.settle(id);
      call.reject(new Error(message));
    }
  }

  get isSimTime(): boolean {
    return this.simClockNs !== null;
  }

  disconnect(): void {
    // Stop the robot first if it is being driven, while the socket can still carry it.
    this.teleop.disable();
    this.teleop.connectionLost();
    this.failPendingCalls('Disconnected.');
    useControlStore.getState().clear(this.bagId);
    this.destroyed = true;
    this.recorder = null;
    this.simClockNs = null;
    this.clockChannelId = null;
    // A pending rAF bump would otherwise fire after removeEntry and
    // re-materialize the bag's revision/status entries.
    this.cancelPendingBump();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.summaryTimer !== null) {
      clearInterval(this.summaryTimer);
      this.summaryTimer = null;
    }
    this.client?.dispose();
    this.client = null;
    // Remove first, then record the final status. setStatus before
    // removeEntry would be wiped immediately by removeEntry's cleanup,
    // leaving the getter to fall back to 'connecting' for a dead socket.
    useLiveStore.getState().removeEntry(this.bagId);
    this.setStatus('disconnected');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract a nanosecond timestamp from a decoded rosgraph_msgs/Clock message.
 * Works for both ROS1 (nsec field) and ROS2 (nanosec field).
 *
 * Exported for unit testing only - not part of the public API.
 * Returns null if the message doesn't look like a Clock message.
 */
export function extractClockNs(msg: Record<string, unknown>): bigint | null {
  const clock = msg.clock as Record<string, unknown> | undefined;
  if (!clock || typeof clock.sec !== 'number') return null;
  const subsec = (clock.nanosec ?? clock.nsec ?? 0) as number;
  return BigInt(Math.trunc(clock.sec)) * 1_000_000_000n + BigInt(Math.trunc(subsec));
}

// ── Factory helper ────────────────────────────────────────────────────────────

function buildSummary(
  wsUrl: string,
  topics: TopicInfo[],
  startTime: bigint,
  endTime: bigint,
  totalMessageCount: number,
  duration?: number,
): BagSummary {
  return {
    format: 'live',
    fileName: wsUrl,
    fileSize: 0,
    startTime,
    endTime,
    duration: duration ?? 0,
    totalMessageCount,
    topics,
  };
}
