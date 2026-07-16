/**
 * LiveConnection - orchestrates a single Foxglove WebSocket connection.
 *
 * Responsibilities:
 *   - Creates and owns a FoxgloveClient, reconnects on drop.
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

import { FoxgloveClient, type FoxgloveChannel, type FoxgloveEvent } from './foxgloveClient';
import { LiveRingBuffer } from './liveRingBuffer';
import { LiveRecorder } from './liveRecorder';
import { decodeLiveMessage } from './liveDecoder';
import { useLiveStore, type LiveStatus } from '../store/liveStore';
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
  private subIdToChannelId = new Map<number, number>();

  private destroyed = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private summaryDirty = false;
  private summaryTimer: ReturnType<typeof setInterval> | null = null;
  private cachedSummary: BagSummary;

  private pendingRevBump = false;
  private recorder: LiveRecorder | null = null;

  // Sim clock: channel ID of the /clock topic (null when not advertised), and
  // the latest decoded sim time in nanoseconds. Used as the timestamp fallback
  // for messages that arrive with logTimeNs === 0n (no header stamp), which
  // happens on some Foxglove bridges in simulation mode.
  private clockChannelId: number | null = null;
  private simClockNs: bigint | null = null;

  constructor(bagId: string, wsUrl: string, onSummaryUpdate: SummaryCallback) {
    this.bagId = bagId;
    this.wsUrl = wsUrl;
    this.onSummaryUpdate = onSummaryUpdate;
    this.cachedSummary = buildSummary(wsUrl, [], 0n, 0n, 0);
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
        this.reconnectAttempt = 0;
        this.setStatus('connected', event.serverName);
        // Re-subscribe to all known channels on reconnect.
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
        }
        this.pushSummaryTopics();
        break;

      case 'message': {
        const channelId = event.channelId || this.subIdToChannelId.get(event.subscriptionId) || 0;
        const ch = this.channels.get(channelId);
        if (!ch) break;

        const value = decodeLiveMessage(ch.encoding, ch.schemaEncoding, ch.schema, event.data);
        if (value === null) break;

        // Track sim time from /clock so messages with no logTimeNs header
        // get a consistent sim timestamp rather than jumping to wall time.
        if (channelId === this.clockChannelId) {
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

      case 'close':
        this.client = null;
        this.subIdToChannelId.clear();
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

  private subscribeToChannels(channels: FoxgloveChannel[]): void {
    if (!this.client || channels.length === 0) return;
    const ids = this.client.subscribe(channels.map((c) => c.id));
    for (let i = 0; i < ids.length; i++) {
      this.subIdToChannelId.set(ids[i], channels[i].id);
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
      const range = this.ringBuffer.getTimeRange();
      useLiveStore.getState().bumpRevision(this.bagId, range?.endNs ?? timeNs);
    };

    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(doIt);
    } else {
      // Node / test environments: fire synchronously after a microtask.
      Promise.resolve().then(doIt);
    }
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

  get isSimTime(): boolean {
    return this.simClockNs !== null;
  }

  disconnect(): void {
    this.destroyed = true;
    this.recorder = null;
    this.simClockNs = null;
    this.clockChannelId = null;
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
    this.setStatus('disconnected');
    useLiveStore.getState().removeEntry(this.bagId);
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
