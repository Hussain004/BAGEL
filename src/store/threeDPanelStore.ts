/**
 * Per-panel display settings for the ThreeDScene panel.
 *
 * Why a store and not `useState` inside the panel
 * -----------------------------------------------
 * `PanelGrid` puts a `key` on the resizable `<Group>` that includes every
 * open panel id, so adding or closing any sibling panel changes the key and
 * forces React to unmount + remount the entire tree underneath. That throws
 * away any `useState` held by the panels — and the 3D panel has a *lot*
 * (point size, color mode, range filter, accumulator, up-axis, world frame,
 * pivot, grid + axes toggles, …) that the user is expected to set once and
 * keep using as they open more panels alongside.
 *
 * Lifting the state into a zustand store keyed by `panelId` (`3d:topicName`)
 * solves it categorically: a remount re-reads from the store on first paint
 * and the user's choices stick. As a bonus, closing and re-opening the same
 * 3D panel also restores its settings — same id, same row in the store.
 *
 * We don't clean the store on panel close. The keying makes the working set
 * bounded by panel count (and panel count is bounded by the user's
 * patience), so a small map is fine.
 */

import { create } from 'zustand';
import type { ColorMode } from '../utils/pointcloud';
import type { AccumulationMode } from '../components/panels/ThreeDScene/accumulator';

export type UpAxis = 'z+' | 'z-' | 'y+' | 'y-' | 'x+' | 'x-';

export interface ThreeDPanelSettings {
  colorMode: ColorMode;
  pointSize: number;
  showGrid: boolean;
  showWorldAxes: boolean;
  /** `null` means "auto-pick once the TF graph + first message arrive". */
  worldFrame: string | null;
  rangeLimitOn: boolean;
  maxRange: number;
  accumulating: boolean;
  accumMode: AccumulationMode;
  accumBudget: number;
  accumPerFrame: number;
  voxelSize: number;
  upAxis: UpAxis;
  /** Custom orbit pivot in render-space coordinates, or `null` for auto-fit centre. */
  pivot: { x: number; y: number; z: number } | null;
  /**
   * Namespaces the user has hidden in the MarkerArray filter card. Stored as
   * a sorted array (not a Set) so the persisted state round-trips through
   * zustand's structural-equality bailout without mutating in place.
   *
   * Only meaningful for marker-typed 3D panels; cloud/pose panels ignore
   * this field.
   */
  hiddenMarkerNamespaces: string[];
  /**
   * Global alpha multiplier for `nav_msgs/OccupancyGrid` panels (0…1). Sits
   * on top of the per-cell alpha ramp in the colour map so the user can
   * fade the whole plane in or out without losing the unknown/free/occupied
   * gradient. Only meaningful for occupancygrid panels.
   */
  mapAlpha: number;
}

/**
 * Module-level constant so `useThreeDPanelStore(s => s.byId[id] ?? DEFAULTS)`
 * returns a stable reference on the first read — otherwise React would see
 * a new object on every render and tear the panel re-render loop apart.
 */
export const DEFAULT_THREE_D_SETTINGS: ThreeDPanelSettings = {
  colorMode: 'height',
  pointSize: 2.5,
  showGrid: true,
  showWorldAxes: true,
  worldFrame: null,
  rangeLimitOn: false,
  maxRange: 30,
  accumulating: false,
  accumMode: 'ring',
  accumBudget: 1_000_000,
  accumPerFrame: 25_000,
  voxelSize: 0.2,
  upAxis: 'z+',
  pivot: null,
  hiddenMarkerNamespaces: [],
  mapAlpha: 0.85,
};

interface ThreeDPanelState {
  byId: Record<string, ThreeDPanelSettings>;
  /** Patch a single panel's settings. Initialises from defaults on first write. */
  update: (panelId: string, partial: Partial<ThreeDPanelSettings>) => void;
}

export const useThreeDPanelStore = create<ThreeDPanelState>((set) => ({
  byId: {},
  update: (panelId, partial) => {
    set((state) => {
      const current = state.byId[panelId] ?? DEFAULT_THREE_D_SETTINGS;
      return {
        byId: {
          ...state.byId,
          [panelId]: { ...current, ...partial },
        },
      };
    });
  },
}));
