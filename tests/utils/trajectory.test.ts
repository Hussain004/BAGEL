import { describe, it, expect } from 'vitest';
import {
  extractTrajectory,
  computeBounds,
  nearestPointIndex,
  isTrajectoryType,
  type TrajectoryPoint,
} from '../../src/utils/trajectory';

type Msg = { timestamp: bigint; value: Record<string, unknown> | null };

const ts = (n: number) => BigInt(n) * 1_000_000_000n;

describe('trajectory/isTrajectoryType', () => {
  it('accepts every supported pose-bearing type', () => {
    const supported = [
      'nav_msgs/Odometry',
      'nav_msgs/msg/Odometry',
      'geometry_msgs/msg/PoseStamped',
      'geometry_msgs/msg/PoseWithCovarianceStamped',
      'geometry_msgs/msg/Pose',
      'geometry_msgs/msg/Point',
      'geometry_msgs/msg/PointStamped',
      'geometry_msgs/msg/TransformStamped',
      'sensor_msgs/msg/NavSatFix',
    ];
    for (const t of supported) {
      expect(isTrajectoryType(t), t).toBe(true);
    }
  });

  it('rejects non-pose types', () => {
    expect(isTrajectoryType('sensor_msgs/Image')).toBe(false);
    expect(isTrajectoryType('std_msgs/Header')).toBe(false);
  });
});

describe('trajectory/extractTrajectory — pose-bearing types', () => {
  it('extracts (x, y) from Odometry messages', () => {
    const messages: Msg[] = [
      { timestamp: ts(0), value: { pose: { pose: { position: { x: 1, y: 2, z: 0 } } } } },
      { timestamp: ts(1), value: { pose: { pose: { position: { x: 3, y: 4, z: 0 } } } } },
    ];
    const result = extractTrajectory(messages, 'nav_msgs/msg/Odometry');
    expect(result.points).toEqual([
      { t: ts(0), x: 1, y: 2, yaw: undefined },
      { t: ts(1), x: 3, y: 4, yaw: undefined },
    ]);
    expect(result.projected).toBe(false);
    expect(result.navSatRef).toBeNull();
  });

  it('extracts yaw from an orientation quaternion when present', () => {
    // Rotation about Z by 90° → quaternion (0, 0, sin(45°), cos(45°))
    const halfPi = Math.PI / 2;
    const sin45 = Math.sin(halfPi / 2);
    const cos45 = Math.cos(halfPi / 2);
    const messages: Msg[] = [
      {
        timestamp: ts(0),
        value: {
          pose: {
            pose: {
              position: { x: 0, y: 0, z: 0 },
              orientation: { x: 0, y: 0, z: sin45, w: cos45 },
            },
          },
        },
      },
    ];
    const result = extractTrajectory(messages, 'nav_msgs/msg/Odometry');
    expect(result.points[0].yaw).toBeCloseTo(halfPi, 6);
  });

  it('handles PoseStamped (no outer pose wrapper)', () => {
    const messages: Msg[] = [
      { timestamp: ts(0), value: { pose: { position: { x: 7, y: 8, z: 0 } } } },
    ];
    const result = extractTrajectory(messages, 'geometry_msgs/msg/PoseStamped');
    expect(result.points[0]).toMatchObject({ x: 7, y: 8 });
  });

  it('handles bare Point (no nested wrapper)', () => {
    const messages: Msg[] = [{ timestamp: ts(0), value: { x: 1.5, y: -2.5, z: 0 } }];
    const result = extractTrajectory(messages, 'geometry_msgs/msg/Point');
    expect(result.points[0]).toMatchObject({ x: 1.5, y: -2.5 });
  });

  it('handles TransformStamped (transform.translation)', () => {
    const messages: Msg[] = [
      {
        timestamp: ts(0),
        value: { transform: { translation: { x: 10, y: 20, z: 0 } } },
      },
    ];
    const result = extractTrajectory(messages, 'geometry_msgs/msg/TransformStamped');
    expect(result.points[0]).toMatchObject({ x: 10, y: 20 });
  });

  it('drops null messages and non-finite positions', () => {
    const messages: Msg[] = [
      { timestamp: ts(0), value: null },
      { timestamp: ts(1), value: { pose: { pose: { position: { x: NaN, y: 0, z: 0 } } } } },
      { timestamp: ts(2), value: { pose: { pose: { position: { x: 1, y: 1, z: 0 } } } } },
    ];
    const result = extractTrajectory(messages, 'nav_msgs/msg/Odometry');
    expect(result.points).toHaveLength(1);
    expect(result.points[0].x).toBe(1);
  });
});

