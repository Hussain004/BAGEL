/**
 * Zustand Store for BAGEL bag file state management.
 *
 * Tracks the loaded bag summary, the source File (kept so panels can re-read
 * messages on demand), loading progress, and error state.
 */

import { create } from 'zustand';
import type { BagSummary } from '../types/bag';
import { parseBag, disposeParserCaches } from '../parsers';

interface BagState {
  bag: BagSummary | null;
  /**
   * Source File handle for the currently loaded bag. Panels use this to
   * read individual messages on demand, since we don't load every message
   * into memory at parse time.
   */
  file: File | null;
  isLoading: boolean;
  error: string | null;
  loadProgress: number;

  loadBag: (file: File) => Promise<void>;
  clearBag: () => void;
  clearError: () => void;
}

export const useBagStore = create<BagState>((set) => ({
  bag: null,
  file: null,
  isLoading: false,
  error: null,
  loadProgress: 0,

  loadBag: async (file: File) => {
    set({ isLoading: true, error: null, loadProgress: 10, bag: null, file: null });

    try {
      set({ loadProgress: 30 });
      const summary = await parseBag(file);
      set({ loadProgress: 90 });
      set({
        bag: summary,
        file,
        isLoading: false,
        loadProgress: 100,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'An unknown error occurred while parsing the bag file.';
      console.error('Failed to load bag file:', err);
      set({
        isLoading: false,
        error: message,
        loadProgress: 0,
        bag: null,
        file: null,
      });
    }
  },

  clearBag: () => {
    disposeParserCaches();
    set({
      bag: null,
      file: null,
      isLoading: false,
      error: null,
      loadProgress: 0,
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
