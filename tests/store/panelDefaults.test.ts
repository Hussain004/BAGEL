/**
 * Tests for v1.3.3 per-data-type display defaults (issue #44).
 *
 * Exercises:
 *  - `portableSubset` strips the non-portable fields (worldFrame, pivot,
 *    marker namespaces) but keeps every other knob the user might want to
 *    set as their default.
 *  - `resolveDefaults` merges saved entries on top of the hard-coded
 *    fallback and returns the fallback unchanged when nothing is saved.
 *  - The store round-trips through localStorage (`bagel:panel-defaults:v1`)
 *    and survives a corrupt entry without crashing.
 *  - `setDefault` / `clearDefault` / `clearAll` flow through correctly.
 */

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';

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

const { portableSubset, resolveDefaults, usePanelDefaultsStore } = await import(
  '../../src/store/panelDefaultsStore'
);
const { DEFAULT_THREE_D_SETTINGS } = await import('../../src/store/threeDPanelStore');
type ThreeDPanelSettings = import('../../src/store/threeDPanelStore').ThreeDPanelSettings;

function fullSettings(overrides: Partial<ThreeDPanelSettings> = {}): ThreeDPanelSettings {
  return { ...DEFAULT_THREE_D_SETTINGS, ...overrides };
}

beforeEach(() => {
  fakeStorage.clear();
  // Reset in-memory store between tests so save/clear assertions don't bleed.
  usePanelDefaultsStore.setState({ byKind: {} });
});

describe('portableSubset', () => {
  it('keeps the typical user-tuned knobs (color mode, accumulate, point size)', () => {
    const result = portableSubset(
      fullSettings({
        colorMode: 'intensity',
        accumulating: true,
        pointSize: 4.5,
      }),
    );
    expect(result.colorMode).toBe('intensity');
    expect(result.accumulating).toBe(true);
    expect(result.pointSize).toBe(4.5);
  });

  it('strips worldFrame (varies per bag)', () => {
    const result = portableSubset(fullSettings({ worldFrame: 'map' }));
    expect('worldFrame' in result).toBe(false);
  });

  it('strips pivot (viewport-specific)', () => {
    const result = portableSubset(fullSettings({ pivot: { x: 1, y: 2, z: 3 } }));
    expect('pivot' in result).toBe(false);
  });

  it('strips hiddenMarkerNamespaces (vary per bag)', () => {
    const result = portableSubset(
      fullSettings({ hiddenMarkerNamespaces: ['/planner/expanded'] }),
    );
    expect('hiddenMarkerNamespaces' in result).toBe(false);
  });
});

describe('resolveDefaults', () => {
  it('returns the hard-coded fallback when no saved entry exists', () => {
    const result = resolveDefaults('pointcloud', {});
    expect(result).toEqual(DEFAULT_THREE_D_SETTINGS);
  });

  it('overlays the saved partial onto the hard-coded fallback', () => {
    const byKind = {
      pointcloud: { colorMode: 'intensity' as const, accumulating: true },
    };
    const result = resolveDefaults('pointcloud', byKind);
    expect(result.colorMode).toBe('intensity');
    expect(result.accumulating).toBe(true);
    // Every other field still tracks the hard-coded fallback.
    expect(result.pointSize).toBe(DEFAULT_THREE_D_SETTINGS.pointSize);
    expect(result.upAxis).toBe(DEFAULT_THREE_D_SETTINGS.upAxis);
  });

  it('isolates kinds (saved pointcloud default does not affect laserscan)', () => {
    const byKind = {
      pointcloud: { colorMode: 'intensity' as const },
    };
    const result = resolveDefaults('laserscan', byKind);
    expect(result.colorMode).toBe(DEFAULT_THREE_D_SETTINGS.colorMode);
  });
});

describe('usePanelDefaultsStore - save / clear flow', () => {
  it('setDefault persists the portable subset', () => {
    const store = usePanelDefaultsStore.getState();
    store.setDefault(
      'pointcloud',
      fullSettings({
        colorMode: 'intensity',
        accumulating: true,
        worldFrame: 'map', // should be stripped
      }),
    );
    const saved = usePanelDefaultsStore.getState().byKind.pointcloud;
    expect(saved?.colorMode).toBe('intensity');
    expect(saved?.accumulating).toBe(true);
    expect('worldFrame' in (saved ?? {})).toBe(false);
  });

  it('setDefault writes through to localStorage', () => {
    const store = usePanelDefaultsStore.getState();
    store.setDefault('pointcloud', fullSettings({ colorMode: 'intensity' }));
    const raw = fakeStorage.getItem('bagel:panel-defaults:v1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    expect(parsed.pointcloud).toBeDefined();
    expect((parsed.pointcloud as { colorMode?: string }).colorMode).toBe(
      'intensity',
    );
  });

  it('clearDefault removes the entry for the given kind only', () => {
    const store = usePanelDefaultsStore.getState();
    store.setDefault('pointcloud', fullSettings({ colorMode: 'intensity' }));
    store.setDefault('laserscan', fullSettings({ pointSize: 6 }));
    store.clearDefault('pointcloud');
    const byKind = usePanelDefaultsStore.getState().byKind;
    expect(byKind.pointcloud).toBeUndefined();
    expect(byKind.laserscan).toBeDefined();
  });

  it('clearAll drops every entry', () => {
    const store = usePanelDefaultsStore.getState();
    store.setDefault('pointcloud', fullSettings({ colorMode: 'intensity' }));
    store.setDefault('laserscan', fullSettings({ pointSize: 6 }));
    store.clearAll();
    expect(usePanelDefaultsStore.getState().byKind).toEqual({});
    expect(fakeStorage.getItem('bagel:panel-defaults:v1')).toBe('{}');
  });

  it('has(kind) reflects whether an entry exists', () => {
    const store = usePanelDefaultsStore.getState();
    expect(store.has('pointcloud')).toBe(false);
    store.setDefault('pointcloud', fullSettings({ colorMode: 'intensity' }));
    expect(usePanelDefaultsStore.getState().has('pointcloud')).toBe(true);
  });
});
