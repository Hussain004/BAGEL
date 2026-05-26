import { useUiStore } from '../../store/uiStore';
import { AboutModal } from './AboutModal';
import { ShortcutsModal } from './ShortcutsModal';

/**
 * ModalHost — Renders whichever modal the UI store has selected. Mounted once
 * at the root so keyboard shortcuts can show modals from anywhere without
 * each page needing to wire them up.
 */
export function ModalHost() {
  const modal = useUiStore((s) => s.modal);
  if (modal === 'about') return <AboutModal />;
  if (modal === 'shortcuts') return <ShortcutsModal />;
  return null;
}
