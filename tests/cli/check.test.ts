import { describe, expect, it } from 'vitest';
import { UsageError, evaluate, parseExpectations, topicRows } from '../../cli/check';
import type { BagSummary } from '../../src/types/bag';

// /scan: 11 messages 0.1 s apart then a 1 s hole then 2 more. /imu: 3 messages.
const scanTimes = [...Array.from({ length: 11 }, (_, i) => i * 1e8), 2e9, 2.1e9];
const stats = {
  '/scan': { times: Float64Array.from(scanTimes), sizes: new Uint32Array(scanTimes.length).fill(10) },
  '/imu': { times: Float64Array.from([0, 1e9, 2e9]), sizes: new Uint32Array(3).fill(10) },
};
const summary: BagSummary = {
  format: 'mcap',
  fileName: 'x.mcap',
  fileSize: 1,
  startTime: 0n,
  endTime: 2_100_000_000n,
  duration: 2.1,
  totalMessageCount: 16,
  topics: [
    { name: '/scan', type: 'sensor_msgs/msg/LaserScan', messageCount: 13, serializationFormat: 'cdr' },
    { name: '/imu', type: 'sensor_msgs/Imu', messageCount: 3, serializationFormat: 'cdr' },
  ],
};
const failures = (json: object) => evaluate(summary, stats, parseExpectations(JSON.stringify(json))).filter((c) => !c.ok);

describe('parseExpectations', () => {
  it('rejects a typo instead of silently checking nothing', () => {
    expect(() => parseExpectations('{"topics":{"/scan":{"min_hz_":5}}}')).toThrow(/unknown key "min_hz_"/);
    expect(() => parseExpectations('{"min_duration":3}')).toThrow(/unknown key/);
  });
  it('rejects wrong types and bad JSON', () => {
    expect(() => parseExpectations('{"topics":{"/scan":{"min_hz":"5"}}}')).toThrow(UsageError);
    expect(() => parseExpectations('{"topics":{"/scan":{"min_hz":-1}}}')).toThrow(/non-negative/);
    expect(() => parseExpectations('{"topics":{"/scan":true}}')).toThrow(/must be an object/);
    expect(() => parseExpectations('{"allow_extra_topics":"no"}')).toThrow(/true or false/);
    expect(() => parseExpectations('[]')).toThrow(/JSON object/);
    expect(() => parseExpectations('not json')).toThrow(/not valid JSON/);
  });
});

describe('evaluate', () => {
  it('passes when every rule holds, and ROS1 vs ROS2 type spellings match', () => {
    expect(failures({ min_duration_s: 2, topics: { '/scan': { min_messages: 13 }, '/imu': { type: 'sensor_msgs/msg/Imu' } } })).toEqual([]);
  });
  it('flags a missing topic unless optional', () => {
    expect(failures({ topics: { '/camera': {} } })).toHaveLength(1);
    expect(failures({ topics: { '/camera': { optional: true, min_hz: 5 } } })).toEqual([]);
  });
  it('catches a rate below the minimum and above the maximum', () => {
    expect(failures({ topics: { '/imu': { min_hz: 5 } } })[0]!.message).toMatch(/Hz, need at least 5/);
    expect(failures({ topics: { '/imu': { max_hz: 0.5 } } })).toHaveLength(1);
  });
  it('finds the 1 s hole with max_gap_s even though the mean rate looks fine', () => {
    expect(failures({ topics: { '/scan': { min_hz: 5, max_gap_s: 0.5 } } }).map((c) => c.message)).toEqual([
      expect.stringContaining('longest gap 1 s'),
    ]);
  });
  it('checks duration bounds and the exact-type rule', () => {
    expect(failures({ max_duration_s: 2 })).toHaveLength(1);
    expect(failures({ min_duration_s: 5 })).toHaveLength(1);
    expect(failures({ topics: { '/scan': { type: 'sensor_msgs/msg/PointCloud2' } } })).toHaveLength(1);
  });
  it('allow_extra_topics:false reports unlisted topics', () => {
    expect(failures({ allow_extra_topics: false, topics: { '/scan': {} } }).map((c) => c.subject)).toEqual(['/imu']);
  });
  it('rows report rate and longest gap per topic', () => {
    const scan = topicRows(summary, stats).find((r) => r.topic === '/scan')!;
    expect(scan.maxGapS).toBeCloseTo(1, 6);
    expect(scan.count).toBe(13);
  });
});
