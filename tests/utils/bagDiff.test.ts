import { describe, expect, it } from 'vitest';
import { diffBags, diffToMarkdown, normalizeType, topicHz } from '../../src/utils/bagDiff';
import type { BagSummary, TopicInfo } from '../../src/types/bag';

const topic = (name: string, type: string, messageCount: number, frequency?: number): TopicInfo => ({
  name, type, messageCount, serializationFormat: 'cdr', ...(frequency !== undefined ? { frequency } : {}),
});

function bag(topics: TopicInfo[], duration = 10): BagSummary {
  return {
    format: 'mcap', fileName: 'x.mcap', fileSize: 1, startTime: 0n, endTime: BigInt(duration) * 1_000_000_000n,
    duration, totalMessageCount: topics.reduce((n, t) => n + t.messageCount, 0), topics,
  };
}

const kinds = (d: ReturnType<typeof diffBags>) => d.rows.map((r) => `${r.kind}:${r.topic}`);

describe('normalizeType', () => {
  it('maps ROS 2 and ROS 1 spellings of one type together', () => {
    expect(normalizeType('sensor_msgs/msg/Image')).toBe('sensor_msgs/Image');
    expect(normalizeType('sensor_msgs/Image')).toBe('sensor_msgs/Image');
    expect(normalizeType('foxglove.CompressedImage')).toBe('foxglove.CompressedImage');
  });
});

describe('diffBags', () => {
  it('is empty of differences for identical bags', () => {
    const t = [topic('/a', 'std_msgs/String', 100, 10), topic('/b', 'std_msgs/Int32', 50, 5)];
    const d = diffBags(bag(t), bag(t));
    expect(d.counts).toEqual({ 'only-a': 0, 'only-b': 0, type: 0, rate: 0, same: 2 });
  });

  it('finds topics present in only one bag', () => {
    const d = diffBags(
      bag([topic('/shared', 'std_msgs/String', 100), topic('/lost', 'std_msgs/String', 100)]),
      bag([topic('/shared', 'std_msgs/String', 100), topic('/new', 'std_msgs/String', 100)]),
    );
    expect(kinds(d)).toEqual(['only-a:/lost', 'only-b:/new', 'same:/shared']);
  });

  it('does not report a ROS 1 vs ROS 2 spelling as a type mismatch', () => {
    const d = diffBags(
      bag([topic('/img', 'sensor_msgs/Image', 100, 10)]),
      bag([topic('/img', 'sensor_msgs/msg/Image', 100, 10)]),
    );
    expect(d.counts.type).toBe(0);
    expect(d.counts.same).toBe(1);
  });

  it('reports a real type change', () => {
    const d = diffBags(
      bag([topic('/x', 'geometry_msgs/Twist', 100)]),
      bag([topic('/x', 'geometry_msgs/msg/TwistStamped', 100)]),
    );
    expect(kinds(d)).toEqual(['type:/x']);
    expect(d.rows[0]!.detail).toContain('TwistStamped');
  });

  it('flags a rate difference beyond tolerance and says which way', () => {
    const d = diffBags(bag([topic('/scan', 'sensor_msgs/LaserScan', 100, 10)]), bag([topic('/scan', 'sensor_msgs/LaserScan', 50, 5)]));
    expect(d.rows[0]).toMatchObject({ kind: 'rate' });
    expect(d.rows[0]!.detail).toBe('10.0 Hz vs 5.0 Hz (50% lower in B)');
    const up = diffBags(bag([topic('/s', 't', 50, 5)]), bag([topic('/s', 't', 100, 10)]));
    expect(up.rows[0]!.detail).toContain('higher in B');
  });

  it('ignores a rate difference inside the tolerance and respects a custom one', () => {
    const a = bag([topic('/s', 't', 100, 10)]);
    const b = bag([topic('/s', 't', 95, 9.5)]);
    expect(diffBags(a, b).counts.rate).toBe(0);
    expect(diffBags(a, b, { rateTolerance: 0.01 }).counts.rate).toBe(1);
  });

  it('derives the rate from count and duration when no frequency is recorded', () => {
    const d = diffBags(bag([topic('/s', 't', 100)], 10), bag([topic('/s', 't', 100)], 20));
    expect(d.counts.rate).toBe(1); // 10 Hz vs 5 Hz
  });

  it('surfaces a topic that all but stopped publishing', () => {
    const d = diffBags(bag([topic('/gps', 't', 100, 10)]), bag([topic('/gps', 't', 1)]));
    expect(d.rows[0]).toMatchObject({ kind: 'rate' });
    expect(d.rows[0]!.detail).toBe('100 vs 1 messages');
  });

  it('does not invent a rate difference for two single-message topics', () => {
    const d = diffBags(bag([topic('/once', 't', 1)]), bag([topic('/once', 't', 1)]));
    expect(d.counts.same).toBe(1);
  });

  it('orders only-A, only-B, type, rate, same, then by name', () => {
    const d = diffBags(
      bag([topic('/z_same', 't', 10, 1), topic('/a_rate', 't', 100, 10), topic('/m_type', 'a/A', 5, 1), topic('/only_a', 't', 5, 1)]),
      bag([topic('/z_same', 't', 10, 1), topic('/a_rate', 't', 50, 5), topic('/m_type', 'a/B', 5, 1), topic('/only_b', 't', 5, 1)]),
    );
    expect(kinds(d)).toEqual(['only-a:/only_a', 'only-b:/only_b', 'type:/m_type', 'rate:/a_rate', 'same:/z_same']);
  });

  it('handles empty bags and large topic lists', () => {
    expect(diffBags(bag([]), bag([])).rows).toEqual([]);
    const big = Array.from({ length: 2000 }, (_, i) => topic(`/t${i}`, 'std_msgs/String', 10, 1));
    const d = diffBags(bag(big), bag(big.slice(0, 1500)));
    expect(d.counts['only-a']).toBe(500);
    expect(d.counts.same).toBe(1500);
  });
});

describe('topicHz', () => {
  it('prefers the recorded frequency, falls back to count over duration, and refuses under two messages', () => {
    expect(topicHz(topic('/a', 't', 100, 7), 10)).toBe(7);
    expect(topicHz(topic('/a', 't', 100), 10)).toBe(10);
    expect(topicHz(topic('/a', 't', 1, 99), 10)).toBeNull();
    expect(topicHz(topic('/a', 't', 100), 0)).toBeNull();
    expect(topicHz(topic('/a', 't', 100, NaN), 10)).toBe(10);
  });
});

describe('diffToMarkdown', () => {
  it('lists differences by section and summarises matches', () => {
    const d = diffBags(
      bag([topic('/lost', 't', 5, 1), topic('/s', 't', 100, 10), topic('/ok', 't', 5, 1)]),
      bag([topic('/s', 't', 50, 5), topic('/ok', 't', 5, 1)]),
    );
    const md = diffToMarkdown(d, 'good.mcap', 'bad.mcap');
    expect(md).toContain('# good.mcap vs bad.mcap');
    expect(md).toContain('## Only in A (1)');
    expect(md).toContain('- `/lost`');
    expect(md).toContain('## Rate differs (1)');
    expect(md).toContain('1 other topics match.');
    expect(md).not.toContain('/ok');
  });
  it('says so when nothing differs', () => {
    const t = [topic('/a', 't', 10, 1)];
    expect(diffToMarkdown(diffBags(bag(t), bag(t)), 'a', 'b')).toContain('No differences across 1 shared topics.');
  });
});
