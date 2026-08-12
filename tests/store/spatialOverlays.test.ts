import { describe, expect, it, beforeEach } from 'vitest';
import {
  DEFAULT_THREE_D_SETTINGS,
  useThreeDPanelStore,
} from '../../src/store/threeDPanelStore';
import { portableSubset } from '../../src/store/panelDefaultsStore';
import { getSpatialOverlayCandidates } from '../../src/components/panels/ThreeDScene/spatialOverlayTopics';
import type { TopicInfo } from '../../src/types/bag';

function topic(name: string, type: string, messageCount = 1): TopicInfo {
  return { name, type, messageCount, serializationFormat: 'cdr' };
}

beforeEach(() => {
  useThreeDPanelStore.setState({ byId: {} });
});

describe('spatial topic overlays', () => {
  it('offers map, cloud, scan, and pose topics except the primary topic', () => {
    const topics = [
      topic('/map', 'nav_msgs/msg/OccupancyGrid'),
      topic('/points', 'sensor_msgs/msg/PointCloud2'),
      topic('/scan', 'sensor_msgs/msg/LaserScan'),
      topic('/odom', 'nav_msgs/msg/Odometry'),
      topic('/markers', 'visualization_msgs/msg/MarkerArray'),
      topic('/image', 'sensor_msgs/msg/Image'),
      topic('/empty_pose', 'geometry_msgs/msg/PoseStamped', 0),
    ];

    expect(getSpatialOverlayCandidates(topics, '/map')).toEqual([
      { name: '/points', type: 'sensor_msgs/msg/PointCloud2' },
      { name: '/scan', type: 'sensor_msgs/msg/LaserScan' },
      { name: '/odom', type: 'nav_msgs/msg/Odometry' },
    ]);
  });

  it('stores layer selections independently per 3D panel', () => {
    const { update } = useThreeDPanelStore.getState();
    update('3d:/map', { spatialOverlayTopics: ['/odom', '/points'] });
    update('3d:/scan', { spatialOverlayTopics: ['/map'] });

    expect(useThreeDPanelStore.getState().byId['3d:/map']?.spatialOverlayTopics).toEqual([
      '/odom',
      '/points',
    ]);
    expect(useThreeDPanelStore.getState().byId['3d:/scan']?.spatialOverlayTopics).toEqual([
      '/map',
    ]);
  });

  it('does not copy bag-specific layer names into saved defaults', () => {
    const portable = portableSubset({
      ...DEFAULT_THREE_D_SETTINGS,
      spatialOverlayTopics: ['/map', '/points'],
    });

    expect('spatialOverlayTopics' in portable).toBe(false);
  });
});
