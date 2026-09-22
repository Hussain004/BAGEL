import { describe, it, expect } from 'vitest';
import {
  flattenNumeric,
  nearestMessageIndex,
  isImageType,
  isCompressedImageType,
  isVideoType,
  isTrajectoryCapableType,
  isTfTopic,
  isPointCloud2Type,
  isCustomLidarType,
  isCustomLidarCapableType,
  isCloudType,
  isLaserScanType,
  isOccupancyGridType,
  is3DCapableType,
  isMarkerArrayType,
  isMarkerType,
  isDiagnosticArrayType,
  isLogType,
} from '../../src/utils/messages';

describe('messages/flattenNumeric', () => {
  it('flattens nested numeric fields to dot-joined paths', () => {
    const twist = {
      linear: { x: 0.5, y: 0, z: 0 },
      angular: { x: 0, y: 0, z: 1.2 },
    };
    expect(flattenNumeric(twist)).toEqual({
      'linear.x': 0.5,
      'linear.y': 0,
      'linear.z': 0,
      'angular.x': 0,
      'angular.y': 0,
      'angular.z': 1.2,
    });
  });

  it('coerces booleans to 1/0 (plottable)', () => {
    expect(flattenNumeric({ ok: true, fail: false })).toEqual({ ok: 1, fail: 0 });
  });

  it('coerces bigints to numbers (lossy above 2^53, intentional)', () => {
    expect(flattenNumeric({ count: 42n })).toEqual({ count: 42 });
  });

  it('skips NaN / Infinity in numeric leaves', () => {
    // The predicate is `Number.isFinite`, so non-finite values drop entirely.
    expect(flattenNumeric({ a: NaN, b: Infinity, c: 1 })).toEqual({ c: 1 });
  });

  it('expands short typed-numeric arrays as indexed leaves', () => {
    expect(flattenNumeric({ pose: [1, 2, 3] })).toEqual({
      'pose[0]': 1,
      'pose[1]': 2,
      'pose[2]': 3,
    });
  });

  it('skips plain arrays longer than 16 (bulk / image-style data)', () => {
    const big = Array.from({ length: 64 }, (_, i) => i);
    expect(flattenNumeric({ data: big })).toEqual({});
  });

  it('still caps a plain (untyped) 36-element array at 16, so it is skipped', () => {
    // Documented choice: only typed arrays (what the CDR MessageReader emits
    // for fixed-size numeric fields) get the raised 64-element cap.
    const plainCovariance = Array.from({ length: 36 }, (_, i) => i);
    expect(flattenNumeric({ covariance: plainCovariance })).toEqual({});
  });

  it('expands a Float64Array covariance in full with bracket-index paths', () => {
    // float64[36] pose covariance arrives as a Float64Array and must land as
    // covariance[0..35] (the mathExpr bracket notation), not covariance.0
    // dot keys or a skipped field.
    const covariance = new Float64Array(36);
    for (let i = 0; i < 36; i++) covariance[i] = i;
    const flat = flattenNumeric({ pose: { covariance } });
    expect(Object.keys(flat)).toHaveLength(36);
    expect(flat['pose.covariance[0]']).toBe(0);
    expect(flat['pose.covariance[35]']).toBe(35);
  });

  it('skips typed arrays beyond the documented 64-element cap', () => {
    expect(flattenNumeric({ samples: new Float64Array(65) })).toEqual({});
  });

  it('never emits dot-index keys for bulk Uint8 typed arrays', () => {
    const flat = flattenNumeric({ data: new Uint8Array(100) });
    expect(flat).toEqual({});
    expect(Object.keys(flat).some((k) => /\.\d+$/.test(k))).toBe(false);
  });

  it('returns empty for null / undefined / strings', () => {
    expect(flattenNumeric(null)).toEqual({});
    expect(flattenNumeric(undefined)).toEqual({});
    expect(flattenNumeric({ s: 'hello' })).toEqual({});
  });
});

