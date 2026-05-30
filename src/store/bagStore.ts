/**
 * Zustand Store for BAGEL bag file state management.
 *
 * Tracks the loaded bag summary, the underlying `BagSource` (file handle or
 * URL), loading progress, and error state. The source flows through every
 * parser call so the panels don't need to know whether the bytes live on
 * disk or are fetched on demand via HTTP Range.
 */

import { create } from 'zustand';
import type { BagSummary } from '../types/bag';
import {
  parseBag,
  disposeParserCaches,
  createFileSource,
  createUrlSource,
  type BagSource,
} from '../parsers';

interface BagState {
  bag: BagSummary | null;
  /**
   * Source descriptor for the currently loaded bag. Panels pass this back
   * to the parser worker on every read; for `.bag` / `.mcap` sources only
   * the chunks actually used are fetched (HTTP Range or Blob slice).
   */
  source: BagSource | null;
  isLoading: boolean;
  error: string | null;
  loadProgress: number;

  loadBag: (file: File) => Promise<void>;
  /**
   * Load a bag from a remote URL via HTTP Range. The server must:
   *   - return Content-Length on HEAD (so the parser knows the file size),
   *   - support `Range: bytes=...` requests with HTTP 206 Partial Content,
   *   - allow cross-origin requests from the current page (CORS).
   *
   * .mcap and .bag honour range reads — only the chunks the user scrubs
   * through get fetched. .db3 eager-fetches the whole file because sql.js
   * needs it in memory.
   */
  loadBagFromUrl: (url: string) => Promise<void>;
  clearBag: () => void;
  clearError: () => void;
}

export const useBagStore = create<BagState>((set) => ({
  bag: null,
  source: null,
  isLoading: false,
  error: null,
  loadProgress: 0,

  loadBag: async (file: File) => {
    set({ isLoading: true, error: null, loadProgress: 10, bag: null, source: null });

    try {
      const source = createFileSource(file);
      set({ loadProgress: 30 });
      const summary = await parseBag(source);
      set({ loadProgress: 90 });
      set({
        bag: summary,
        source,
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
        source: null,
      });
    }
  },

  loadBagFromUrl: async (url: string) => {
    set({ isLoading: true, error: null, loadProgress: 5, bag: null, source: null });

    try {
      // HEAD request first — resolves Content-Length and probes Range support.
      // Any specific failure mode (CORS, missing Content-Length, 4xx) bubbles
      // up as the user-facing error.
      set({ loadProgress: 15 });
      const source = await createUrlSource(url);
      set({ loadProgress: 30 });
      const summary = await parseBag(source);
      set({ loadProgress: 90 });
      set({
        bag: summary,
        source,
        isLoading: false,
        loadProgress: 100,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'An unknown error occurred while fetching the bag from the URL.';
      console.error('Failed to load bag from URL:', err);
      set({
        isLoading: false,
        error: message,
        loadProgress: 0,
        bag: null,
        source: null,
      });
    }
  },

  clearBag: () => {
    disposeParserCaches();
    set({
      bag: null,
      source: null,
      isLoading: false,
      error: null,
      loadProgress: 0,
    });
  },

  clearError: () => {
    set({ error: null });
  },
}));
