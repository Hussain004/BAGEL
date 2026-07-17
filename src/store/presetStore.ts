/**
 * Named layout presets ("SLAM debug", "camera rig", etc.) - v1.7.
 *
 * A preset saves the *shape* of the current layout (split tree + panel kinds)
 * but not the concrete topic names: a layout built from one bag's
 * `/camera/front/image_raw` won't exist verbatim in the next bag. Instead
 * each panel leaf is stored as a (panelKind, rosType) slot, and applying a
 * preset re-matches each slot against the focused bag's topics by type:
 * "first Image topic", "first OccupancyGrid", etc. Slots with no matching
 * topic are silently dropped (splits collapse the same way layoutStore's own
 * tree ops do) rather than prompting for a manual reassignment.
 *
 * Persisted to localStorage only (no export/import). Presets are a personal
 * shortcut, not something that needs to travel with a shared link the way
 * the URL-hash layout does.
 */
import { create } from 'zustand';
import {
  useLayoutStore,
  panelLeafId,
  type LayoutNode,
  type PanelKind,
  type SplitOrientation,
} from './layoutStore';
import { useBagStore } from './bagStore';

const STORAGE_KEY = 'bagel:presets:v1';

export type PresetSlot = { node: 'slot'; kind: PanelKind; type: string };
export type PresetSplit = {
  node: 'split';
  orientation: SplitOrientation;
  children: PresetNode[];
};
export type PresetNode = PresetSlot | PresetSplit;

export interface LayoutPreset {
  id: string;
  name: string;
  tree: PresetNode;
}

function loadPresets(): LayoutPreset[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LayoutPreset[]) : [];
  } catch {
    return [];
  }
}

function persist(presets: LayoutPreset[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Best-effort: a full/unavailable localStorage just means the preset
    // won't survive a reload, not a hard failure.
  }
}

/** Strip topic name / bagId / leaf id down to a reusable (kind, type) slot. */
function toPresetNode(node: LayoutNode): PresetNode {
  if (node.node === 'panel') {
    return { node: 'slot', kind: node.kind, type: node.type };
  }
  return {
    node: 'split',
    orientation: node.orientation,
    children: node.children.map(toPresetNode),
  };
}

let splitCounter = 0;

/**
 * Walk a preset tree, matching each slot to the first not-yet-used topic of
 * the same ROS type. `used` tracks topic names claimed earlier in the same
 * walk so two slots of the same type don't both grab the first match.
 */
function resolvePresetNode(
  node: PresetNode,
  topics: { name: string; type: string }[],
  used: Set<string>,
  bagId: string | undefined,
): LayoutNode | null {
  if (node.node === 'slot') {
    const topic = topics.find((t) => t.type === node.type && !used.has(t.name));
    if (!topic) return null;
    used.add(topic.name);
    return {
      node: 'panel',
      id: panelLeafId(node.kind, topic.name, bagId),
      kind: node.kind,
      topicName: topic.name,
      type: topic.type,
      bagId,
    };
  }
  const children: LayoutNode[] = [];
  for (const c of node.children) {
    const resolved = resolvePresetNode(c, topics, used, bagId);
    if (resolved) children.push(resolved);
  }
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  splitCounter++;
  return { node: 'split', id: `preset:${splitCounter}`, orientation: node.orientation, children };
}

interface PresetState {
  presets: LayoutPreset[];
  savePreset: (name: string) => void;
  deletePreset: (id: string) => void;
  applyPreset: (id: string) => void;
}

export const usePresetStore = create<PresetState>((set, get) => ({
  presets: loadPresets(),

  savePreset: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const root = useLayoutStore.getState().root;
    if (!root) return;
    const preset: LayoutPreset = {
      id: `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed,
      tree: toPresetNode(root),
    };
    const presets = [...get().presets, preset];
    set({ presets });
    persist(presets);
  },

  deletePreset: (id) => {
    const presets = get().presets.filter((p) => p.id !== id);
    set({ presets });
    persist(presets);
  },

  applyPreset: (id) => {
    const preset = get().presets.find((p) => p.id === id);
    if (!preset) return;
    const bagState = useBagStore.getState();
    const focusBagId = bagState.focusBagId;
    const entry = focusBagId ? bagState.bags.get(focusBagId) : undefined;
    if (!entry) return;
    const topics = entry.summary.topics.map((t) => ({ name: t.name, type: t.type }));
    const newRoot = resolvePresetNode(preset.tree, topics, new Set(), focusBagId ?? undefined);
    useLayoutStore.getState().restoreLayout(newRoot);
  },
}));
