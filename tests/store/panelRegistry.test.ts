/**
 * The panel registry stays whole: one runtime list of kinds (PANEL_KINDS),
 * and everything keyed by kind (UI text, components, topic routing) agrees
 * with it, so a new kind cannot be half-added.
 */
import { describe, it, expect } from 'vitest';
import { PANEL_KINDS, isPanelKind, type PanelKind } from '../../src/store/layoutStore';
import { PANEL_META, panelOptionsFor, suggestPanelKind } from '../../src/utils/panelOptions';
import { PANEL_COMPONENTS } from '../../src/components/panels/registry';
import type { TopicInfo } from '../../src/types/bag';

const topic = (name: string, type: string): TopicInfo => ({ name, type, messageCount: 10, serializationFormat: 'cdr' });

/** One topic of each shape the router distinguishes. */
const TOPICS = [
  topic('/tf', 'tf2_msgs/msg/TFMessage'),
  topic('/camera/image_raw', 'sensor_msgs/msg/Image'),
  topic('/camera/annotations', 'foxglove.ImageAnnotations'),
  topic('/splat', 'gaussian/GaussianSplat'),
  topic('/status', 'std_msgs/msg/String'),
  topic('/armed', 'std_msgs/msg/Bool'),
  topic('/mode', 'std_msgs/msg/Int32'),
  topic('/points', 'sensor_msgs/msg/PointCloud2'),
  topic('/scan', 'sensor_msgs/msg/LaserScan'),
  topic('/markers', 'visualization_msgs/msg/MarkerArray'),
  topic('/map', 'nav_msgs/msg/OccupancyGrid'),
  topic('/plan', 'nav_msgs/msg/Path'),
  topic('/diagnostics', 'diagnostic_msgs/msg/DiagnosticArray'),
  topic('/rosout', 'rcl_interfaces/msg/Log'),
  topic('/odom', 'nav_msgs/msg/Odometry'),
  topic('/pose', 'geometry_msgs/msg/Pose'),
  topic('/imu', 'sensor_msgs/msg/Imu'),
  topic('/audio', 'audio_common_msgs/msg/AudioDataStamped'),
];

describe('panel registry', () => {
  it('declares UI text and a component for exactly the kinds in PANEL_KINDS', () => {
    expect(Object.keys(PANEL_META).sort()).toEqual([...PANEL_KINDS].sort());
    expect(Object.keys(PANEL_COMPONENTS).sort()).toEqual([...PANEL_KINDS].sort());
  });

  it('every topic-backed kind is reachable from some topic', () => {
    const reachable = new Set<PanelKind>(TOPICS.flatMap(panelOptionsFor));
    // Health opens from the toolbar for the whole bag, not from a topic.
    expect(PANEL_KINDS.filter((k) => !reachable.has(k))).toEqual(['health']);
  });

  it("a topic's default kind is always one of its buttons", () => {
    for (const t of TOPICS) expect(panelOptionsFor(t), t.type).toContain(suggestPanelKind(t));
  });

  it('isPanelKind accepts every kind and nothing else', () => {
    for (const k of PANEL_KINDS) expect(isPanelKind(k)).toBe(true);
    for (const k of ['', 'Plot', 'spectrogram', 'constructor', '__proto__', 3, null, undefined]) expect(isPanelKind(k)).toBe(false);
  });
});
