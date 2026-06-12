/**
 * Per-topic ring buffer for live message streams.
 *
 * Messages are stored sorted by timeNs (ascending) per topic, with a fixed
 * capacity. When capacity is hit the oldest messages are evicted from the
 * front. Binary search makes getMessageAtTime O(log n).
 *
 * The buffer does NOT copy message values - callers must not mutate them
 * after push. This is safe for CDR-decoded objects from the live decoder.
 */

export interface BufferedMessage {
  timeNs: bigint;
  value: Record<string, unknown>;
}

export const CAPACITY_PER_TOPIC = 10_000;

export class LiveRingBuffer {
  private readonly msgs = new Map<string, BufferedMessage[]>();
  private _totalPushed = 0;
  private _endNs: bigint | null = null;

  /**
   * Push a decoded message. If the topic's buffer is at capacity the oldest
   * message is dropped. Messages with duplicate timeNs are allowed (the
   * latest pushed wins for getMessageAtTime purposes).
   */
  push(topic: string, timeNs: bigint, value: Record<string, unknown>): void {
    let arr = this.msgs.get(topic);
    if (!arr) {
      arr = [];
      this.msgs.set(topic, arr);
    }
    arr.push({ timeNs, value });
    if (arr.length > CAPACITY_PER_TOPIC) {
      arr.shift();
    }
    this._totalPushed++;
    if (this._endNs === null || timeNs > this._endNs) {
      this._endNs = timeNs;
    }
  }

  /** All buffered messages for a topic, sorted by timeNs. Read-only view. */
  getMessages(topic: string): readonly BufferedMessage[] {
    return this.msgs.get(topic) ?? [];
  }

  /**
   * Nearest message to `timeNs` for a topic. Returns null when the topic has
   * no buffered messages. Prefers the message whose timeNs is closest; on a
   * tie (equidistant) the earlier message wins.
   */
  getMessageAtTime(topic: string, timeNs: bigint): BufferedMessage | null {
    const arr = this.msgs.get(topic);
    if (!arr || arr.length === 0) return null;

    // Binary search for the first element >= timeNs.
    let lo = 0;
    let hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].timeNs < timeNs) lo = mid + 1;
      else hi = mid;
    }

    // lo is the first element >= timeNs. Check lo-1 to pick the nearer side.
    if (lo > 0) {
      const before = timeNs - arr[lo - 1].timeNs;
      const after = arr[lo].timeNs - timeNs;
      if (before < after) lo--;
    }
    return arr[lo];
  }

  /**
   * Returns the wall-clock time range covered by messages currently in the
   * buffer. `startNs` is the oldest message across all topics (reflecting
   * any evictions); `endNs` is the latest message seen.
   */
  getTimeRange(): { startNs: bigint; endNs: bigint } | null {
    if (this._endNs === null) return null;
    let startNs = this._endNs;
    for (const arr of this.msgs.values()) {
      if (arr.length > 0 && arr[0].timeNs < startNs) startNs = arr[0].timeNs;
    }
    return { startNs, endNs: this._endNs };
  }

  /** Message count currently buffered for a topic. */
  getTopicMessageCount(topic: string): number {
    return this.msgs.get(topic)?.length ?? 0;
  }

  /** All topic names that have at least one buffered message. */
  getTopics(): string[] {
    return Array.from(this.msgs.keys());
  }

  /** Total messages pushed since construction (monotonically increasing). */
  get totalPushed(): number {
    return this._totalPushed;
  }

  clear(): void {
    this.msgs.clear();
    this._totalPushed = 0;
    this._endNs = null;
  }
}
