/**
 * UI state — modal overlays, toasts, and other view-layer flags that don't
 * belong with bag/playhead/layout data.
 *
 * Kept deliberately small. If this grows past a handful of concerns it should
 * be split apart.
 */

import { create } from 'zustand';

export type ModalKind = 'about' | 'shortcuts' | null;

interface UiState {
  modal: ModalKind;
  setModal: (m: ModalKind) => void;
}

export const useUiStore = create<UiState>((set) => ({
  modal: null,
  setModal: (modal) => set({ modal }),
}));
