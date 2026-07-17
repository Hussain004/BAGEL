import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBagStore, type BagEntry } from '../../src/store/bagStore';
import { getAllPanels, useLayoutStore, type LayoutNode } from '../../src/store/layoutStore';
import { usePresetStore } from '../../src/store/presetStore';

function bagEntry(id: string, topics: { name: string; type: string }[]): BagEntry {
  return {
    id,
    kind: 'file',
    summary: { topics } as BagEntry['summary'],
    source: null,
    liveConn: null,
    color: '#000000',
  };
}

function resetStores() {
  useLayoutStore.setState({ root: null, openOrder: [], maximizedId: null });
  usePresetStore.setState({ presets: [] });
  useBagStore.setState({
    bags: new Map(),
    bagOrder: [],
    focusBagId: null,
    bag: null,
    source: null,
  });
}

describe('presetStore', () => {
  beforeEach(resetStores);

  it('saves panel kinds and types without concrete topic or bag ids', () => {
    const root: LayoutNode = {
      node: 'panel',
      id: 'image:bag-a:/camera/front',
      kind: 'image',
      topicName: '/camera/front',
      type: 'sensor_msgs/Image',
      bagId: 'bag-a',
    };
    useLayoutStore.getState().restoreLayout(root);

    usePresetStore.getState().savePreset('  Camera rig  ');

    expect(usePresetStore.getState().presets).toEqual([
      {
        id: expect.stringMatching(/^preset-/),
        name: 'Camera rig',
        tree: { node: 'slot', kind: 'image', type: 'sensor_msgs/Image' },
      },
    ]);
  });

  it('applies a preset to the focused bag using type-based topic matching', () => {
    const bag = bagEntry('bag-b', [
      { name: '/rear/image', type: 'sensor_msgs/Image' },
      { name: '/imu/left', type: 'sensor_msgs/Imu' },
    ]);
    useBagStore.setState({
      bags: new Map([[bag.id, bag]]),
      bagOrder: [bag.id],
      focusBagId: bag.id,
      bag: bag.summary,
    });
    usePresetStore.setState({
      presets: [{
        id: 'camera-and-imu',
        name: 'Camera and IMU',
        tree: {
          node: 'split',
          orientation: 'horizontal',
          children: [
            { node: 'slot', kind: 'image', type: 'sensor_msgs/Image' },
            { node: 'slot', kind: 'plot', type: 'sensor_msgs/Imu' },
          ],
        },
      }],
    });

    usePresetStore.getState().applyPreset('camera-and-imu');

    expect(getAllPanels(useLayoutStore.getState().root)).toMatchObject([
      { kind: 'image', topicName: '/rear/image', bagId: 'bag-b' },
      { kind: 'plot', topicName: '/imu/left', bagId: 'bag-b' },
    ]);
  });

  it('drops unmatched slots and collapses their split', () => {
    const bag = bagEntry('bag-c', [{ name: '/scan', type: 'sensor_msgs/LaserScan' }]);
    useBagStore.setState({
      bags: new Map([[bag.id, bag]]),
      bagOrder: [bag.id],
      focusBagId: bag.id,
      bag: bag.summary,
    });
    usePresetStore.setState({
      presets: [{
        id: 'slam',
        name: 'SLAM',
        tree: {
          node: 'split',
          orientation: 'vertical',
          children: [
            { node: 'slot', kind: '3d', type: 'sensor_msgs/LaserScan' },
            { node: 'slot', kind: 'image', type: 'sensor_msgs/Image' },
          ],
        },
      }],
    });

    usePresetStore.getState().applyPreset('slam');

    expect(useLayoutStore.getState().root).toMatchObject({
      node: 'panel',
      kind: '3d',
      topicName: '/scan',
      bagId: 'bag-c',
    });
  });

  it('deletes a saved preset', () => {
    usePresetStore.setState({
      presets: [{
        id: 'old',
        name: 'Old preset',
        tree: { node: 'slot', kind: 'plot', type: 'sensor_msgs/Imu' },
      }],
    });

    usePresetStore.getState().deletePreset('old');

    expect(usePresetStore.getState().presets).toEqual([]);
  });

  it('persists changes to localStorage', () => {
    const setItem = vi.fn();
    vi.stubGlobal('window', { localStorage: { setItem } });
    useLayoutStore.getState().restoreLayout({
      node: 'panel',
      id: 'plot:/imu',
      kind: 'plot',
      topicName: '/imu',
      type: 'sensor_msgs/Imu',
    });

    usePresetStore.getState().savePreset('IMU');

    expect(setItem).toHaveBeenCalledWith(
      'bagel:presets:v1',
      expect.stringContaining('"name":"IMU"'),
    );
    vi.unstubAllGlobals();
  });
});
