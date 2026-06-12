import { useUiStore } from '../../store/uiStore';
import { AboutModal } from './AboutModal';
import { ShortcutsModal } from './ShortcutsModal';
import { SchemaPasteModal } from './SchemaPasteModal';
import { BagEditModal } from './BagEditModal';
import { UrdfLoadModal } from './UrdfLoadModal';
import { ClipExportModal } from './ClipExportModal';

/**
 * ModalHost — Renders whichever modal the UI store has selected. Mounted once
 * at the root so keyboard shortcuts can show modals from anywhere without
 * each page needing to wire them up.
 *
 * `schemaPaste` lives in its own slot rather than ModalKind so the modal
 * can carry per-target context (which type, which topic to open after).
 * It can coexist with `about` / `shortcuts` if needed, but in practice only
 * one is open at a time.
 */
export function ModalHost() {
  const modal = useUiStore((s) => s.modal);
  const schemaPaste = useUiStore((s) => s.schemaPaste);
  return (
    <>
      {modal === 'about' && <AboutModal />}
      {modal === 'shortcuts' && <ShortcutsModal />}
      {modal === 'bag-edit' && <BagEditModal />}
      {modal === 'urdf-load' && <UrdfLoadModal />}
      {modal === 'clip-export' && <ClipExportModal />}
      {schemaPaste && <SchemaPasteModal />}
    </>
  );
}
