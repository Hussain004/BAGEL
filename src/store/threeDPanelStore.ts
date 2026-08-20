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
export type ProjectionMode = 'perspective' | 'orthographic';

export type MapColorSchemeChoice = 'auto' | 'map' | 'costmap';

export interface SpatialOverlayStyle {
  /** Point size override. Missing values inherit the panel default. */
  pointSize?: number;
  /** Uniform CSS color. Null or missing keeps the message's decoded colors. */
  color?: string | null;
  /**
   * OccupancyGrid color scheme for this overlay layer. 'auto' infers
   * 'costmap' for topic names containing "costmap" and 'map' otherwise.
   * Only meaningful when the overlay's topic is an OccupancyGrid.
   */
  mapColorScheme?: MapColorSchemeChoice;
}

export interface ThreeDPanelSettings {
  colorMode: ColorMode;
  pointSize: number;
  laserScanColor: string | null;
  showGrid: boolean;
  showWorldAxes: boolean;
  /** Perspective 3D orbit or a top-down orthographic 2D map view. */
  projectionMode: ProjectionMode;
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
  /**
   * OccupancyGrid color scheme for this panel's own primary topic (when it
   * is an OccupancyGrid). See `SpatialOverlayStyle.mapColorScheme` for the
   * per-overlay equivalent.
   */
  mapColorScheme: MapColorSchemeChoice;
  /**
   * Show a small colored marker (puck + heading wedge) at each loaded bag's
   * robot base frame, tinted with that bag's color. Only rendered when more
   * than one bag is loaded - a single-bag panel has nothing to distinguish,
   * and the existing "Load robot model" URDF feature already covers that
   * case for users who want a detailed model.
   */
  showRobotMarkers: boolean;
  /**
   * Show wireframe camera frustums for every `sensor_msgs/CameraInfo`
   * topic in the bag (v1.3.2). Off by default - bags without a calibrated
   * camera publish nothing useful here, and showing four overlapping
   * frustums on a multi-camera rig before the user opts in would clutter
   * a freshly opened panel.
   */
  cameraFrustumsOn: boolean;
  /**
   * Far-plane distance for the camera frustum, in metres (v1.3.2).
   * Applied across every visible camera so a single slider scales the
   * whole multi-camera rig at once. 5 m is a good default for indoor
   * SLAM bags; outdoor / drone bags typically want 20-50 m.
   */
  cameraFrustumFar: number;
  /**
   * Camera topics whose frustum the user has individually hidden (v1.3.4).
   * Stored as a sorted array for stable structural equality. Only meaningful
   * when `cameraFrustumsOn` is true and the bag has multiple CameraInfo
   * topics. Topic names are bag-specific so this field is excluded from
   * per-kind saved defaults (listed in NON_PORTABLE_FIELDS).
   */
  hiddenFrustumTopics: string[];
  /**
   * Additional spatial topics rendered in this panel's scene. Candidates can
   * come from any loaded bag, not just this panel's own, so a topic can be
   * overlaid from a different robot's bag onto one map. Each entry is
   * `overlayKey(bagId, topicName)` from spatialOverlayTopics.ts rather than a
   * bare topic name, so selections from different bags with the same topic
   * name don't collide. These selections are panel-specific and are not
   * saved as cross-bag display defaults.
   */
  spatialOverlayTopics: string[];
  /** Topic-specific visual overrides for selected spatial point layers, keyed the same way. */
  spatialOverlayStyles: Record<string, SpatialOverlayStyle>;
  /**
   * Axis-aligned clip box for PointCloud2 panels (v1.6.1). When on, points
   * outside any of the specified bounds are dropped before coloring. Each
   * bound is null when inactive (no clip on that side). Unlike the radial
   * range filter, these bounds are independent per axis - so the user can
   * shave airborne noise off a wide flat scan by setting zMax only, without
   * compressing the horizontal footprint.
   */
  clipBoxOn: boolean;
  clipXMin: number | null;
  clipXMax: number | null;
  clipYMin: number | null;
  clipYMax: number | null;
  clipZMin: number | null;
  clipZMax: number | null;
  /**
   * Expand/collapse state for the Display card's disclosure sections
   * (v1.7). Only "color by / point size / grid / axes" show by default;
   * everything else lives behind these three sections so a first-time
   * user sees four controls, not twenty. Persisted per-panel (and
   * portable through "save as default") like every other display
   * setting, so a user who opens Accumulation once doesn't have to
   * reopen it on every new panel.
   */
  sectionCoordFrameOpen: boolean;
  sectionRangeClipOpen: boolean;
  sectionAccumulationOpen: boolean;
  sectionOverlaysOpen: boolean;
}

/**
 * Module-level constant so `useThreeDPanelStore(s => s.byId[id] ?? DEFAULTS)`
 * returns a stable reference on the first read — otherwise React would see
 * a new object on every render and tear the panel re-render loop apart.
 */
export const DEFAULT_THREE_D_SETTINGS: ThreeDPanelSettings = {
  colorMode: 'height',
  pointSize: 2.5,
  laserScanColor: null,
  showGrid: true,
  showWorldAxes: true,
  projectionMode: 'perspective',
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
  mapColorScheme: 'auto',
  showRobotMarkers: true,
  cameraFrustumsOn: false,
  cameraFrustumFar: 5,
  hiddenFrustumTopics: [],
  spatialOverlayTopics: [],
  spatialOverlayStyles: {},
  clipBoxOn: false,
  clipXMin: null,
  clipXMax: null,
  clipYMin: null,
  clipYMax: null,
  clipZMin: null,
  clipZMax: null,
  sectionCoordFrameOpen: false,
  sectionRangeClipOpen: false,
  sectionAccumulationOpen: false,
  sectionOverlaysOpen: false,
};

interface ThreeDPanelState {
  byId: Record<string, ThreeDPanelSettings>;
  /** Patch a single panel's settings. Initialises from defaults on first write. */
  update: (panelId: string, partial: Partial<ThreeDPanelSettings>) => void;
  /**
   * Replace the entire settings object for `panelId`. Used by the v1.3.3
   * defaults-seeding path so the user's saved per-kind default lands in
   * full on first mount, rather than waiting for the user to touch a
   * setting before the saved values stick.
   */
  setAll: (panelId: string, settings: ThreeDPanelSettings) => void;
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
  setAll: (panelId, settings) => {
    set((state) => ({
      byId: { ...state.byId, [panelId]: settings },
    }));
  },
}));
