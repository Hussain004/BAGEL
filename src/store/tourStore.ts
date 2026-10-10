/**
 * The running guided tour: which tour, which step, and what went wrong if it
 * could not start. The tour file itself is validated in `utils/tour.ts`;
 * applying a step to the app is `utils/tourRunner.ts`.
 */

import { create } from 'zustand';
import type { Tour } from '../utils/tour';

interface TourState {
  tour: Tour | null;
  index: number;
  /** A tour was asked for but its bag is still loading. */
  loading: boolean;
  error: string | null;
  start: (tour: Tour) => void;
  setLoading: (loading: boolean) => void;
  fail: (error: string) => void;
  goTo: (index: number) => void;
  close: () => void;
}

export const useTourStore = create<TourState>((set, get) => ({
  tour: null,
  index: 0,
  loading: false,
  error: null,
  start: (tour) => set({ tour, index: 0, loading: false, error: null }),
  setLoading: (loading) => set({ loading }),
  fail: (error) => set({ tour: null, loading: false, error }),
  goTo: (index) => {
    const tour = get().tour;
    if (!tour) return;
    set({ index: Math.max(0, Math.min(tour.steps.length - 1, index)) });
  },
  close: () => set({ tour: null, index: 0, loading: false, error: null }),
}));
