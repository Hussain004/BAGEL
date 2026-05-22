/**
 * Zustand Store for BAGEL bag file state management.
 *
 * Manages the loaded bag file state, loading progress, and error handling.
 * This is the single source of truth for all bag-related state in the app.
 */

import { create } from 'zustand';
import type { BagSummary } from '../types/bag';
import { parseBag } from '../parsers';

interface BagState {
  /** Currently loaded bag summary */
  bag: BagSummary | null;
  /** Whether a bag file is currently being parsed */
  isLoading: boolean;
  /** Error message if parsing failed */
  error: string | null;
  /** Loading progress (0-100) — approximate */
  loadProgress: number;

  /** Load and parse a bag file */
  loadBag: (file: File) => Promise<void>;
  /** Clear the loaded bag and reset state */
  clearBag: () => void;
  /** Clear any error state */
  clearError: () => void;
}

export const useBagStore = create<BagState>((set) => ({
  bag: null,
  isLoading: false,
  error: null,
  loadProgress: 0,

  loadBag: async (file: File) => {
    set({ isLoading: true, error: null, loadProgress: 10, bag: null });

    try {
      // Reading file
      set({ loadProgress: 30 });

      // Parse the bag file (format auto-detected)
      const summary = await parseBag(file);

      set({ loadProgress: 90 });

      // Done!
      set({
        bag: summary,
        isLoading: false,
        loadProgress: 100,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'An unknown error occurred while parsing the bag file.';
      console.error('Failed to load bag file:', err);
      set({
        isLoading: false,
        error: message,
        loadProgress: 0,
        bag: null,
      });
    }
  },

  clearBag: () => {
    set({
      bag: null,
      isLoading: false,
      error: null,
      loadProgress: 0,
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
