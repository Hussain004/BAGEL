import { useEffect, useRef, type ReactNode } from 'react';

interface ModalShellProps {
  title: string;
  onClose: () => void;
  /** Optional sub-line under the title. */
  subtitle?: string;
  /** Width preset; defaults to a comfortable reading column. */
  width?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const WIDTH_CLASS: Record<NonNullable<ModalShellProps['width']>, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
};

/**
 * ModalShell — Reusable dialog chrome with a backdrop, focus management,
 * Escape-to-close, and click-outside-to-close.
 *
 * Focus trap is intentionally minimal — we restore focus to the previously
 * focused element on close and route initial focus to the close button so
 * keyboard users can dismiss with Enter immediately. A full focus trap
 * (Tab cycling) is overkill for the two short modals BAGEL ships.
 */
export function ModalShell({
  title,
  subtitle,
  onClose,
  width = 'md',
  children,
}: ModalShellProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  // Stash the previously focused element so we can restore focus on close.
  useEffect(() => {
    lastFocusedRef.current = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    return () => {
      lastFocusedRef.current?.focus?.();
    };
  }, []);

  // Esc-to-close at the document level so it works even when focus left the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Click on the backdrop (but not on the dialog itself) closes the modal.
  const onBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onBackdropClick}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`w-full ${WIDTH_CLASS[width]} rounded-2xl border border-border bg-bg-secondary shadow-panel overflow-hidden animate-fade-in-scale flex flex-col max-h-[85vh]`}
      >
        <header className="flex items-start gap-3 px-6 py-4 border-b border-border bg-surface/40 flex-shrink-0">
          <div className="flex-1 min-w-0">
            <h2 id="modal-title" className="text-base font-semibold text-text-primary">
              {title}
            </h2>
            {subtitle && (
              <p className="text-text-tertiary text-xs mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            className="w-8 h-8 rounded-md flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
            aria-label="Close dialog"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
