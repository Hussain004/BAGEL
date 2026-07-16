import { describe, it, expect, beforeEach } from 'vitest';
import { usePinnedTopicsStore, MAX_PINNED_TOPICS } from '../../src/store/pinnedTopicsStore';

function freshStore() {
  usePinnedTopicsStore.setState({ pinnedByBag: {} });
}

describe('pinnedTopicsStore', () => {
  beforeEach(freshStore);

  it('togglePin pins then unpins a topic', () => {
    const store = usePinnedTopicsStore.getState();
    expect(store.isPinned('bag1', '/imu')).toBe(false);
    store.togglePin('bag1', '/imu');
    expect(usePinnedTopicsStore.getState().isPinned('bag1', '/imu')).toBe(true);
    usePinnedTopicsStore.getState().togglePin('bag1', '/imu');
    expect(usePinnedTopicsStore.getState().isPinned('bag1', '/imu')).toBe(false);
  });

  it('keeps pins for different bags independent', () => {
    const store = usePinnedTopicsStore.getState();
    store.togglePin('bag1', '/imu');
    expect(usePinnedTopicsStore.getState().isPinned('bag2', '/imu')).toBe(false);
    expect(usePinnedTopicsStore.getState().isPinned('bag1', '/imu')).toBe(true);
  });

  it('refuses to pin past MAX_PINNED_TOPICS', () => {
    const store = usePinnedTopicsStore.getState();
    for (let i = 0; i < MAX_PINNED_TOPICS; i++) {
      store.togglePin('bag1', `/topic${i}`);
    }
    expect(usePinnedTopicsStore.getState().pinnedByBag.bag1).toHaveLength(MAX_PINNED_TOPICS);
    store.togglePin('bag1', '/oneTooMany');
    expect(usePinnedTopicsStore.getState().pinnedByBag.bag1).toHaveLength(MAX_PINNED_TOPICS);
    expect(usePinnedTopicsStore.getState().isPinned('bag1', '/oneTooMany')).toBe(false);
  });

  it('unpinning at the cap frees a slot for a new pin', () => {
    const store = usePinnedTopicsStore.getState();
    for (let i = 0; i < MAX_PINNED_TOPICS; i++) {
      store.togglePin('bag1', `/topic${i}`);
    }
    store.togglePin('bag1', '/topic0'); // unpin
    store.togglePin('bag1', '/newTopic'); // pin
    expect(usePinnedTopicsStore.getState().pinnedByBag.bag1).toHaveLength(MAX_PINNED_TOPICS);
    expect(usePinnedTopicsStore.getState().isPinned('bag1', '/newTopic')).toBe(true);
  });

  it('clearForBag removes only that bag', () => {
    const store = usePinnedTopicsStore.getState();
    store.togglePin('bag1', '/imu');
    store.togglePin('bag2', '/odom');
    store.clearForBag('bag1');
    expect(usePinnedTopicsStore.getState().pinnedByBag.bag1).toBeUndefined();
    expect(usePinnedTopicsStore.getState().isPinned('bag2', '/odom')).toBe(true);
  });
});
