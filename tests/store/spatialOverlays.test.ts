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

    expect(getSpatialOverlayCandidates([{ bagId: 'b1', topics }], 'b1', '/map')).toEqual([
      { bagId: 'b1', name: '/points', type: 'sensor_msgs/msg/PointCloud2' },
      { bagId: 'b1', name: '/scan', type: 'sensor_msgs/msg/LaserScan' },
      { bagId: 'b1', name: '/odom', type: 'nav_msgs/msg/Odometry' },
    ]);
  });

  it('draws candidates from every loaded bag, excluding only the primary bag+topic pair', () => {
    // Two bags both publish a topic named "/map" (e.g. two robots sharing
    // the same topic name). The primary panel is on bag "a"'s "/map" - that
    // exact (bagId, name) pair should be excluded, but bag "b"'s "/map" is a
    // valid cross-bag overlay candidate despite sharing the same name.
    const bags = [
      { bagId: 'a', topics: [topic('/map', 'nav_msgs/msg/OccupancyGrid')] },
      { bagId: 'b', topics: [topic('/map', 'nav_msgs/msg/OccupancyGrid')] },
    ];

    expect(getSpatialOverlayCandidates(bags, 'a', '/map')).toEqual([
      { bagId: 'b', name: '/map', type: 'nav_msgs/msg/OccupancyGrid' },
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
