import { describe, it, expect, beforeEach } from 'vitest';

// Polyfill localStorage for the store module.
const store: Record<string, string> = {};
const fakeLocalStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: fakeLocalStorage,
  writable: true,
});

import { useAnnotationStore } from '../../src/store/annotationStore';

function freshStore() {
  useAnnotationStore.setState({ annotations: [], currentBagKey: null });
  fakeLocalStorage.clear();
}

describe('annotationStore', () => {
  beforeEach(freshStore);

  it('defaults to empty annotations', () => {
    expect(useAnnotationStore.getState().annotations).toHaveLength(0);
    expect(useAnnotationStore.getState().currentBagKey).toBeNull();
  });

  it('addAnnotation appends a sorted entry and returns its id', () => {
    const store = useAnnotationStore.getState();
    const id = store.addAnnotation(5_000_000_000n, 'Second');
    const id2 = store.addAnnotation(2_000_000_000n, 'First');
    const { annotations } = useAnnotationStore.getState();
    expect(annotations).toHaveLength(2);
    // Sorted by timeNs ascending
    expect(annotations[0].label).toBe('First');
    expect(annotations[1].label).toBe('Second');
    expect(typeof id).toBe('string');
    expect(typeof id2).toBe('string');
    expect(id).not.toBe(id2);
  });

  it('removeAnnotation removes by id', () => {
    const s = useAnnotationStore.getState();
    const id = s.addAnnotation(1_000_000_000n, 'ToRemove');
    s.addAnnotation(2_000_000_000n, 'Keep');
    useAnnotationStore.getState().removeAnnotation(id);
    const { annotations } = useAnnotationStore.getState();
    expect(annotations).toHaveLength(1);
    expect(annotations[0].label).toBe('Keep');
  });

  it('updateLabel changes only the target annotation label', () => {
    const s = useAnnotationStore.getState();
    const id = s.addAnnotation(1_000_000_000n, 'Old');
    s.addAnnotation(2_000_000_000n, 'Untouched');
    useAnnotationStore.getState().updateLabel(id, 'New');
    const { annotations } = useAnnotationStore.getState();
    expect(annotations.find((a) => a.id === id)?.label).toBe('New');
    expect(annotations.find((a) => a.label === 'Untouched')).toBeTruthy();
  });

  it('clearAll empties the list', () => {
    const s = useAnnotationStore.getState();
    s.addAnnotation(1_000_000_000n, 'A');
    s.addAnnotation(2_000_000_000n, 'B');
    useAnnotationStore.getState().clearAll();
    expect(useAnnotationStore.getState().annotations).toHaveLength(0);
  });

  it('loadForBag restores from localStorage when no fromHash given', () => {
    const bagKey = 'test.mcap:1234';
    // Pre-seed storage
    fakeLocalStorage.setItem(
      `bagel:annotations:v1:${bagKey}`,
      JSON.stringify([
        { id: 'x1', timeNs: '3000000000', label: 'Stored' },
      ]),
    );
    useAnnotationStore.getState().loadForBag(bagKey);
    const { annotations, currentBagKey } = useAnnotationStore.getState();
    expect(annotations).toHaveLength(1);
    expect(annotations[0].label).toBe('Stored');
    expect(annotations[0].timeNs).toBe(3_000_000_000n);
    expect(currentBagKey).toBe(bagKey);
  });

  it('loadForBag uses fromHash annotations instead of localStorage', () => {
    const bagKey = 'test.mcap:1234';
    fakeLocalStorage.setItem(
      `bagel:annotations:v1:${bagKey}`,
      JSON.stringify([{ id: 'x1', timeNs: '1000000000', label: 'StoredLabel' }]),
    );
    useAnnotationStore.getState().loadForBag(bagKey, [
      { id: 'h1', timeNs: 7_000_000_000n, label: 'FromHash' },
    ]);
    const { annotations } = useAnnotationStore.getState();
    expect(annotations).toHaveLength(1);
    expect(annotations[0].label).toBe('FromHash');
  });

  it('addAnnotation persists to localStorage', () => {
    const bagKey = 'mybag.mcap:999';
    useAnnotationStore.getState().loadForBag(bagKey);
    useAnnotationStore.getState().addAnnotation(4_000_000_000n, 'Persisted');
    const raw = fakeLocalStorage.getItem(`bagel:annotations:v1:${bagKey}`);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as { label: string }[];
    expect(parsed[0].label).toBe('Persisted');
  });

  it('clearAll persists empty list to localStorage', () => {
    const bagKey = 'mybag.mcap:999';
    useAnnotationStore.getState().loadForBag(bagKey);
    useAnnotationStore.getState().addAnnotation(1_000_000_000n, 'Temp');
    useAnnotationStore.getState().clearAll();
    const raw = fakeLocalStorage.getItem(`bagel:annotations:v1:${bagKey}`);
    expect(JSON.parse(raw!)).toHaveLength(0);
  });

  it('loadForBag handles corrupted localStorage gracefully', () => {
    const bagKey = 'bad.mcap:0';
    fakeLocalStorage.setItem(`bagel:annotations:v1:${bagKey}`, 'not valid json {{{');
    expect(() => useAnnotationStore.getState().loadForBag(bagKey)).not.toThrow();
    expect(useAnnotationStore.getState().annotations).toHaveLength(0);
  });

  it('loadForBag skips entries with non-parseable timeNs', () => {
    const bagKey = 'partial.mcap:0';
    fakeLocalStorage.setItem(
      `bagel:annotations:v1:${bagKey}`,
      JSON.stringify([
        { id: 'ok', timeNs: '1000000000', label: 'Good' },
        { id: 'bad', timeNs: 'not-a-number', label: 'Bad' },
      ]),
    );
    useAnnotationStore.getState().loadForBag(bagKey);
    expect(useAnnotationStore.getState().annotations).toHaveLength(1);
    expect(useAnnotationStore.getState().annotations[0].label).toBe('Good');
  });
});
