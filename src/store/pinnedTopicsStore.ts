/**
 * Pinned topics for the timeline's per-topic density lanes (v1.7).
 *
 * Keyed by bagId so pins from one bag don't leak into another (multi-bag
 * setups keep each bag's pins independent, matching how per-panel display
 * settings are scoped elsewhere in the app).
 *
 * Capped at MAX_PINS - the lanes drawer exists to spot a specific handful
 * of topics at a glance, not to re-implement the full topic list as rows.
 */
import { create } from 'zustand';

export const MAX_PINNED_TOPICS = 8;

interface PinnedTopicsState {
  pinnedByBag: Record<string, string[]>;
  isPinned: (bagId: string, topicName: string) => boolean;
  /** No-ops past MAX_PINNED_TOPICS rather than erroring - the toggle button
   * just stays inert once the cap is hit. */
  togglePin: (bagId: string, topicName: string) => void;
  clearForBag: (bagId: string) => void;
}

export const usePinnedTopicsStore = create<PinnedTopicsState>((set, get) => ({
  pinnedByBag: {},

  isPinned: (bagId, topicName) => (get().pinnedByBag[bagId] ?? []).includes(topicName),

  togglePin: (bagId, topicName) => {
    set((state) => {
      const current = state.pinnedByBag[bagId] ?? [];
      const isPinned = current.includes(topicName);
      if (isPinned) {
        return {
          pinnedByBag: { ...state.pinnedByBag, [bagId]: current.filter((t) => t !== topicName) },
        };
      }
      if (current.length >= MAX_PINNED_TOPICS) return state;
      return { pinnedByBag: { ...state.pinnedByBag, [bagId]: [...current, topicName] } };
    });
  },

  clearForBag: (bagId) => {
    set((state) => {
      if (!(bagId in state.pinnedByBag)) return state;
      const next = { ...state.pinnedByBag };
      delete next[bagId];
      return { pinnedByBag: next };
    });
  },
}));
