/**
 * Global keyboard shortcuts.
 *
 * Centralises every binding in one place so they don't drift across the
 * codebase, and so the Shortcuts modal can be generated from the same source
 * the handler consumes (single source of truth).
 *
 * All bindings ignore events that originate in <input>, <textarea>, or
 * contentEditable elements — the Topic search box would otherwise eat every
 * keystroke as a global action.
 */

import { useEffect } from 'react';
import { useBagStore } from '../store/bagStore';
import { usePlayheadStore } from '../store/playheadStore';
import { useLayoutStore } from '../store/layoutStore';
import { useUiStore } from '../store/uiStore';
import { useAnnotationStore } from '../store/annotationStore';

/** Single source of truth for the Shortcuts modal + the handler. */
export interface ShortcutDescription {
  keys: string;
  description: string;
  /** Optional grouping label, used by the modal. */
  group: 'Playback' | 'Panels' | 'Navigation' | 'Help';
}

export const SHORTCUTS: ShortcutDescription[] = [
  { keys: 'Space', description: 'Play / pause the playhead', group: 'Playback' },
  { keys: '←  →', description: 'Step the playhead by ~1% of the bag', group: 'Playback' },
  { keys: 'Shift + ←  →', description: 'Step by ~5% (coarse jump)', group: 'Playback' },
  { keys: 'Home  End', description: 'Jump to bag start / end', group: 'Playback' },
  { keys: 'L', description: 'Toggle loop playback', group: 'Playback' },
  { keys: 'M', description: 'Add timeline bookmark at playhead', group: 'Playback' },
  { keys: 'T', description: 'Focus the topic search box', group: 'Navigation' },
  { keys: 'Esc', description: 'Restore a maximized panel, or close the most recently opened one', group: 'Panels' },
  { keys: 'Shift + Esc', description: 'Close every open panel', group: 'Panels' },
  { keys: 'O', description: 'Open a different bag file', group: 'Navigation' },
  { keys: '?', description: 'Show this shortcuts list', group: 'Help' },
];

/**
 * Should a key event be ignored because the user is typing in a field?
 *
 * We allow Esc to escape — most users expect Esc to unfocus an input, and the
 * caller can decide whether to close a panel after that.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const bag = useBagStore.getState().bag;
      if (!bag) return;
      const typing = isTypingTarget(e.target);

      // Esc always works — even when typing — but unblurs first if you're
      // in an input. Otherwise it closes the most recent panel.
      if (e.key === 'Escape') {
        if (typing) {
          (e.target as HTMLElement).blur();
          return;
        }
        if (useUiStore.getState().modal) {
          e.preventDefault();
          useUiStore.getState().setModal(null);
          return;
        }
        e.preventDefault();
        const layout = useLayoutStore.getState();
        if (layout.maximizedId) {
          layout.setMaximizedId(null);
          return;
        }
        if (e.shiftKey) {
          layout.closeAllPanels();
        } else if (layout.openOrder.length > 0) {
          // Close most-recently-opened panel. `openOrder` is the tree-aware
          // replacement for the v0.5 flat `panels` array — it tracks insert
          // order independently of where the panel ended up in the tree
          // after docking.
          layout.closePanel(layout.openOrder[layout.openOrder.length - 1]);
        }
        return;
      }

      if (typing) return;

      // Fires before the playback bindings so '?' isn't swallowed by anything
      // else. 'A' used to open About here too, freed up for panel-scoped 3D
      // fly controls (strafe left) - About stays reachable via the toolbar
      // button.
      if (e.key === '?') {
        e.preventDefault();
        useUiStore.getState().setModal('shortcuts');
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        const input = document.getElementById('topic-search-input') as HTMLInputElement | null;
        input?.focus();
        input?.select();
        return;
      }

      if (e.key === 'o' || e.key === 'O') {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        useBagStore.getState().clearBag();
        return;
      }

      if (e.key === 'l' || e.key === 'L') {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        const store = usePlayheadStore.getState();
        store.setLoop(!store.loop);
        return;
      }

      if (e.key === 'm' || e.key === 'M') {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        const { timeNs } = usePlayheadStore.getState();
        const ann = useAnnotationStore.getState();
        const count = ann.annotations.length + 1;
        ann.addAnnotation(timeNs, `Mark ${count}`);
        return;
      }

      // Playback bindings — operate against the playhead store.
      const playhead = usePlayheadStore.getState();
      const range = playhead.endNs - playhead.startNs;
      if (range <= 0n) return;
      const step = e.shiftKey ? 0.05 : 0.01; // fraction of bag duration
      const stepNs = BigInt(Math.max(1, Math.floor(Number(range) * step)));

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        playhead.seek(playhead.timeNs - stepNs);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        playhead.seek(playhead.timeNs + stepNs);
        return;
      }
      if (e.key === 'Home') {
        e.preventDefault();
        playhead.seek(playhead.startNs);
        return;
      }
      if (e.key === 'End') {
        e.preventDefault();
        playhead.seek(playhead.endNs);
        return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
