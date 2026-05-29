/**
 * Per-panel UI state for the 2D visualisation panels.
 *
 * Same pattern as `threeDPanelStore.ts`: each store keeps a `byId` record
 * keyed by `${kind}:${topicName}` (the same id `layoutStore` already uses
 * for `PanelLeaf`). State is read fresh on every paint, so when v0.7's
 * drag-to-dock forces a `react-resizable-panels` remount of the affected
 * subtree the panel rehydrates from the store and the user's choices stick.
 *
 * The 3D panel got its own dedicated store first because it carries the
 * most settings. This file does the same trick for the smaller panels —
 * uPlot zoom / series toggles on `TimeSeriesPlot`, pan+zoom on
 * `TrajectoryPlot`, selected frame on `TFTree`. Search filters and tree-
 * node expansion are intentionally left as `useState` because their cost
 * to re-derive is essentially zero, and persisting per-row state for the
 * raw-message inspector would mean serialising every JSON path.
 *
 * No cleanup on panel close — same logic as the 3D store: working set is
 * bounded by panel count, which is bounded by user patience, so a small
 * map is fine and re-opening the same panel id picks up where it left off.
 */

import { create } from 'zustand';

// ── TimeSeriesPlot ─────────────────────────────────────────────────────

export interface TimeSeriesPanelSettings {
  /** Map of `field.path` → visibility. Missing entries default to visible. */
  visibility: Record<string, boolean>;
  /**
   * Current x-axis range in seconds-from-first-message, or null when the
   * user hasn't zoomed and we want uPlot's auto-fit to apply. Captured via
   * uPlot's `hooks.setScale` and applied on mount, so the chart re-mounts
   * after a dock with the same horizontal viewport the user was looking at.
   */
  xRange: { min: number; max: number } | null;
}

export const DEFAULT_TIMESERIES_SETTINGS: TimeSeriesPanelSettings = {
  visibility: {},
  xRange: null,
};

interface TimeSeriesPanelState {
  byId: Record<string, TimeSeriesPanelSettings>;
  update: (panelId: string, partial: Partial<TimeSeriesPanelSettings>) => void;
}

export const useTimeSeriesPanelStore = create<TimeSeriesPanelState>((set) => ({
  byId: {},
  update: (panelId, partial) => {
    set((state) => {
      const current = state.byId[panelId] ?? DEFAULT_TIMESERIES_SETTINGS;
      return {
        byId: {
          ...state.byId,
          [panelId]: { ...current, ...partial },
        },
      };
    });
  },
}));

// ── TrajectoryPlot ─────────────────────────────────────────────────────

export interface TrajectoryView {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface TrajectoryPanelSettings {
  /**
   * Current pan/zoom view, or null when the panel should auto-fit to the
   * data bounds. `null` triggers the recompute-on-data-bounds path in the
   * component, so the reset button writes `null` here instead of
   * recomputing immediately — the data effect handles it.
   */
  view: TrajectoryView | null;
}

export const DEFAULT_TRAJECTORY_SETTINGS: TrajectoryPanelSettings = {
  view: null,
};

interface TrajectoryPanelState {
  byId: Record<string, TrajectoryPanelSettings>;
  update: (panelId: string, partial: Partial<TrajectoryPanelSettings>) => void;
}

export const useTrajectoryPanelStore = create<TrajectoryPanelState>((set) => ({
  byId: {},
  update: (panelId, partial) => {
    set((state) => {
      const current = state.byId[panelId] ?? DEFAULT_TRAJECTORY_SETTINGS;
      return {
        byId: {
          ...state.byId,
          [panelId]: { ...current, ...partial },
        },
      };
    });
  },
}));

// ── TFTree ─────────────────────────────────────────────────────────────

export interface TFTreePanelSettings {
  /** Currently selected frame id, or null when no frame is highlighted. */
  selected: string | null;
}

export const DEFAULT_TFTREE_SETTINGS: TFTreePanelSettings = {
  selected: null,
};

interface TFTreePanelState {
  byId: Record<string, TFTreePanelSettings>;
  update: (panelId: string, partial: Partial<TFTreePanelSettings>) => void;
}

export const useTFTreePanelStore = create<TFTreePanelState>((set) => ({
  byId: {},
  update: (panelId, partial) => {
    set((state) => {
      const current = state.byId[panelId] ?? DEFAULT_TFTREE_SETTINGS;
      return {
        byId: {
          ...state.byId,
          [panelId]: { ...current, ...partial },
        },
      };
    });
  },
}));
