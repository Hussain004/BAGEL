/**
 * UI state - modal overlays, toasts, and other view-layer flags that don't
 * belong with bag/playhead/layout data.
 *
 * Kept deliberately small. If this grows past a handful of concerns it should
 * be split apart.
 */

import { create } from 'zustand';
import type { PanelKind } from './layoutStore';

const HINT_DISMISSED_KEY = 'bagel:onboarding-hint-dismissed:v1';
const TOPIC_VIEW_MODE_KEY = 'bagel:topic-view-mode:v1';
const EXPANDED_TREE_NODES_KEY = 'bagel:expanded-tree-nodes:v1';

function readHintDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(HINT_DISMISSED_KEY) === '1';
  } catch {
    // localStorage access can throw in sandboxed iframes; treat as unseen.
    return false;
  }
}

function readTopicViewMode(): 'flat' | 'tree' {
  if (typeof window === 'undefined') return 'flat';
  try {
    return window.localStorage.getItem(TOPIC_VIEW_MODE_KEY) === 'tree' ? 'tree' : 'flat';
  } catch {
    return 'flat';
  }
}

function readExpandedTreeNodes(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(EXPANDED_TREE_NODES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeExpandedTreeNodes(nodes: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(EXPANDED_TREE_NODES_KEY, JSON.stringify([...nodes]));
  } catch {
    // Best-effort persistence.
  }
}

export type ModalKind =
  | 'about'
  | 'shortcuts'
  | 'bag-edit'
  | 'urdf-load'
  | 'clip-export'
  | 'share'
  | 'command-palette'
  | 'labels'
  | 'frame-export'
  | null;

/**
 * Per-target state for the schema-paste modal. We keep this separate from
 * `ModalKind` because the modal is parameterised - clicking different
 * unknown topics needs to populate different context (which type to add a
 * schema for, which panel to open afterwards). A flat enum can't carry that.
 */
export interface SchemaPasteTarget {
  /** Fully qualified ROS2 type name (e.g. `px4_msgs/msg/VehicleLocalPosition`). */
  typeName: string;
  /** Topic that triggered the paste - used in the subtitle for context. */
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
  /** The labelled range the frame-export dialog opens on, or null for the whole bag. */
  frameExportLabelId: string | null;
  /** The floating control card for a live connection. */
  controlOpen: boolean;
  setControlOpen: (open: boolean) => void;
  openFrameExport: (labelId?: string) => void;
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

  /**
   * Sidebar topic list view: the v0.9 flat list, or the v1.8 namespace tree.
   * Persisted so a power user who keeps the tree open gets it back on every
   * bag, not just the current one.
   */
  topicViewMode: 'flat' | 'tree';
  setTopicViewMode: (mode: 'flat' | 'tree') => void;
  /**
   * Expanded namespace groups in tree view, keyed by group path
   * (`/robot1/sensors/lidar`). Anything absent is collapsed, which keeps a
   * fresh bag small instead of opening 400 rows at once.
   */
  expandedTreeNodes: ReadonlySet<string>;
  toggleTreeNode: (path: string) => void;
  /**
   * The active type-chip filter, or null for "all topics". A topic only
   * renders when it matches, or when no filter is set.
   */
  topicTypeFilter: string | null;
  setTopicTypeFilter: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  modal: null,
  setModal: (modal) => set({ modal }),
  schemaPaste: null,
  frameExportLabelId: null,
  controlOpen: false,
  setControlOpen: (controlOpen) => set({ controlOpen }),
  openFrameExport: (labelId) => set({ frameExportLabelId: labelId ?? null, modal: 'frame-export' }),
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

  topicViewMode: readTopicViewMode(),
  setTopicViewMode: (topicViewMode) => {
    try {
      window.localStorage.setItem(TOPIC_VIEW_MODE_KEY, topicViewMode);
    } catch {
      // Best-effort persistence.
    }
    set({ topicViewMode });
  },

  expandedTreeNodes: readExpandedTreeNodes(),
  toggleTreeNode: (path) =>
    set((state) => {
      const next = new Set(state.expandedTreeNodes);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      writeExpandedTreeNodes(next);
      return { expandedTreeNodes: next };
    }),

  topicTypeFilter: null,
  setTopicTypeFilter: (topicTypeFilter) => set({ topicTypeFilter }),
}));
