import { create } from 'zustand';
import { FULL_VIEW, type TimelineView } from '../utils/timelineView';

/** The timeline's zoom window. Not persisted: a new bag starts fully zoomed out. */
interface TimelineViewState {
  view: TimelineView;
  setView: (view: TimelineView) => void;
  reset: () => void;
}

export const useTimelineViewStore = create<TimelineViewState>((set) => ({
  view: FULL_VIEW,
  setView: (view) => set({ view }),
  reset: () => set({ view: FULL_VIEW }),
}));
