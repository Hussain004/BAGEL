import { create } from 'zustand';
import type { AutoMark } from '../utils/anomalies';

export interface Annotation {
  id: string;
  /** Aligned playhead time (ns). Aligned means same coordinate space as playheadStore.timeNs. For a range, where it starts. */
  timeNs: bigint;
  label: string;
  /** Aligned end of a labelled range (ns, after `timeNs`). Absent for a plain bookmark. */
  endNs?: bigint;
  /** Free text kept with the label. Stored locally and exported, never put in a shared link. */
  note?: string;
}

export const isRange = (a: Annotation): a is Annotation & { endNs: bigint } => a.endNs !== undefined && a.endNs > a.timeNs;

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
        (a): a is { id: string; timeNs: string; label: string; endNs?: unknown; note?: unknown } =>
          typeof a === 'object' &&
          a !== null &&
          typeof (a as Record<string, unknown>).id === 'string' &&
          typeof (a as Record<string, unknown>).timeNs === 'string' &&
          typeof (a as Record<string, unknown>).label === 'string',
      )
      .map(({ id, timeNs, label, endNs, note }) => {
        try {
          const out: Annotation = { id, timeNs: BigInt(timeNs), label: label || 'Mark' };
          // Stored entries from before ranges existed have neither field; a bad end is dropped, not the label.
          if (typeof endNs === 'string') {
            try {
              const end = BigInt(endNs);
              if (end > out.timeNs) out.endNs = end;
            } catch {
              // keep it as a point
            }
          }
          if (typeof note === 'string' && note) out.note = note;
          return out;
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
        annotations.map(({ id, timeNs, label, endNs, note }) => ({
          id,
          timeNs: timeNs.toString(),
          label,
          ...(endNs !== undefined ? { endNs: endNs.toString() } : {}),
          ...(note ? { note } : {}),
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
  /**
   * Derived "something happened here" marks (Health gaps, out-of-order
   * stamps), keyed by bag id. Deliberately never persisted and never written
   * to the URL hash, so a shared link does not fill with noise. Pinning one
   * (see Timeline) copies it into `annotations`, which does persist.
   */
  autoMarks: Record<string, AutoMark[]>;
  /** Where a keyboard-made range began (`[`), until `]` closes it. Not persisted. */
  pendingRangeStartNs: bigint | null;
  setPendingRangeStart: (timeNs: bigint | null) => void;
  setAutoMarks: (bagId: string, marks: AutoMark[]) => void;
  clearAutoMarks: (bagId?: string) => void;

  /** Add an annotation at aligned timeNs. Returns the new id for callers that want to enter edit mode. */
  addAnnotation: (timeNs: bigint, label: string) => string;
  /** Add a labelled range. The ends may come in either order; a zero-length range becomes a plain bookmark. */
  addRange: (aNs: bigint, bNs: bigint, label: string) => string;
  /** Change a label's text, note or ends. A range cannot be made to end before it starts. */
  updateAnnotation: (id: string, patch: { label?: string; note?: string; timeNs?: bigint; endNs?: bigint | null }) => void;
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
  autoMarks: {},
  pendingRangeStartNs: null,
  setPendingRangeStart: (timeNs) => set({ pendingRangeStartNs: timeNs }),

  setAutoMarks: (bagId, marks) => {
    set((state) => ({ autoMarks: { ...state.autoMarks, [bagId]: marks } }));
  },

  clearAutoMarks: (bagId) => {
    if (bagId === undefined) {
      set({ autoMarks: {} });
      return;
    }
    set((state) => {
      if (!(bagId in state.autoMarks)) return state;
      const { [bagId]: _removed, ...rest } = state.autoMarks;
      void _removed;
      return { autoMarks: rest };
    });
  },

  addAnnotation: (timeNs, label) => {
    const id = nextId();
    const next = sorted([...get().annotations, { id, timeNs, label }]);
    set({ annotations: next });
    const key = get().currentBagKey;
    if (key) writeStorage(key, next);
    return id;
  },

  addRange: (aNs, bNs, label) => {
    const [startNs, endNs] = aNs <= bNs ? [aNs, bNs] : [bNs, aNs];
    const id = nextId();
    const entry: Annotation = endNs > startNs ? { id, timeNs: startNs, label, endNs } : { id, timeNs: startNs, label };
    const next = sorted([...get().annotations, entry]);
    set({ annotations: next });
    const key = get().currentBagKey;
    if (key) writeStorage(key, next);
    return id;
  },

  updateAnnotation: (id, patch) => {
    const next = get().annotations.map((a) => {
      if (a.id !== id) return a;
      const merged: Annotation = { ...a };
      if (patch.label !== undefined) merged.label = patch.label;
      if (patch.note !== undefined) {
        if (patch.note) merged.note = patch.note;
        else delete merged.note;
      }
      if (patch.timeNs !== undefined) merged.timeNs = patch.timeNs;
      if (patch.endNs === null) delete merged.endNs;
      else if (patch.endNs !== undefined) merged.endNs = patch.endNs;
      // A range that no longer ends after it starts is a plain bookmark.
      if (merged.endNs !== undefined && merged.endNs <= merged.timeNs) delete merged.endNs;
      return merged;
    });
    const sortedNext = sorted(next);
    set({ annotations: sortedNext });
    const key = get().currentBagKey;
    if (key) writeStorage(key, sortedNext);
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
      state.annotations.map((a) => ({
        ...a,
        timeNs: a.timeNs + deltaNs,
        ...(a.endNs !== undefined ? { endNs: a.endNs + deltaNs } : {}),
      })),
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
