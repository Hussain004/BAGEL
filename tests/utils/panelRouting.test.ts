/**
 * Pins which panels each kind of topic offers, and which one a click opens.
 * Written before the panel registry refactor and expected to pass unchanged
 * after it: a new panel kind should show up here as a deliberate edit.
 */
import { describe, expect, it } from 'vitest';
import { KIND_BUTTON_LABEL, KIND_BUTTON_TITLE, KIND_PALETTE_LABEL, panelOptionsFor, suggestPanelKind } from '../../src/utils/panelOptions';
import type { TopicInfo } from '../../src/types/bag';

const t = (type: string, name = '/t'): TopicInfo => ({ name, type, messageCount: 1, serializationFormat: 'cdr' });

// [type, topic name, suggested kind, offered kinds]
const CASES: Array<[string, string, string, string[]]> = [
  ['tf2_msgs/msg/TFMessage', '/tf', 'tf', ['tf', 'raw']],
  ['sensor_msgs/msg/Image', '/cam', 'image', ['image', 'raw']],
  ['sensor_msgs/msg/CompressedImage', '/cam/compressed', 'image', ['image', 'raw']],
  ['foxglove.CompressedVideo', '/video', 'image', ['image', 'raw']],
  ['sensor_msgs/msg/PointCloud2', '/points', '3d', ['3d', 'raw']],
  ['sensor_msgs/msg/LaserScan', '/scan', '3d', ['3d', 'plot', 'raw']],
  ['visualization_msgs/msg/MarkerArray', '/markers', '3d', ['3d', 'raw']],
  ['visualization_msgs/msg/Marker', '/marker', '3d', ['3d', 'raw']],
  ['nav_msgs/msg/OccupancyGrid', '/map', '3d', ['3d', 'raw']],
  ['nav_msgs/msg/Path', '/plan', '3d', ['3d', 'raw']],
  ['geometry_msgs/msg/PoseArray', '/particles', '3d', ['3d', 'raw']],
  ['geometry_msgs/msg/PolygonStamped', '/footprint', '3d', ['3d', 'raw']],
  ['diagnostic_msgs/msg/DiagnosticArray', '/diagnostics', 'diagnostic', ['diagnostic', 'raw']],
  ['rcl_interfaces/msg/Log', '/rosout', 'log', ['log', 'raw']],
  ['rosgraph_msgs/Log', '/rosout', 'log', ['log', 'raw']],
  ['nav_msgs/msg/Odometry', '/odom', 'plot', ['trajectory', '3d', 'plot', 'raw']],
  ['geometry_msgs/msg/PoseStamped', '/pose', 'plot', ['trajectory', '3d', 'plot', 'raw']],
  ['geometry_msgs/msg/PoseWithCovarianceStamped', '/amcl_pose', 'plot', ['trajectory', '3d', 'plot', 'raw']],
  ['geometry_msgs/msg/TransformStamped', '/t', 'trajectory', ['trajectory', '3d', 'plot', 'raw']],
  ['sensor_msgs/msg/NavSatFix', '/gps/fix', 'plot', ['trajectory', 'plot', 'raw']],
  ['geometry_msgs/msg/Pose', '/p', 'trajectory', ['trajectory', 'plot', 'raw']],
  ['geometry_msgs/msg/Point', '/p', 'trajectory', ['trajectory', 'plot', 'raw']],
  ['sensor_msgs/msg/Imu', '/imu', 'plot', ['plot', 'raw', 'search']],
  ['sensor_msgs/msg/BatteryState', '/battery', 'plot', ['plot', 'raw', 'search']],
  ['std_msgs/msg/Float64', '/f', 'plot', ['plot', 'raw', 'search']],
  ['std_msgs/msg/Int32', '/i', 'plot', ['state', 'plot', 'raw', 'search']],
  ['std_msgs/msg/UInt8', '/u', 'plot', ['state', 'plot', 'raw', 'search']],
  ['std_msgs/msg/Bool', '/b', 'state', ['state', 'plot', 'raw', 'search']],
  ['std_msgs/msg/String', '/s', 'state', ['state', 'raw', 'search']],
  ['geometry_msgs/msg/Twist', '/cmd_vel', 'plot', ['plot', 'raw', 'search']],
  ['sensor_msgs/msg/CameraInfo', '/cam/camera_info', 'plot', ['plot', 'raw', 'search']],
  ['vision_msgs/msg/Detection2DArray', '/detections', 'plot', ['plot', 'raw', 'search']],
  ['custom_msgs/msg/Whatever', '/w', 'plot', ['plot', 'raw', 'search']],
];

describe('panel routing', () => {
  for (const [type, name, suggested, offered] of CASES) {
    it(`${type} on ${name}`, () => {
      expect(suggestPanelKind(t(type, name))).toBe(suggested);
      expect(panelOptionsFor(t(type, name))).toEqual(offered);
    });
  }

  it('every kind has a button label, a palette label and a tooltip', () => {
    const kinds = Object.keys(KIND_BUTTON_LABEL);
    expect(kinds.sort()).toEqual(['3d', 'diagnostic', 'health', 'image', 'log', 'plot', 'raw', 'search', 'splat', 'state', 'tf', 'trajectory']);
    expect(Object.keys(KIND_PALETTE_LABEL).sort()).toEqual(kinds);
    expect(Object.keys(KIND_BUTTON_TITLE).sort()).toEqual(kinds);
  });
});
