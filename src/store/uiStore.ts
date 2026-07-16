/**
 * UI state — modal overlays, toasts, and other view-layer flags that don't
 * belong with bag/playhead/layout data.
 *
 * Kept deliberately small. If this grows past a handful of concerns it should
 * be split apart.
 */

import { create } from 'zustand';
import type { PanelKind } from './layoutStore';

const HINT_DISMISSED_KEY = 'bagel:onboarding-hint-dismissed:v1';
function readHintDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(HINT_DISMISSED_KEY) === '1';
  } catch {
    // localStorage access can throw in sandboxed iframes; treat as unseen.
    return false;
  }
}

export type ModalKind = 'about' | 'shortcuts' | 'bag-edit' | 'urdf-load' | 'clip-export' | null;

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
  /**
   * One-time "click a topic to open more panels, drag a header to
   * rearrange" hint shown over the sidebar after the sample bag lands on
   * its curated layout - the payoff (3D + image + plot moving in sync) is
   * visible immediately, but nothing else tells a first-time visitor the
   * rest of the app is theirs to rearrange. Persisted to localStorage once
   * dismissed so it doesn't reappear on a later "Try a sample bag" click.
   */
  showOnboardingHint: boolean;
  triggerOnboardingHint: () => void;
  dismissOnboardingHint: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  modal: null,
  setModal: (modal) => set({ modal }),
  schemaPaste: null,
  openSchemaPaste: (target) => set({ schemaPaste: target }),
  closeSchemaPaste: () => set({ schemaPaste: null }),
  showOnboardingHint: false,
  triggerOnboardingHint: () => {
    if (readHintDismissed()) return;
    set({ showOnboardingHint: true });
  },
  dismissOnboardingHint: () => {
    try {
      window.localStorage.setItem(HINT_DISMISSED_KEY, '1');
    } catch {
      // Best-effort persistence.
    }
    set({ showOnboardingHint: false });
  },
}));
