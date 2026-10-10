import { lazy, Suspense } from 'react';
import { useUiStore } from '../../store/uiStore';
import { AboutModal } from './AboutModal';
import { ShortcutsModal } from './ShortcutsModal';
import { CommandPalette } from './CommandPalette';
import { LabelsModal } from './LabelsModal';

// The heavier dialogs (editing and exporting bags, clips and frames, sharing, URDF and
// schema paste) download when first opened rather than with the first screen.
const named = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(async () => ({ default: (await load())[name] }));

const SchemaPasteModal = named(() => import('./SchemaPasteModal'), 'SchemaPasteModal');
const BagEditModal = named(() => import('./BagEditModal'), 'BagEditModal');
const UrdfLoadModal = named(() => import('./UrdfLoadModal'), 'UrdfLoadModal');
const ClipExportModal = named(() => import('./ClipExportModal'), 'ClipExportModal');
const FrameExportModal = named(() => import('./FrameExportModal'), 'FrameExportModal');
const ShareModal = named(() => import('./ShareModal'), 'ShareModal');

/**
 * ModalHost - Renders whichever modal the UI store has selected. Mounted once
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
    <Suspense fallback={null}>
      {modal === 'about' && <AboutModal />}
      {modal === 'shortcuts' && <ShortcutsModal />}
      {modal === 'bag-edit' && <BagEditModal />}
      {modal === 'urdf-load' && <UrdfLoadModal />}
      {modal === 'clip-export' && <ClipExportModal />}
      {modal === 'share' && <ShareModal />}
      {modal === 'command-palette' && <CommandPalette />}
      {modal === 'labels' && <LabelsModal />}
      {modal === 'frame-export' && <FrameExportModal />}
      {schemaPaste && <SchemaPasteModal />}
    </Suspense>
  );
}
