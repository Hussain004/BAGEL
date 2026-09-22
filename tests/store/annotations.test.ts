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
import { useBagStore, alignedTimelineRange, type BagEntry } from '../../src/store/bagStore';

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

  // ── Alignment re-basing (bagStore.setAlignment / setAnchor) ──────────

  const WALL_START = 1_700_000_000_000_000_000n; // epoch-ns style wall-clock
  const DURATION = 10_000_000_000n; // 10 s bag

  function seedBag(alignment: 'wall-clock' | 'anchor', anchorNs?: bigint) {
    const entry: BagEntry = {
      id: 'b1',
      kind: 'file',
      summary: {
        format: 'mcap',
        fileName: 'align.mcap',
        fileSize: 1,
        startTime: WALL_START,
        endTime: WALL_START + DURATION,
        duration: 10,
        totalMessageCount: 1,
        topics: [],
      } as BagEntry['summary'],
      source: null,
      liveConn: null,
      color: '#000000',
      anchorNs,
    };
    useBagStore.setState({
      bags: new Map([[entry.id, entry]]),
      bagOrder: [entry.id],
      focusBagId: entry.id,
      bag: entry.summary,
      alignment,
    });
    return entry;
  }

  function relativePositions(
    alignment: 'wall-clock' | 'bag-start' | 'anchor',
  ): number[] {
    const state = useBagStore.getState();
    const range = alignedTimelineRange(state.bags, state.bagOrder, alignment)!;
    const span = Number(range.endNs - range.startNs);
    return useAnnotationStore
      .getState()
      .annotations.map((a) => Number(a.timeNs - range.startNs) / span);
  }

  it('switching alignment re-baselines bookmarks and preserves relative positions', () => {
    seedBag('wall-clock');
    useAnnotationStore.getState().loadForBag('align.mcap:1');
    useAnnotationStore.getState().addAnnotation(WALL_START + DURATION / 3n, 'One third');
    useAnnotationStore.getState().addAnnotation(
      WALL_START + (DURATION * 2n) / 3n,
      'Two thirds',
    );

    const before = relativePositions('wall-clock');

    useBagStore.getState().setAlignment('bag-start');

    const { annotations } = useAnnotationStore.getState();
    expect(annotations.map((a) => a.label)).toEqual(['One third', 'Two thirds']);
    // Bag-start coordinates: the epoch offset is gone, not doubled.
    expect(annotations[0].timeNs).toBe(DURATION / 3n);
    expect(annotations[1].timeNs).toBe((DURATION * 2n) / 3n);
    expect(relativePositions('bag-start')).toEqual(before);

    // The shift was persisted, not just applied in memory.
    const raw = fakeLocalStorage.getItem('bagel:annotations:v1:align.mcap:1');
    expect(JSON.parse(raw!)[0].timeNs).toBe((DURATION / 3n).toString());

    // Switching back restores the original wall-clock values.
    useBagStore.getState().setAlignment('wall-clock');
    expect(useAnnotationStore.getState().annotations[0].timeNs).toBe(
      WALL_START + DURATION / 3n,
    );
  });

  it('moving the anchor under anchor alignment preserves relative positions', () => {
    seedBag('anchor'); // no anchor set yet: offset falls back to bag start
    useAnnotationStore.getState().loadForBag('align.mcap:1');
    // Stored aligned ns under the bag-start fallback: local start + 3 s.
    useAnnotationStore.getState().addAnnotation(3_000_000_000n, 'At 3s');

    const before = relativePositions('anchor');

    // Anchor at local start + 2 s: the same data point is now 1 s past it.
    useBagStore.getState().setAnchor('b1', WALL_START + 2_000_000_000n);

    expect(useAnnotationStore.getState().annotations[0].timeNs).toBe(1_000_000_000n);
    expect(relativePositions('anchor')).toEqual(before);
  });
});