describe('trajectory/extractTrajectory — NavSatFix projection', () => {
  it('anchors at the first valid fix and projects later samples to local metres', () => {
    const messages: Msg[] = [
      { timestamp: ts(0), value: { latitude: 0, longitude: 0 } }, // skipped — "no fix"
      { timestamp: ts(1), value: { latitude: 52.2, longitude: 0.115 } },
      { timestamp: ts(2), value: { latitude: 52.2001, longitude: 0.1151 } },
    ];
    const result = extractTrajectory(messages, 'sensor_msgs/msg/NavSatFix');
    expect(result.projected).toBe(true);
    expect(result.navSatRef).toEqual({ lat: 52.2, lon: 0.115 });
    // First valid sample sits at the anchor → (0, 0).
    expect(result.points[0]).toMatchObject({ x: 0, y: 0 });
    // Second sample is ~10 m north, ~7 m east (latitude 52° puts 1° lon at
    // ~68 km, so 0.0001° ≈ 6.8 m). Loose tolerance.
    expect(result.points[1].x).toBeGreaterThan(0);
    expect(result.points[1].y).toBeGreaterThan(0);
    expect(result.points[1].y).toBeLessThan(50);
  });

  it('skips (0, 0) GPS samples that mean "no fix yet"', () => {
    const messages: Msg[] = [
      { timestamp: ts(0), value: { latitude: 0, longitude: 0 } },
      { timestamp: ts(1), value: { latitude: 0, longitude: 0 } },
    ];
    const result = extractTrajectory(messages, 'sensor_msgs/msg/NavSatFix');
    expect(result.navSatRef).toBeNull();
    expect(result.points).toEqual([]);
  });
});

describe('trajectory/computeBounds', () => {
  it('returns null on empty input', () => {
    expect(computeBounds([])).toBeNull();
  });

  it('reports min/max across all points', () => {
    const points: TrajectoryPoint[] = [
      { t: ts(0), x: 0, y: 0 },
      { t: ts(1), x: 5, y: -3 },
      { t: ts(2), x: -1, y: 10 },
    ];
    expect(computeBounds(points)).toEqual({ minX: -1, maxX: 5, minY: -3, maxY: 10 });
  });

  it('inflates degenerate bounds (single point) so plots still render', () => {
    const single: TrajectoryPoint[] = [{ t: ts(0), x: 3, y: 3 }];
    const bounds = computeBounds(single)!;
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(0);
    expect(bounds.maxY - bounds.minY).toBeGreaterThan(0);
  });
});

describe('trajectory/nearestPointIndex', () => {
  const points: TrajectoryPoint[] = [
    { t: ts(0), x: 0, y: 0 },
    { t: ts(10), x: 1, y: 1 },
    { t: ts(20), x: 2, y: 2 },
  ];

  it('returns -1 on empty input', () => {
    expect(nearestPointIndex([], ts(5))).toBe(-1);
  });

  it('picks the closest point on either side', () => {
    expect(nearestPointIndex(points, ts(0))).toBe(0);
    expect(nearestPointIndex(points, ts(8))).toBe(1);
    expect(nearestPointIndex(points, ts(10))).toBe(1);
    expect(nearestPointIndex(points, ts(99))).toBe(2);
  });
});
