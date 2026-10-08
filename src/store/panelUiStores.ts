/**
 * Per-panel UI state for the 2D visualisation panels.
 *
 * Same pattern as `threeDPanelStore.ts`: each store keeps a `byId` record
 * keyed by the `layoutStore` `PanelLeaf` id - `kind:bagId:topicName` in the
 * multi-bag era (legacy `kind:topicName` ids still resolve). State is read
 * fresh on every paint, so when v0.7's
 * drag-to-dock forces a `react-resizable-panels` remount of the affected
 * subtree the panel rehydrates from the store and the user's choices stick.
 *
 * The 3D panel got its own dedicated store first because it carries the
 * most settings. This file does the same trick for the smaller panels -
 * uPlot zoom / series toggles on `TimeSeriesPlot`, pan+zoom on
 * `TrajectoryPlot`, selected frame on `TFTree`. Search filters and tree-
 * node expansion are intentionally left as `useState` because their cost
 * to re-derive is essentially zero, and persisting per-row state for the
 * raw-message inspector would mean serialising every JSON path.
 *
 * No cleanup on panel close - same logic as the 3D store: working set is
 * bounded by panel count, which is bounded by user patience, so a small
 * map is fine and re-opening the same panel id picks up where it left off.
 */

import { create } from 'zustand';
import type { DepthColormap } from '../utils/depthColor';
import type { PredicateOp } from '../utils/predicate';

// ── TimeSeriesPlot ─────────────────────────────────────────────────────

/** A user-defined derived series: a math expression plotted on top of raw fields. */
export interface ExpressionDef {
  /** Stable id used as the series key in visibility map and uPlot. */
  id: string;
  /** Raw expression text, e.g. "sqrt(linear.x^2 + linear.y^2)". */
  expr: string;
  /** Display label in the legend (defaults to `expr` if the user didn't rename it). */
  label: string;
}

/**
 * A single field from another topic (possibly in another loaded bag) plotted
 * on the same axes as the panel's own topic.
 */
export interface ExtraSeriesDef {
  id: string;
  bagId: string;
  topic: string;
  /** flattenNumeric-style path, e.g. `twist.twist.linear.x`. */
  field: string;
  /** Name used in expressions and the chip, unique within the panel. */
  alias: string;
}

export interface TimeSeriesPanelSettings {
  /** Map of `field.path` or expression `id` → visibility. Missing entries default to visible. */
  visibility: Record<string, boolean>;
  /**
   * Current x-axis range in seconds-from-first-message, or null when the
   * user hasn't zoomed and we want uPlot's auto-fit to apply. Captured via
   * uPlot's `hooks.setScale` and applied on mount, so the chart re-mounts
   * after a dock with the same horizontal viewport the user was looking at.
   */
  xRange: { min: number; max: number } | null;
  /** User-defined math expressions plotted as extra derived series. */
  expressions: ExpressionDef[];
  /**
   * Fields from other topics added to this plot. Like `expressions`, these live
   * in the panel store, not the URL hash, so they survive docking but not a
   * shared link (the hash only carries layout, playhead and bag URL).
   */
  extraSeries: ExtraSeriesDef[];
  /** Series plotted on the x axis instead of time (an XY plot); null means the usual time axis. */
  xyX: string | null;
  /** XY plot only: give both axes the same scale so a circle in the data stays a circle. */
  xyEqual: boolean;
}

