import { create } from 'zustand';

export interface Annotation {
  id: string;
  /** Aligned playhead time (ns). Aligned means same coordinate space as playheadStore.timeNs. */
  timeNs: bigint;
  label: string;
}

const STORAGE_PREFIX = 'bagel:annotations:v1:';

function nextId(): string {
  return `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function readStorage(bagKey: string): Annotation[] {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_PREFIX + bagKey);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown[];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (a): a is { id: string; timeNs: string; label: string } =>
          typeof a === 'object' &&
          a !== null &&
          typeof (a as Record<string, unknown>).id === 'string' &&
          typeof (a as Record<string, unknown>).timeNs === 'string' &&
          typeof (a as Record<string, unknown>).label === 'string',
      )
      .map(({ id, timeNs, label }) => {
        try {
          return { id, timeNs: BigInt(timeNs), label: label || 'Mark' };
        } catch {
          return null;
        }
      })
      .filter((a): a is Annotation => a !== null);
  } catch {
    return [];
  }
}

function writeStorage(bagKey: string, annotations: Annotation[]): void {
  try {
    globalThis.localStorage?.setItem(
      STORAGE_PREFIX + bagKey,
      JSON.stringify(
        annotations.map(({ id, timeNs, label }) => ({
          id,
          timeNs: timeNs.toString(),
          label,
        })),
      ),
    );
  } catch {
    // localStorage may be full or unavailable
  }
}

function sorted(arr: Annotation[]): Annotation[] {
  return [...arr].sort((a, b) => (a.timeNs < b.timeNs ? -1 : a.timeNs > b.timeNs ? 1 : 0));
}

interface AnnotationState {
  annotations: Annotation[];
  currentBagKey: string | null;

  /** Add an annotation at aligned timeNs. Returns the new id for callers that want to enter edit mode. */
  addAnnotation: (timeNs: bigint, label: string) => string;
  removeAnnotation: (id: string) => void;
  updateLabel: (id: string, label: string) => void;
  /**
   * Shift every annotation by `deltaNs` and persist. Annotations store
   * absolute aligned nanoseconds, so when bagStore changes the offset
   * added to bag-local time (alignment mode or anchor switch) each stored
   * coordinate must move by the same delta or bookmarks snap to the
   * 0% / 100% edges of the re-based range.
   */
  shiftAllBy: (deltaNs: bigint) => void;
  clearAll: () => void;

  /**
   * Load annotations for a bag. If fromHash is provided it takes priority
   * over localStorage (allows sharing a bookmarked session via URL).
   * Always replaces the in-memory set.
   */
  loadForBag: (bagKey: string, fromHash?: Annotation[]) => void;
}

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  annotations: [],
  currentBagKey: null,

  addAnnotation: (timeNs, label) => {
    const id = nextId();
    const next = sorted([...get().annotations, { id, timeNs, label }]);
    set({ annotations: next });
    const key = get().currentBagKey;
    if (key) writeStorage(key, next);
    return id;
  },

  removeAnnotation: (id) => {
    const next = get().annotations.filter((a) => a.id !== id);
    set({ annotations: next });
    const key = get().currentBagKey;
    if (key) writeStorage(key, next);
  },

  updateLabel: (id, label) => {
    const next = get().annotations.map((a) => (a.id === id ? { ...a, label } : a));
    set({ annotations: next });
    const key = get().currentBagKey;
    if (key) writeStorage(key, next);
  },

  clearAll: () => {
    set({ annotations: [] });
    const key = get().currentBagKey;
    if (key) writeStorage(key, []);
  },

  shiftAllBy: (deltaNs) => {
    const state = get();
    if (deltaNs === 0n || state.annotations.length === 0) return;
    const next = sorted(
      state.annotations.map((a) => ({ ...a, timeNs: a.timeNs + deltaNs })),
    );
    set({ annotations: next });
    const key = state.currentBagKey;
    if (key) writeStorage(key, next);
  },

  loadForBag: (bagKey, fromHash) => {
    const loaded = fromHash ?? readStorage(bagKey);
    set({ annotations: loaded, currentBagKey: bagKey });
  },
}));
