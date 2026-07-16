/**
 * Global drag-to-dock state.
 *
 * Lives outside React so the drag source (`PanelShell`'s header) and the
 * drop targets (every `<DropZoneOverlay>` in `PanelGrid`) can communicate
 * without prop-drilling through the tree. The store holds at most one
 * active drag at a time — multi-touch / second-pointer drags are ignored.
 *
 * The store is intentionally tiny: just the source panel id during a drag,
 * plus start/end actions. Hit-testing lives in the overlay components so we
 * can take advantage of the browser's natural pointer hit-testing instead
 * of re-implementing it against component bounds.
 */

import { create } from 'zustand';

interface DragDockState {
  /** Id of the panel being dragged, or null when no drag is active. */
  sourceId: string | null;
  /**
   * True once a drag has completed (dragged and released) this session.
   * Panels dim during the *first* drag only - a one-time visual cue that
   * "these are drop targets", not a persistent effect that would get in
   * the way of a power user repeatedly rearranging panels.
   */
  hasDraggedOnce: boolean;
  startDrag: (sourceId: string) => void;
  endDrag: () => void;
}

export const useDragDockStore = create<DragDockState>((set) => ({
  sourceId: null,
  hasDraggedOnce: false,
  startDrag: (sourceId) => set({ sourceId }),
  endDrag: () => set({ sourceId: null, hasDraggedOnce: true }),
}));
