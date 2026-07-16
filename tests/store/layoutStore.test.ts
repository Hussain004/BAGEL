import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore } from '../../src/store/layoutStore';

function freshStore() {
  useLayoutStore.setState({ root: null, openOrder: [], maximizedId: null });
}

describe('layoutStore maximize', () => {
  beforeEach(freshStore);

  it('setMaximizedId sets and clears the maximized panel', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/imu', type: 'sensor_msgs/Imu' });
    const id = useLayoutStore.getState().openOrder[0];
    store.setMaximizedId(id);
    expect(useLayoutStore.getState().maximizedId).toBe(id);
    store.setMaximizedId(null);
    expect(useLayoutStore.getState().maximizedId).toBeNull();
  });

  it('closePanel clears maximizedId only when the maximized panel is the one closed', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't' });
    const [idA, idB] = useLayoutStore.getState().openOrder;

    store.setMaximizedId(idA);
    store.closePanel(idB);
    expect(useLayoutStore.getState().maximizedId).toBe(idA);

    store.closePanel(idA);
    expect(useLayoutStore.getState().maximizedId).toBeNull();
  });

  it('closeAllPanels clears maximizedId', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    const id = useLayoutStore.getState().openOrder[0];
    store.setMaximizedId(id);
    store.closeAllPanels();
    expect(useLayoutStore.getState().maximizedId).toBeNull();
  });

  it('closePanelsForBag clears maximizedId only if the maximized panel belonged to that bag', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't', bagId: 'bagA' });
    store.openPanel({ kind: 'plot', topicName: '/b', type: 't', bagId: 'bagB' });
    const ids = useLayoutStore.getState().openOrder;
    const idA = ids.find((i) => i.includes('bagA'))!;
    const idB = ids.find((i) => i.includes('bagB'))!;

    store.setMaximizedId(idB);
    store.closePanelsForBag('bagA');
    // idB survives (different bag), maximize state untouched.
    expect(useLayoutStore.getState().maximizedId).toBe(idB);

    store.closePanelsForBag('bagB');
    expect(useLayoutStore.getState().maximizedId).toBeNull();
    void idA;
  });

  it('restoreLayout always resets maximizedId to null', () => {
    const store = useLayoutStore.getState();
    store.openPanel({ kind: 'plot', topicName: '/a', type: 't' });
    const id = useLayoutStore.getState().openOrder[0];
    store.setMaximizedId(id);
    store.restoreLayout({ node: 'panel', id, kind: 'plot', topicName: '/a', type: 't' });
    expect(useLayoutStore.getState().maximizedId).toBeNull();
  });
});
