import { describe, expect, it } from 'vitest';
import { panelOptionsFor, suggestPanelKind } from '../../src/utils/panelOptions';
import type { TopicInfo } from '../../src/types/bag';

const t = (type: string, name = '/t'): TopicInfo => ({ name, type, messageCount: 1, serializationFormat: 'cdr' });

describe('state timeline routing', () => {
  it('opens Bool and String in the state panel by default', () => {
    for (const type of ['std_msgs/Bool', 'std_msgs/msg/Bool', 'std_msgs/String', 'std_msgs/msg/String']) {
      expect(suggestPanelKind(t(type))).toBe('state');
    }
  });

  it('offers a plot for Bool and integers but not for String, which has nothing numeric', () => {
    expect(panelOptionsFor(t('std_msgs/msg/Bool'))).toEqual(['state', 'plot', 'raw', 'search']);
    expect(panelOptionsFor(t('std_msgs/msg/UInt8'))).toEqual(['state', 'plot', 'raw', 'search']);
    expect(panelOptionsFor(t('std_msgs/msg/Int32'))).toEqual(['state', 'plot', 'raw', 'search']);
    expect(panelOptionsFor(t('std_msgs/msg/String'))).toEqual(['state', 'raw', 'search']);
  });

  it('keeps integers defaulting to the plot, as before', () => {
    expect(suggestPanelKind(t('std_msgs/msg/Int32'))).toBe('plot');
  });

  it('does not touch floats or unrelated types', () => {
    expect(panelOptionsFor(t('std_msgs/msg/Float64'))).toEqual(['plot', 'raw', 'search']);
    expect(panelOptionsFor(t('sensor_msgs/msg/Image'))).toEqual(['image', 'raw']);
    expect(panelOptionsFor(t('custom_msgs/msg/Bool'))).toEqual(['plot', 'raw', 'search']);
    // Heavy or specialised types never get a message scan.
    for (const [type, name] of [
      ['sensor_msgs/msg/PointCloud2', '/t'],
      ['sensor_msgs/msg/Image', '/t'],
      ['nav_msgs/msg/Odometry', '/t'],
      ['tf2_msgs/msg/TFMessage', '/tf'], // a TF topic is recognised by name as well as type
    ] as const) {
      expect(panelOptionsFor(t(type, name))).not.toContain('search');
    }
  });
});