describe('messages/nearestMessageIndex', () => {
  const sorted = [
    { timestamp: 100n },
    { timestamp: 200n },
    { timestamp: 350n },
    { timestamp: 500n },
  // The fields beyond `timestamp` are not consulted by the binary search,
  // so the test fixture stays minimal.
  ] as unknown as Parameters<typeof nearestMessageIndex>[0];

  it('returns -1 on an empty list', () => {
    expect(
      nearestMessageIndex(
        [] as unknown as Parameters<typeof nearestMessageIndex>[0],
        0n,
      ),
    ).toBe(-1);
  });

  it('finds the exact match', () => {
    expect(nearestMessageIndex(sorted, 200n)).toBe(1);
  });

  it('rounds toward the nearer neighbour', () => {
    // 240 is closer to 200 (d=40) than 350 (d=110)
    expect(nearestMessageIndex(sorted, 240n)).toBe(1);
    // 280 is closer to 350 (d=70) than 200 (d=80)
    expect(nearestMessageIndex(sorted, 280n)).toBe(2);
  });

  it('clamps to the first/last entry past the bounds', () => {
    expect(nearestMessageIndex(sorted, 0n)).toBe(0);
    expect(nearestMessageIndex(sorted, 9999n)).toBe(3);
  });
});

describe('messages/type sniffing', () => {
  it('isImageType matches ROS1 + ROS2 + Compressed', () => {
    expect(isImageType('sensor_msgs/Image')).toBe(true);
    expect(isImageType('sensor_msgs/msg/Image')).toBe(true);
    expect(isImageType('sensor_msgs/CompressedImage')).toBe(true);
    expect(isImageType('sensor_msgs/msg/CompressedImage')).toBe(true);
    expect(isImageType('std_msgs/String')).toBe(false);
  });

  it('isCompressedImageType is strict to compressed variants', () => {
    expect(isCompressedImageType('sensor_msgs/CompressedImage')).toBe(true);
    expect(isCompressedImageType('sensor_msgs/Image')).toBe(false);
  });

  it('isVideoType includes explicit H264/H265 CompressedImage topics', () => {
    expect(isVideoType('foxglove.CompressedVideo')).toBe(true);
    expect(isVideoType('sensor_msgs/msg/CompressedImage', '/robot1/camera/image_raw/h264')).toBe(true);
    expect(isVideoType('sensor_msgs/msg/CompressedImage', '/robot1/camera/image_raw/compressed')).toBe(false);
    expect(isVideoType('sensor_msgs/msg/Image', '/robot1/camera/image_raw/h264')).toBe(false);
  });

  it('isTrajectoryCapableType covers every supported pose type', () => {
    const types = [
      'nav_msgs/Odometry',
      'nav_msgs/msg/Odometry',
      'geometry_msgs/PoseStamped',
      'geometry_msgs/PoseWithCovarianceStamped',
      'geometry_msgs/Pose',
      'geometry_msgs/Point',
      'geometry_msgs/PointStamped',
      'geometry_msgs/TransformStamped',
      'sensor_msgs/NavSatFix',
    ];
    for (const t of types) {
      expect(isTrajectoryCapableType(t), t).toBe(true);
    }
    expect(isTrajectoryCapableType('sensor_msgs/Image')).toBe(false);
  });

  it('isTfTopic rejects matching types on the wrong topic name', () => {
    expect(isTfTopic('/tf', 'tf2_msgs/msg/TFMessage')).toBe(true);
    expect(isTfTopic('/tf_static', 'tf2_msgs/msg/TFMessage')).toBe(true);
    expect(isTfTopic('/robot1/tf', 'tf2_msgs/msg/TFMessage')).toBe(true);
    expect(isTfTopic('/random/topic', 'tf2_msgs/msg/TFMessage')).toBe(false);
    expect(isTfTopic('/tf', 'std_msgs/String')).toBe(false);
  });

  it('isPointCloud2Type / isCustomLidarType / isCloudType compose correctly', () => {
    expect(isPointCloud2Type('sensor_msgs/msg/PointCloud2')).toBe(true);
    expect(isCustomLidarType('livox_ros_driver2/msg/CustomMsg')).toBe(true);
    expect(isCloudType('sensor_msgs/PointCloud2')).toBe(true);
    expect(isCloudType('livox_ros_driver/msg/CustomMsg')).toBe(true);
    expect(isCloudType('sensor_msgs/Image')).toBe(false);
  });

  it('isCustomLidarCapableType widens to vendor /PointCloud names; the narrow one does not', () => {
    // The two predicates genuinely differ; both live in messages.ts so the
    // lists can't drift (customCloud.ts re-exports the narrow one).
    expect(isCustomLidarCapableType('livox_ros_driver2/msg/CustomMsg')).toBe(true);
    expect(isCustomLidarCapableType('vendor_msgs/PointCloud')).toBe(true);
    expect(isCustomLidarCapableType('sensor_msgs/PointCloud2')).toBe(false);
    expect(isCustomLidarCapableType('')).toBe(false);
    expect(isCustomLidarType('vendor_msgs/PointCloud')).toBe(false);
    expect(isCustomLidarType('')).toBe(false);
  });

  it('isLaserScanType + isOccupancyGridType are exact', () => {
    expect(isLaserScanType('sensor_msgs/LaserScan')).toBe(true);
    expect(isOccupancyGridType('nav_msgs/OccupancyGrid')).toBe(true);
    expect(isOccupancyGridType('nav_msgs/msg/OccupancyGrid')).toBe(true);
    expect(isOccupancyGridType('')).toBe(false);
  });

  it('is3DCapableType returns true for clouds, scans, markers, maps, and poses', () => {
    expect(is3DCapableType('sensor_msgs/PointCloud2')).toBe(true);
    expect(is3DCapableType('sensor_msgs/LaserScan')).toBe(true);
    expect(is3DCapableType('visualization_msgs/MarkerArray')).toBe(true);
    expect(is3DCapableType('nav_msgs/OccupancyGrid')).toBe(true);
    expect(is3DCapableType('nav_msgs/Odometry')).toBe(true);
    expect(is3DCapableType('std_msgs/String')).toBe(false);
  });

  it('isMarkerArrayType / isMarkerType require the visualization_msgs prefix', () => {
    expect(isMarkerArrayType('visualization_msgs/msg/MarkerArray')).toBe(true);
    expect(isMarkerArrayType('visualization_msgs/MarkerArray')).toBe(true);
    expect(isMarkerType('visualization_msgs/msg/Marker')).toBe(true);
    // A random package that happens to call its message `Marker` shouldn't match.
    expect(isMarkerType('my_pkg/Marker')).toBe(false);
    expect(isMarkerArrayType('my_pkg/MarkerArray')).toBe(false);
  });

  it('isDiagnosticArrayType requires the diagnostic_msgs prefix', () => {
    expect(isDiagnosticArrayType('diagnostic_msgs/DiagnosticArray')).toBe(true);
    expect(isDiagnosticArrayType('diagnostic_msgs/msg/DiagnosticArray')).toBe(true);
    expect(isDiagnosticArrayType('my_pkg/DiagnosticArray')).toBe(false);
    expect(isDiagnosticArrayType('diagnostic_msgs/DiagnosticStatus')).toBe(false);
    expect(isDiagnosticArrayType('')).toBe(false);
  });

  it('isLogType matches both ROS1 and ROS2 log shapes', () => {
    expect(isLogType('rcl_interfaces/Log')).toBe(true);
    expect(isLogType('rcl_interfaces/msg/Log')).toBe(true);
    expect(isLogType('rosgraph_msgs/Log')).toBe(true);
    expect(isLogType('rosgraph_msgs/msg/Log')).toBe(true);
    // Different `Log` types in unrelated packages don't match — our decoder
    // expects the specific level/name/msg shape.
    expect(isLogType('my_pkg/Log')).toBe(false);
    expect(isLogType('')).toBe(false);
  });
});
