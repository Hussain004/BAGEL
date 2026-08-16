/**
 * Per-data-type default Display settings for the ThreeDScene panel.
 *
 * v1.3.3 - "saving defaults would be great" (issue #44).
 *
 * The v0.4+ `threeDPanelStore` already persists each panel's Display-card
 * choices within a session, keyed by `panelId` (`3d:<topicName>`). What it
 * doesn't do is survive a page reload, and it doesn't carry across to a
 * different topic name - drop a new bag whose PointCloud2 topic is named
 * differently and you're back to the hard-coded defaults.
 *
 * This store fills that gap. It holds one user-configurable default per
 * scene kind (`pointcloud`, `laserscan`, `markerarray`, `occupancygrid`,
 * `pose`) as a `Partial<ThreeDPanelSettings>` patch over the hard-coded
 * `DEFAULT_THREE_D_SETTINGS`. The ThreeDScene panel reads this on first
 * mount and merges it on top of the hard-coded defaults when no per-panelId
 * entry exists yet, so dragging any new PointCloud2 topic spins up the
 * panel with the user's preferred colour mode + accumulator state.
 *
 * Wire-up
 * -------
 *   - ThreeDScene seeds `threeDPanelStore.byId[panelId]` from
 *     `panelDefaultsStore.byKind[kind]` the first time the panel mounts.
 *   - The Display card grows "Save as default" / "Reset to default"
 *     buttons that call `setDefault(kind, settings)` / `applyTo(panelId,
 *     kind)` respectively.
 *
 * Persistence
 * -----------
 * `localStorage[bagel:panel-defaults:v1]` stores the JSON serialisation
 * of `byKind`. Same pattern the theme / custom schemas / package roots
 * stores use; falls back to an empty map when storage is unavailable or
 * the entry is corrupt.
 */

import { create } from 'zustand';
import {
  DEFAULT_THREE_D_SETTINGS,
  type ThreeDPanelSettings,
} from './threeDPanelStore';
import {
  SCENE_KINDS,
  type SceneKind,
} from '../components/panels/ThreeDScene/sceneKind';

const STORAGE_KEY = 'bagel:panel-defaults:v1';

/**
 * Fields we DON'T want to capture as a per-kind default, even when the user
 * has set them on the source panel. These are inherently per-panel (a saved
 * `worldFrame` of `map` is wrong when the next bag only has `odom`) or
 * per-session-volatile (the orbit pivot is a viewport-specific choice).
 *
 * Kept in lockstep with `ThreeDPanelSettings` so a future field addition
 * fails review by being included by default rather than silently leaking.
 */
const NON_PORTABLE_FIELDS: ReadonlySet<keyof ThreeDPanelSettings> = new Set([
  'worldFrame',
  'pivot',
  'hiddenMarkerNamespaces',
  'hiddenFrustumTopics',
  'spatialOverlayTopics',
  'spatialOverlayStyles',
]);

export type PanelDefaults = Partial<ThreeDPanelSettings>;

/**
 * Strip the non-portable fields from a full settings snapshot before saving
 * it as a user default. Keeping the rest as a `Partial` lets us re-merge
 * cleanly on top of `DEFAULT_THREE_D_SETTINGS` on read.
 */
export function portableSubset(settings: ThreeDPanelSettings): PanelDefaults {
  const out: PanelDefaults = {};
  for (const key of Object.keys(settings) as (keyof ThreeDPanelSettings)[]) {
    if (NON_PORTABLE_FIELDS.has(key)) continue;
    // Use Object.assign so TypeScript narrows the value type to the key's
    // declared shape instead of widening to `string | number | ...`.
    Object.assign(out, { [key]: settings[key] });
  }
  return out;
}

/**
 * Merge the user's saved default (if any) on top of the hard-coded defaults.
 * The hard-coded defaults are the floor, so a future field addition that
 * lands without the user re-saving stays well-defined.
 */
export function resolveDefaults(
  kind: SceneKind,
  byKind: Record<string, PanelDefaults>,
): ThreeDPanelSettings {
  const saved = byKind[kind];
  if (!saved) return DEFAULT_THREE_D_SETTINGS;
  return { ...DEFAULT_THREE_D_SETTINGS, ...saved };
}

function loadFromStorage(): Record<string, PanelDefaults> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, PanelDefaults> = {};
    for (const kind of SCENE_KINDS) {
      const entry = (parsed as Record<string, unknown>)[kind];
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        // Only keep keys present on the canonical shape; reject everything
        // else so a corrupted entry can't introduce stray fields.
        const portable: PanelDefaults = {};
        for (const key of Object.keys(DEFAULT_THREE_D_SETTINGS) as (
          keyof ThreeDPanelSettings
        )[]) {
          if (NON_PORTABLE_FIELDS.has(key)) continue;
          if (key in (entry as Record<string, unknown>)) {
            Object.assign(portable, { [key]: (entry as Record<string, unknown>)[key] });
          }
        }
        if (Object.keys(portable).length > 0) out[kind] = portable;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function saveToStorage(byKind: Record<string, PanelDefaults>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(byKind));
  } catch {
    // Best-effort persistence - the working set is at most one entry per
    // scene kind (5 total), so QuotaExceededError is practically impossible.
  }
}

interface PanelDefaultsState {
  byKind: Record<string, PanelDefaults>;
  /** Persist `settings` as the user default for `kind`. Overwrites prior saves. */
  setDefault: (kind: SceneKind, settings: ThreeDPanelSettings) => void;
  /** Drop the saved default for `kind` so future panels fall back to hard-coded. */
  clearDefault: (kind: SceneKind) => void;
  /** Drop every saved default. Used by the About-modal manage section. */
  clearAll: () => void;
  /** True if a user default is saved for `kind`. */
  has: (kind: SceneKind) => boolean;
}

export const usePanelDefaultsStore = create<PanelDefaultsState>((set, get) => ({
  byKind: loadFromStorage(),

  setDefault: (kind, settings) => {
    const portable = portableSubset(settings);
    set((state) => {
      const next = { ...state.byKind, [kind]: portable };
      saveToStorage(next);
      return { byKind: next };
    });
  },

  clearDefault: (kind) => {
    set((state) => {
      if (!(kind in state.byKind)) return state;
      const next = { ...state.byKind };
      delete next[kind];
      saveToStorage(next);
      return { byKind: next };
    });
  },

  clearAll: () => {
    saveToStorage({});
    set({ byKind: {} });
  },

  has: (kind) => kind in get().byKind,
}));
