/**
 * Tests for v1.3.3 loop playback (issue #45).
 *
 * Exercises the playhead store's `tick` end-of-range behaviour - the loop
 * flag should wrap the playhead back to start instead of pausing, plus the
 * persistence round-trip through localStorage.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';

/**
 * Node test environment doesn't ship `window` / `localStorage`. The
 * playhead store reads localStorage at hydrate time and on every
 * `setLoop`, so we polyfill the minimum surface before importing it.
 *
 * Hoisted via `globalThis` because the import is evaluated at the top of
 * the file after this block, so `globalThis.window` has to be in place
 * before vitest evaluates the import statement.
 */
const fakeStorage = {
  store: new Map<string, string>(),
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  },
  setItem(key: string, value: string) {
    this.store.set(key, value);
  },
  removeItem(key: string) {
    this.store.delete(key);
  },
  clear() {
    this.store.clear();
  },
};

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).window = { localStorage: fakeStorage };
});

afterAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).window;
});

const { usePlayheadStore } = await import('../../src/store/playheadStore');

const ONE_SEC_NS = 1_000_000_000n;

function resetStore() {
  // Fresh state per test - resetting through the store's public API rather
  // than tearing down the module so the lazy localStorage read isn't
  // re-triggered with each test.
  usePlayheadStore.setState({
    timeNs: 0n,
    startNs: 0n,
    endNs: 10n * ONE_SEC_NS,
    playing: false,
    speed: 1,
    loop: false,
    discreteSeekId: 0,
  });
}

beforeEach(() => {
  fakeStorage.clear();
  resetStore();
});

describe('tick - loop off (default)', () => {
  it('pauses at endNs when the next tick would overshoot', () => {
    const store = usePlayheadStore.getState();
    usePlayheadStore.setState({
      timeNs: 9n * ONE_SEC_NS,
      endNs: 10n * ONE_SEC_NS,
      playing: true,
      loop: false,
    });
    store.tick(2); // 2 seconds at 1x => overshoots by 1 s
    const after = usePlayheadStore.getState();
    expect(after.timeNs).toBe(10n * ONE_SEC_NS);
    expect(after.playing).toBe(false);
  });
});

describe('tick - loop on', () => {
  it('wraps to start when the next tick crosses endNs', () => {
    const store = usePlayheadStore.getState();
    usePlayheadStore.setState({
      timeNs: 9n * ONE_SEC_NS,
      startNs: 0n,
      endNs: 10n * ONE_SEC_NS,
      playing: true,
      loop: true,
    });
    store.tick(2); // overshoots by 1 s -> wraps to 1 s
    const after = usePlayheadStore.getState();
    expect(after.timeNs).toBe(1n * ONE_SEC_NS);
    expect(after.playing).toBe(true);
  });

  it('handles a huge overshoot via modulo (tab-was-backgrounded case)', () => {
    const store = usePlayheadStore.getState();
    usePlayheadStore.setState({
      timeNs: 0n,
      startNs: 0n,
      endNs: 1n * ONE_SEC_NS,
      playing: true,
      loop: true,
    });
    // 10 second tick on a 1 second bag - naive wrap would loop nine times.
    store.tick(10);
    const after = usePlayheadStore.getState();
    expect(after.timeNs >= 0n).toBe(true);
    expect(after.timeNs < ONE_SEC_NS).toBe(true);
    expect(after.playing).toBe(true);
  });

  it('honours speed multiplier when computing the wrap', () => {
    const store = usePlayheadStore.getState();
    usePlayheadStore.setState({
      timeNs: 8n * ONE_SEC_NS,
      startNs: 0n,
      endNs: 10n * ONE_SEC_NS,
      playing: true,
      loop: true,
      speed: 2, // 1 second of wall time => 2 s of bag time
    });
    store.tick(2); // overshoots by 2 s -> wraps to 2 s
    const after = usePlayheadStore.getState();
    expect(after.timeNs).toBe(2n * ONE_SEC_NS);
  });

  it('falls back to pause when the bag has zero range', () => {
    const store = usePlayheadStore.getState();
    usePlayheadStore.setState({
      timeNs: 5n * ONE_SEC_NS,
      startNs: 5n * ONE_SEC_NS,
      endNs: 5n * ONE_SEC_NS,
      playing: true,
      loop: true,
    });
    store.tick(1);
    const after = usePlayheadStore.getState();
    expect(after.playing).toBe(false);
  });
});

describe('setLoop - persistence', () => {
  it('writes the flag to localStorage so the next session can read it back', () => {
    const store = usePlayheadStore.getState();
    store.setLoop(true);
    expect(fakeStorage.getItem('bagel:loop:v1')).toBe('1');
    store.setLoop(false);
    expect(fakeStorage.getItem('bagel:loop:v1')).toBe('0');
  });

  it('exposes the new value via the store state', () => {
    const store = usePlayheadStore.getState();
    store.setLoop(true);
    expect(usePlayheadStore.getState().loop).toBe(true);
    store.setLoop(false);
    expect(usePlayheadStore.getState().loop).toBe(false);
  });
});

describe('initFromBag - preserves loop preference', () => {
  it('keeps the loop flag set when a new bag is loaded', () => {
    const store = usePlayheadStore.getState();
    store.setLoop(true);
    store.initFromBag(100n * ONE_SEC_NS, 200n * ONE_SEC_NS);
    const after = usePlayheadStore.getState();
    expect(after.loop).toBe(true);
    expect(after.timeNs).toBe(100n * ONE_SEC_NS);
  });
});

describe('discreteSeekId - distinguishes a jump from continuous motion', () => {
  it('increments on every seek() call', () => {
    const store = usePlayheadStore.getState();
    expect(usePlayheadStore.getState().discreteSeekId).toBe(0);
    store.seek(2n * ONE_SEC_NS);
    expect(usePlayheadStore.getState().discreteSeekId).toBe(1);
    store.seek(3n * ONE_SEC_NS);
    expect(usePlayheadStore.getState().discreteSeekId).toBe(2);
  });

  it('is left untouched by tick() (RAF playback)', () => {
    const store = usePlayheadStore.getState();
    store.seek(2n * ONE_SEC_NS);
    expect(usePlayheadStore.getState().discreteSeekId).toBe(1);
    store.tick(0.5);
    expect(usePlayheadStore.getState().discreteSeekId).toBe(1);
  });

  it('is left untouched by seekFraction() (pointer-drag scrubbing)', () => {
    const store = usePlayheadStore.getState();
    store.seek(2n * ONE_SEC_NS);
    expect(usePlayheadStore.getState().discreteSeekId).toBe(1);
    store.seekFraction(0.5);
    expect(usePlayheadStore.getState().discreteSeekId).toBe(1);
  });
});
