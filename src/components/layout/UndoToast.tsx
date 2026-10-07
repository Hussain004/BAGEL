import { useEffect } from 'react';
import { useLayoutStore } from '../../store/layoutStore';

/**
 * How long the undo affordance stays up. Long enough to notice after a
 * reflexive Esc, short enough that it is not permanent chrome.
 */
const VISIBLE_MS = 6000;

/**
 * UndoToast - "Closed 3D Scene, Undo" after a panel close.
 *
 * Closing a 3D panel you spent a minute configuring (world frame, clip box,
 * accumulation) used to be permanent, and Esc makes closing easy to do by
 * accident. This restores it in the same slot, not merely at the end of the
 * row.
 *
 * Visibility is derived from `lastClosed` rather than mirrored into local
 * state: the store is already the single source of truth for whether an undo is
 * pending, and mirroring it would mean two states that can disagree. The effect
 * below exists only to schedule the expiry, and it updates the store (an
 * external system) from a timer callback rather than calling setState.
 *
 * Because the effect is keyed on the panel id, closing three panels in a row
 * restarts the timer each time rather than letting the first expiry hide the
 * third toast early.
 */
export function UndoToast() {
  const lastClosed = useLayoutStore((s) => s.lastClosed);
  const clearLastClosed = useLayoutStore((s) => s.clearLastClosed);
  const panelId = lastClosed?.leaf.id ?? null;

  useEffect(() => {
    if (panelId === null) return;
    const timer = setTimeout(() => clearLastClosed(), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [panelId, clearLastClosed]);

  // Deliberately no Escape-to-undo binding here. The global shortcut handler
  // already owns Escape (maximize, then close-most-recent), and a second
  // window listener would race it: one keypress would both reopen the closed
  // panel and close the next one. Cmd/Ctrl+Z and the Undo button are the
  // unambiguous triggers.

  if (!lastClosed) return null;

  return (
    <div
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-bg-secondary/95 shadow-panel animate-fade-in"
      role="status"
      aria-live="polite"
    >
      <span className="text-xs text-text-secondary">
        Closed <span className="mono text-text-primary">{labelFor(lastClosed.leaf.kind)}</span>
        {' panel'}
      </span>
      <button
        type="button"
        onClick={() => useLayoutStore.getState().reopenLastClosed()}
        className="px-2 py-1 rounded-md text-xs font-medium text-accent-blue hover:bg-surface-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={() => clearLastClosed()}
        aria-label="Dismiss undo"
        className="text-text-tertiary hover:text-text-primary transition-colors"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path
            d="M1 1l8 8M9 1l-8 8"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

/** Matches the badge labels in PanelShell so the two agree on naming. */
function labelFor(kind: string): string {
  const labels: Record<string, string> = {
    plot: 'Plot',
    image: 'Image',
    raw: 'Raw',
    trajectory: 'Path',
    tf: 'TF Tree',
    '3d': '3D Scene',
    diagnostic: 'Diagnostics',
    log: 'Log',
    health: 'Bag Health',
    splat: 'Gaussian Splat',
    state: 'State',
  };
  return labels[kind] ?? kind;
}