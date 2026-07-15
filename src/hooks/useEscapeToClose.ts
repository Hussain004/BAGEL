import { useEffect } from 'react';

/**
 * While `open` is true, consume the Escape key (capture phase, ahead of the
 * global shortcut handler) and call `onClose` instead. Keeps Esc peeling UI
 * in the expected order: popover first, then modal, then panel - without
 * this, pressing Esc to dismiss a small dropdown closes a whole panel.
 */
export function useEscapeToClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);
}
