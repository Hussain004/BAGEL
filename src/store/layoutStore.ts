/**
 * Zustand store for the panel layout.
 *
 * v0.2 supports three panel kinds (plot / image / raw) and a single shared
 * main area that tiles the open panels in a flex grid. Panels are keyed by
 * `${kind}:${topicName}` so opening the same view twice is a no-op.
 */

import { create } from 'zustand';

export type PanelKind = 'plot' | 'image' | 'raw' | 'trajectory' | 'tf' | '3d';

export interface PanelInstance {
  id: string;
  kind: PanelKind;
  topicName: string;
  type: string;
}

interface LayoutState {
  panels: PanelInstance[];
  openPanel: (panel: Omit<PanelInstance, 'id'>) => void;
  closePanel: (id: string) => void;
  closeAllPanels: () => void;
  /** True if any panel for this topic is currently open. */
  hasPanelForTopic: (topicName: string) => boolean;
}

function panelId(kind: PanelKind, topicName: string): string {
  return `${kind}:${topicName}`;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  panels: [],

  openPanel: ({ kind, topicName, type }) => {
    const id = panelId(kind, topicName);
    if (get().panels.some((p) => p.id === id)) return;
    set({ panels: [...get().panels, { id, kind, topicName, type }] });
  },

  closePanel: (id) => {
    set({ panels: get().panels.filter((p) => p.id !== id) });
  },

  closeAllPanels: () => set({ panels: [] }),

  hasPanelForTopic: (topicName) =>
    get().panels.some((p) => p.topicName === topicName),
}));
