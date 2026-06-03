/**
 * Robot-model store - v1.3.0
 *
 * Holds the currently-loaded URDF model so every open `ThreeDScene` panel
 * can render it without re-parsing. Multi-bag flows share a single robot
 * model (one URDF describes one robot; loading a second URDF replaces the
 * first). The store also carries per-panel visibility toggles and the link
 * the robot's base should be anchored to in TF (defaults to the URDF's
 * root link name).
 *
 * The actual `THREE.Object3D` subtree is NOT kept here - building one
 * involves async mesh loads and is best owned by the panel that displays
 * it. The store carries the parsed `UrdfModel` only.
 */

import { create } from 'zustand';
import type { UrdfModel, UrdfWarning } from '../parsers/urdf';

export interface LoadedRobotModel {
  model: UrdfModel;
  /** Display name shown in the toolbar / modal. */
  sourceName: string;
  /** Original URDF text - used for re-render after rebind. */
  sourceText: string;
  /**
   * Which link (by URDF name) the robot is anchored to inside the bag's TF
   * tree. Defaults to the first root link; users can override if their bag
   * uses a different convention (e.g. `base_footprint` vs `base_link`).
   */
  anchorLink: string;
  /** Warnings surfaced by the URDF parser - shown in the modal post-load. */
  warnings: UrdfWarning[];
}

interface RobotModelState {
  loaded: LoadedRobotModel | null;
  /** Per-panel hide flags (panelId → hidden). Panels default to visible. */
  hiddenInPanel: Record<string, boolean>;
  setLoaded: (loaded: LoadedRobotModel) => void;
  clearLoaded: () => void;
  setAnchorLink: (link: string) => void;
  setHiddenInPanel: (panelId: string, hidden: boolean) => void;
  isHiddenInPanel: (panelId: string) => boolean;
}

export const useRobotModelStore = create<RobotModelState>((set, get) => ({
  loaded: null,
  hiddenInPanel: {},
  setLoaded: (loaded) => set({ loaded }),
  clearLoaded: () => set({ loaded: null, hiddenInPanel: {} }),
  setAnchorLink: (link) => {
    const cur = get().loaded;
    if (!cur) return;
    set({ loaded: { ...cur, anchorLink: link } });
  },
  setHiddenInPanel: (panelId, hidden) => {
    set((s) => {
      const next = { ...s.hiddenInPanel };
      if (hidden) next[panelId] = true;
      else delete next[panelId];
      return { hiddenInPanel: next };
    });
  },
  isHiddenInPanel: (panelId) => !!get().hiddenInPanel[panelId],
}));
