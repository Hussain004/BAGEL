import { useLayoutStore, type PanelKind } from '../store/layoutStore';

export interface OpenAction {
  label: string;
  onClick: () => void;
}

/** "Open this topic in another panel" buttons for an empty state. */
export function openInActions(
  kinds: Array<{ kind: PanelKind; label: string }>,
  target: { topicName: string; type: string; bagId?: string },
): OpenAction[] {
  return kinds.map(({ kind, label }) => ({
    label,
    onClick: () => useLayoutStore.getState().openPanel({ kind, ...target }),
  }));
}
