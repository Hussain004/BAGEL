/**
 * Custom message-definition store.
 *
 * `.db3` ROS2 bags don't embed schemas — they only carry a string type name
 * per topic, and the deserializer has to look the type up in a bundled
 * registry to know how many bytes each field occupies and how to lay them
 * out. The registry ships with the common packages (std_msgs, geometry_msgs,
 * sensor_msgs, nav_msgs, tf2_msgs, visualization_msgs, …) but custom or
 * vendor-specific types — `px4_msgs`, `autoware_msgs`, in-house planners —
 * aren't there, and dropping a `.db3` containing those topics today shows
 * an empty plot / inspector with no obvious way to fix it.
 *
 * This store lets the user paste the `.msg` text once per type. We persist
 * to `localStorage` keyed by the fully-qualified type name so the entry
 * survives a refresh and applies to every future bag the user opens —
 * roboticists tend to work with a stable set of message packages across
 * many bags. `.mcap` and `.bag` topics are unaffected: their schemas come
 * from the file itself and never miss.
 *
 * Wire-up
 * -------
 *   - `App.tsx` subscribes and forwards every change to the parser worker
 *     via `parserClient.setCustomSchemas(...)`, which updates the worker's
 *     `typeRegistry` overrides and invalidates the per-type reader cache.
 *   - `TopicRow` uses `useSchemaResolution(typeName)` to decide whether
 *     to render the normal panel-buttons or a "Add schema" affordance.
 *   - `SchemaPasteModal` calls `setSchema` after successful validation.
 *   - The about modal exposes `allSchemas()` so users can review or
 *     remove entries without DevTools.
 */

import { create } from 'zustand';

const STORAGE_KEY = 'bagel:custom-schemas:v1';

interface CustomSchemaState {
  /** `typeName -> schema text` (raw concatenated `.msg` form). */
  schemas: Record<string, string>;
  setSchema: (typeName: string, schemaText: string) => void;
  deleteSchema: (typeName: string) => void;
  /** Drop every saved schema. Used by the "clear all" affordance. */
  clearAll: () => void;
  /** True if a custom schema is registered for `typeName`. */
  has: (typeName: string) => boolean;
}

function loadFromStorage(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && k.length > 0) out[k] = v;
      }
      return out;
    }
  } catch {
    // Corrupt JSON — drop it; we'd rather start empty than crash on load.
  }
  return {};
}

function saveToStorage(schemas: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(schemas));
  } catch {
    // Likely QuotaExceededError — the user has hit the ~5 MB cap. We can't
    // do much beyond keeping the in-memory copy; surfacing a UI toast is
    // a follow-up if anyone actually runs into this. .msg text is small
    // (a few KB per type) so the practical bound is a few hundred types.
  }
}

export const useCustomSchemaStore = create<CustomSchemaState>((set, get) => ({
  schemas: loadFromStorage(),

  setSchema: (typeName, schemaText) => {
    if (!typeName) return;
    set((state) => {
      const next = { ...state.schemas, [typeName]: schemaText };
      saveToStorage(next);
      return { schemas: next };
    });
  },

  deleteSchema: (typeName) => {
    set((state) => {
      if (!(typeName in state.schemas)) return state;
      const next = { ...state.schemas };
      delete next[typeName];
      saveToStorage(next);
      return { schemas: next };
    });
  },

  clearAll: () => {
    saveToStorage({});
    set({ schemas: {} });
  },

  has: (typeName) => typeName in get().schemas,
}));
