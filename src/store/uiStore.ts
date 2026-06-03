/**
 * UI state — modal overlays, toasts, and other view-layer flags that don't
 * belong with bag/playhead/layout data.
 *
 * Kept deliberately small. If this grows past a handful of concerns it should
 * be split apart.
 */

import { create } from 'zustand';
import type { PanelKind } from './layoutStore';

export type ModalKind = 'about' | 'shortcuts' | 'bag-edit' | 'urdf-load' | null;

/**
 * Per-target state for the schema-paste modal. We keep this separate from
 * `ModalKind` because the modal is parameterised — clicking different
 * unknown topics needs to populate different context (which type to add a
 * schema for, which panel to open afterwards). A flat enum can't carry that.
 */
export interface SchemaPasteTarget {
  /** Fully qualified ROS2 type name (e.g. `px4_msgs/msg/VehicleLocalPosition`). */
  typeName: string;
  /** Topic that triggered the paste — used in the subtitle for context. */
  topicName?: string;
  /** Panel kind to open after a successful save. Omit for "manage schemas" entry. */
  followupPanelKind?: PanelKind;
  /** Multi-bag: which bag the follow-up panel should bind to. */
  bagId?: string;
}

interface UiState {
  modal: ModalKind;
  setModal: (m: ModalKind) => void;
  /** Active schema-paste modal target, or null when closed. */
  schemaPaste: SchemaPasteTarget | null;
  openSchemaPaste: (target: SchemaPasteTarget) => void;
  closeSchemaPaste: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  modal: null,
  setModal: (modal) => set({ modal }),
  schemaPaste: null,
  openSchemaPaste: (target) => set({ schemaPaste: target }),
  closeSchemaPaste: () => set({ schemaPaste: null }),
}));