export const DEFAULT_TIMESERIES_SETTINGS: TimeSeriesPanelSettings = {
  visibility: {},
  xRange: null,
  expressions: [],
  extraSeries: [],
  xyX: null,
  xyEqual: false,
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

// ── StateTransitions ───────────────────────────────────────────────────

export interface StatePanelSettings {
  /** Field paths drawn as lanes; null means "pick sensible defaults for this message". */
  fields: string[] | null;
}

export const DEFAULT_STATE_SETTINGS: StatePanelSettings = { fields: null };

interface StatePanelState {
  byId: Record<string, StatePanelSettings>;
  update: (panelId: string, partial: Partial<StatePanelSettings>) => void;
}

export const useStatePanelStore = create<StatePanelState>((set) => ({
  byId: {},
  update: (panelId, partial) => {
    set((state) => ({
      byId: {
        ...state.byId,
        [panelId]: { ...(state.byId[panelId] ?? DEFAULT_STATE_SETTINGS), ...partial },
      },
    }));
  },
}));

// ── Search ─────────────────────────────────────────────────────────────

export interface SearchPanelSettings {
  /** Dot-path of the field the predicate reads; '' until the user (or a default) picks one. */
  field: string;
  op: PredicateOp;
  /** Raw text the user typed; converted by `parsePredicateValue` when a scan starts. */
  valueText: string;
  /** Report only where the condition becomes true, not every matching sample. */
  edge: boolean;
}

export const DEFAULT_SEARCH_SETTINGS: SearchPanelSettings = { field: '', op: '<', valueText: '', edge: true };

interface SearchPanelState {
  byId: Record<string, SearchPanelSettings>;
  update: (panelId: string, partial: Partial<SearchPanelSettings>) => void;
}

export const useSearchPanelStore = create<SearchPanelState>((set) => ({
  byId: {},
  update: (panelId, partial) => {
    set((state) => ({
      byId: {
        ...state.byId,
        [panelId]: { ...(state.byId[panelId] ?? DEFAULT_SEARCH_SETTINGS), ...partial },
      },
    }));
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
   * recomputing immediately - the data effect handles it.
   */
  view: TrajectoryView | null;
  /**
   * Toggle the OpenStreetMap tile underlay for NavSatFix trajectories.
   * Off by default - fetching tiles breaks BAGEL's "no data leaves your
   * machine" pitch, so we make the user opt in explicitly.
   *
   * Ignored on non-GPS trajectories (no anchor lat/lon to project from).
   */
  showMapTiles: boolean;
}

export const DEFAULT_TRAJECTORY_SETTINGS: TrajectoryPanelSettings = {
  view: null,
  showMapTiles: false,
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

// ── ImageViewer (v1.3.2) ───────────────────────────────────────────────

export interface ImagePanelSettings {
  /**
   * Show the CameraInfo overlay (principal-point reticle, focal-length
   * badge, distortion-likely-unfilled chip). Off by default so the panel
   * looks the same as v1.3.1 for users who don't have a CameraInfo topic
   * in their bag; turning it on is a single click in the panel header.
   */
  cameraInfoOverlay: boolean;
  /**
   * Manual CameraInfo topic override. Empty string means "use auto-pair".
   * Persisted per-panel so a stereo rig's odd left/right mapping sticks
   * through dock + reopen.
   */
  cameraInfoManualPair: string;
  /**
   * Apply plumb-bob (Brown-Conrady) undistortion to each frame using the
   * paired CameraInfo's D coefficients (v1.3.4). Off by default - bags
   * without a paired CameraInfo or with an unsupported distortion model
   * (fisheye, equidistant) keep the raw frame unchanged.
   */
  rectify: boolean;
  /** Colormap for depth encodings (16UC1, 32FC1, compressedDepth). */
  depthColormap: DepthColormap;
  /** Explicit depth range ends in the encoding's unit; null means auto (1st/99th percentile). */
  depthMin: number | null;
  depthMax: number | null;
  /** `vision_msgs/Detection2DArray` topic drawn over the image; '' means off. */
  detectionTopic: string;
  /** `PointCloud2` topic projected onto the image; '' means off. */
  cloudTopic: string;
}

export const DEFAULT_IMAGE_SETTINGS: ImagePanelSettings = {
  cameraInfoOverlay: false,
  cameraInfoManualPair: '',
  rectify: false,
  depthColormap: 'turbo',
  depthMin: null,
  depthMax: null,
  detectionTopic: '',
  cloudTopic: '',
};

interface ImagePanelState {
  byId: Record<string, ImagePanelSettings>;
  update: (panelId: string, partial: Partial<ImagePanelSettings>) => void;
}

export const useImagePanelStore = create<ImagePanelState>((set) => ({
  byId: {},
  update: (panelId, partial) => {
    set((state) => {
      const current = state.byId[panelId] ?? DEFAULT_IMAGE_SETTINGS;
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
