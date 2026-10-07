/**
 * Tests for the sidebar type chips.
 *
 * The categorisation matters because it is what a new user sees of an
 * unfamiliar bag: "4 images, 2 point clouds" is a much better first sentence
 * than a list of 200 names. The important assertions are that every visualisable
 * type maps to a real category rather than "Other", and that a CameraInfo topic
 * (which is not an image) lands with the camera family anyway.
 */

import { describe, it, expect } from 'vitest';
import { topicCategoryOf, countByCategory, categoryLabel } from '../../src/utils/topicCategory';
import type { TopicInfo } from '../../src/types/bag';

function t(name: string, type: string): TopicInfo {
  return { name, type, messageCount: 1, serializationFormat: 'cdr' };
}

describe('topicCategoryOf', () => {
  it('sorts the visualisable types into real categories', () => {
    const cases: [string, string][] = [
      ['/tf', 'tf'],
      ['/camera/front/image_raw', 'images'],
      ['/camera/front/compressed', 'images'],
      ['/camera/camera_info', 'camera-info'],
      ['/points', 'clouds'],
      ['/velodyne', 'clouds'],
      ['/scan', 'scans'],
      ['/map', 'maps'],
      ['/markers', 'markers'],
      ['/odom', 'trajectories'],
      ['/gps/fix', 'trajectories'],
      ['/diagnostics', 'diagnostics'],
      ['/rosout', 'logs'],
    ];
    const types: Record<string, string> = {
      '/tf': 'tf2_msgs/msg/TFMessage',
      '/camera/front/image_raw': 'sensor_msgs/msg/Image',
      '/camera/front/compressed': 'sensor_msgs/msg/CompressedImage',
      '/camera/camera_info': 'sensor_msgs/msg/CameraInfo',
      '/points': 'sensor_msgs/msg/PointCloud2',
      '/velodyne': 'livox_ros_driver2/msg/CustomMsg',
      '/scan': 'sensor_msgs/msg/LaserScan',
      '/map': 'nav_msgs/msg/OccupancyGrid',
      '/markers': 'visualization_msgs/msg/MarkerArray',
      '/odom': 'nav_msgs/msg/Odometry',
      '/gps/fix': 'sensor_msgs/msg/NavSatFix',
      '/diagnostics': 'diagnostic_msgs/msg/DiagnosticArray',
      '/rosout': 'rcl_interfaces/msg/Log',
    };
    for (const [name, expected] of cases) {
      expect(topicCategoryOf(t(name, types[name])), name).toBe(expected);
    }
  });

  it('puts CameraInfo with the camera family, not with images', () => {
    expect(topicCategoryOf(t('/camera/camera_info', 'sensor_msgs/msg/CameraInfo'))).toBe('camera-info');
  });

  it('puts TF before trajectory so /tf is not counted as a trajectory', () => {
    expect(topicCategoryOf(t('/tf', 'tf2_msgs/msg/TFMessage'))).toBe('tf');
  });

  it('returns other for a type nothing claims', () => {
    expect(topicCategoryOf(t('/foo', 'my_msgs/msg/Custom'))).toBe('other');
  });

  it('uses the topic name when a type needs it (TF)', () => {
    // isTfTopic checks the name as well as the type, so a TFMessage on a
    // different topic name is still TF.
    expect(topicCategoryOf(t('/tf_static', 'tf2_msgs/msg/TFMessage'))).toBe('tf');
  });
});

describe('categoryLabel', () => {
  it('returns the chip label for a known id', () => {
    expect(categoryLabel('images')).toBe('Images');
    expect(categoryLabel('other')).toBe('Other');
  });

  it('returns the id itself for an unknown one (future-proofing)', () => {
    expect(categoryLabel('not-a-category')).toBe('not-a-category');
  });
});

describe('countByCategory', () => {
  it('counts per category in TOPIC_CATEGORIES order with other last', () => {
    const topics = [
      t('/camera/a', 'sensor_msgs/msg/Image'),
      t('/camera/b', 'sensor_msgs/msg/Image'),
      t('/points', 'sensor_msgs/msg/PointCloud2'),
      t('/tf', 'tf2_msgs/msg/TFMessage'),
      t('/foo', 'my_msgs/msg/Custom'),
      t('/bar', 'my_msgs/msg/Other'),
    ];
    const counts = countByCategory(topics);
    expect(counts).toEqual([
      { id: 'tf', label: 'TF', count: 1 },
      { id: 'images', label: 'Images', count: 2 },
      { id: 'clouds', label: 'Point clouds', count: 1 },
      { id: 'other', label: 'Other', count: 2 },
    ]);
  });

  it('omits categories with zero topics', () => {
    const counts = countByCategory([t('/camera/a', 'sensor_msgs/msg/Image')]);
    expect(counts.map((c) => c.id)).toEqual(['images']);
    expect(counts.find((c) => c.id === 'tf')).toBeUndefined();
    expect(counts.find((c) => c.id === 'other')).toBeUndefined();
  });

  it('returns an empty list for an empty bag', () => {
    expect(countByCategory([])).toEqual([]);
  });
});