import { describe, it, expect, beforeEach } from 'vitest';
import { LiveRingBuffer, CAPACITY_PER_TOPIC } from '../../src/live/liveRingBuffer';

function makeBuffer() {
  return new LiveRingBuffer();
}

const T = 'topic/a';

describe('LiveRingBuffer', () => {
  let buf: LiveRingBuffer;
  beforeEach(() => { buf = makeBuffer(); });

  it('starts empty', () => {
    expect(buf.totalPushed).toBe(0);
    expect(buf.getTopics()).toHaveLength(0);
    expect(buf.getTimeRange()).toBeNull();
  });

  it('push increments totalPushed', () => {
    buf.push(T, 100n, {});
    buf.push(T, 200n, {});
    expect(buf.totalPushed).toBe(2);
  });

  it('getMessages returns pushed messages in order', () => {
    buf.push(T, 10n, { x: 1 });
    buf.push(T, 20n, { x: 2 });
    buf.push(T, 30n, { x: 3 });
    const msgs = buf.getMessages(T);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].timeNs).toBe(10n);
    expect(msgs[2].value).toEqual({ x: 3 });
  });

  it('getMessages returns empty array for unknown topic', () => {
    expect(buf.getMessages('unknown')).toHaveLength(0);
  });

  it('evicts oldest message when capacity is exceeded', () => {
    for (let i = 0; i < CAPACITY_PER_TOPIC + 1; i++) {
      buf.push(T, BigInt(i), { i });
    }
    const msgs = buf.getMessages(T);
    expect(msgs).toHaveLength(CAPACITY_PER_TOPIC);
    // Oldest (i=0) should be gone
    expect(msgs[0].timeNs).toBe(1n);
    // totalPushed still reflects all pushes
    expect(buf.totalPushed).toBe(CAPACITY_PER_TOPIC + 1);
  });

  it('getTopicMessageCount reflects buffer size', () => {
    buf.push(T, 1n, {});
    buf.push(T, 2n, {});
    expect(buf.getTopicMessageCount(T)).toBe(2);
    expect(buf.getTopicMessageCount('other')).toBe(0);
  });

  it('getTimeRange returns null when empty', () => {
    expect(buf.getTimeRange()).toBeNull();
  });

  it('getTimeRange returns correct range', () => {
    buf.push(T, 100n, {});
    buf.push(T, 200n, {});
    buf.push(T, 150n, {}); // out of order; endNs tracks the max seen
    const range = buf.getTimeRange();
    expect(range).not.toBeNull();
    expect(range!.startNs).toBe(100n);
    expect(range!.endNs).toBe(200n);
  });

  it('getTimeRange startNs reflects evictions', () => {
    // Fill past capacity so first message is evicted
    for (let i = 0; i <= CAPACITY_PER_TOPIC; i++) {
      buf.push(T, BigInt(i * 10), {});
    }
    const range = buf.getTimeRange();
    expect(range!.startNs).toBe(10n); // index 0 (t=0) was evicted
  });

  describe('getMessageAtTime', () => {
    it('returns null when no messages', () => {
      expect(buf.getMessageAtTime(T, 100n)).toBeNull();
    });

    it('returns single message regardless of timeNs', () => {
      buf.push(T, 500n, { v: 1 });
      expect(buf.getMessageAtTime(T, 0n)?.value).toEqual({ v: 1 });
      expect(buf.getMessageAtTime(T, 999n)?.value).toEqual({ v: 1 });
    });

    it('returns exact match', () => {
      buf.push(T, 100n, { v: 1 });
      buf.push(T, 200n, { v: 2 });
      buf.push(T, 300n, { v: 3 });
      expect(buf.getMessageAtTime(T, 200n)?.value).toEqual({ v: 2 });
    });

    it('returns nearest before when closer', () => {
      buf.push(T, 100n, { v: 1 });
      buf.push(T, 200n, { v: 2 });
      // 149n is closer to 100n than 200n? No: |149-100|=49, |200-149|=51 - closer to 100
      expect(buf.getMessageAtTime(T, 149n)?.value).toEqual({ v: 1 });
    });

    it('returns nearest after when closer', () => {
      buf.push(T, 100n, { v: 1 });
      buf.push(T, 200n, { v: 2 });
      // 151n: |151-100|=51, |200-151|=49 - closer to 200
      expect(buf.getMessageAtTime(T, 151n)?.value).toEqual({ v: 2 });
    });

    it('on equidistant tie, returns the later message (before < after is strict)', () => {
      buf.push(T, 100n, { v: 1 });
      buf.push(T, 200n, { v: 2 });
      // 150n is equidistant; the guard is `before < after` (strict), so lo stays at the later msg
      expect(buf.getMessageAtTime(T, 150n)?.value).toEqual({ v: 2 });
    });

    it('returns last message when query is beyond all messages', () => {
      buf.push(T, 100n, { v: 1 });
      buf.push(T, 200n, { v: 2 });
      expect(buf.getMessageAtTime(T, 9999n)?.value).toEqual({ v: 2 });
    });
  });

  it('clear resets state', () => {
    buf.push(T, 100n, {});
    buf.push(T, 200n, {});
    buf.clear();
    expect(buf.totalPushed).toBe(0);
    expect(buf.getTimeRange()).toBeNull();
    expect(buf.getMessages(T)).toHaveLength(0);
  });

  it('getTopics lists all topics with messages', () => {
    buf.push('a', 1n, {});
    buf.push('b', 2n, {});
    buf.push('c', 3n, {});
    expect(buf.getTopics().sort()).toEqual(['a', 'b', 'c']);
  });
});
