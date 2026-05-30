import { useState, type ReactNode } from 'react';
import { useLayoutStore, type PanelKind } from '../../store/layoutStore';
import { useDragDockStore } from '../../store/dragDockStore';
import { useBagStore, resolveBagEntry } from '../../store/bagStore';
import { readDeserializedMessages } from '../../parsers';
import {
  downloadText,
  makeExportFilename,
  toCsv,
  toNdjson,
  type ExportFormat,
} from '../../utils/export';

interface PanelShellProps {
  panelId: string;
  kind: PanelKind;
  topicName: string;
  type: string;
  accentColor?: string;
  /** Multi-bag: which bag this panel reads from. Falls back to focused bag. */
  bagId?: string;
  children: ReactNode;
}

const KIND_LABELS: Record<PanelKind, string> = {
  plot: 'Plot',
  image: 'Image',
  raw: 'Raw',
  trajectory: 'Trajectory',
  tf: 'TF Tree',
  '3d': '3D Scene',
};

/**
 * Hard cap on rows the in-browser exporter will assemble for a single topic.
 *
 * We hold the whole topic in memory before writing the Blob, so the cap is
 * really about avoiding OOM on truly huge bags rather than file-system
 * limits. 250k messages × ~20 numeric leaves ≈ 100 MB CSV, which the browser
 * can still serve as a single download.
 */
const EXPORT_MESSAGE_LIMIT = 250_000;

/**
 * PanelShell — Chrome shared by every panel. Provides a header with the topic
 * name, type, panel-kind label, an export menu, and a close button, plus a
 * flex content area for the panel-specific UI.
 */
export function PanelShell({
  panelId,
  kind,
  topicName,
  type,
  accentColor,
  bagId,
  children,
}: PanelShellProps) {
  const closePanel = useLayoutStore((s) => s.closePanel);
  const startDrag = useDragDockStore((s) => s.startDrag);
  const endDrag = useDragDockStore((s) => s.endDrag);
  const isDragging = useDragDockStore((s) => s.sourceId === panelId);
  const bagCount = useBagStore((s) => s.bagOrder.length);
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const parts = type.split('/');
  const shortType = parts[parts.length - 1] || type;
  const pkg = parts[0] || '';

  /**
   * The whole header is a drag handle. We opt out when the pointer-down
   * lands on an interactive descendant (close button, export menu) — those
   * have their own click behaviour, and the user almost certainly didn't
   * mean to start a drag.
   *
   * Global pointerup/cancel/Esc end the drag, so a release outside any drop
   * zone is treated as "cancel" and the panel stays put.
   *
   * Touch/pen inputs implicitly capture the pointer to the down-target per
   * the Pointer Events spec, which would route pointerenter/up events at
   * the drop zones away from them and back to the header. Release the
   * capture explicitly so the drop zones receive the events.
   */
  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return; // left-click only
    const target = e.target as HTMLElement;
    if (target.closest('button, input, select, a, [role="menu"], [role="menuitem"]')) {
      return;
    }
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    startDrag(panelId);
    const cleanup = () => {
      endDrag();
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
      window.removeEventListener('keydown', onKey);
    };
    const onKey = (ke: KeyboardEvent) => {
      if (ke.key === 'Escape') cleanup();
    };
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
    window.addEventListener('keydown', onKey);
  };

  return (
    // min-w-0 paired with overflow-hidden so a canvas-bearing child
    // (TimeSeriesPlot's uPlot) can't push the shell wider than its
    // allocated parent width. See PanelLeafContent comment for the
    // full story on the single-panel resize loop.
    <div
      className={`flex-1 flex flex-col min-h-0 min-w-0 rounded-xl border border-border bg-bg-secondary/60 backdrop-blur-md shadow-panel overflow-hidden animate-fade-in-scale ${
        isDragging ? 'opacity-60 ring-2 ring-accent-blue/60' : ''
      }`}
    >
      <header
        onPointerDown={handleHeaderPointerDown}
        className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-surface/60 cursor-grab active:cursor-grabbing select-none"
        title="Drag to dock this panel"
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: accentColor ?? '#94a3b8' }}
          aria-hidden="true"
        />
        <span className="badge badge-slate flex-shrink-0">{KIND_LABELS[kind]}</span>
        {bagCount > 1 && entry && (
          <span
            className="badge flex-shrink-0 mono text-[10px] px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: `${entry.color}22`,
              color: entry.color,
              border: `1px solid ${entry.color}44`,
            }}
            title={`Reading from ${entry.summary.fileName}`}
          >
            {entry.summary.fileName}
          </span>
        )}
        <span
          className="mono text-sm text-text-primary font-medium truncate flex-1"
          title={topicName}
        >
          {topicName}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0 text-xs">
          {pkg && <span className="text-text-muted mono">{pkg}/</span>}
          <span className="text-text-secondary mono">{shortType}</span>
        </div>
        <ExportMenu topicName={topicName} kind={kind} bagId={bagId} />
        <button
          onClick={() => closePanel(panelId)}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
          title="Close panel (Esc)"
          aria-label={`Close ${KIND_LABELS[kind]} panel for ${topicName}`}
          id={`close-panel-${panelId}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>
      <div className="flex-1 flex flex-col min-h-0">{children}</div>
    </div>
  );
}

/**
 * ExportMenu — Compact dropdown that decodes the panel's topic and offers
 * CSV / NDJSON downloads. Image panels skip CSV (no numeric leaves of
 * interest), TF panels skip both because the raw `transforms[]` array
 * shape is meaningless without TF-graph context.
 */
function ExportMenu({
  topicName,
  kind,
  bagId,
}: {
  topicName: string;
  kind: PanelKind;
  bagId?: string;
}) {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!entry) return null;
  const { id: workerBagId, summary: bag, source } = entry;
  // TF tree exports are surprisingly complex (you really want a CSV per
  // edge), so opt them out of the generic exporter rather than serve a
  // half-broken one.
  if (kind === 'tf') return null;

  const handleExport = async (format: ExportFormat) => {
    if (busy) return;
    setBusy(format);
    setError(null);
    try {
      const messages = await readDeserializedMessages(
        workerBagId,
        source,
        bag.format,
        topicName,
        EXPORT_MESSAGE_LIMIT,
      );
      const text = format === 'csv' ? toCsv(messages) : toNdjson(messages);
      const mime =
        format === 'csv'
          ? 'text/csv;charset=utf-8'
          : 'application/x-ndjson;charset=utf-8';
      downloadText(text, makeExportFilename(bag.fileName, topicName, format), mime);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="ml-1 px-2 h-7 rounded-md flex items-center gap-1 text-xs text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-all border border-transparent hover:border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
        title="Export topic data"
        aria-label="Export topic data"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 12V4m0 0l-4 4m4-4l4 4" />
        </svg>
        <span className="hidden md:inline">Export</span>
      </button>
      {open && (
        <>
          {/* Click-outside catcher. Sits behind the menu so its z-order can't
              accidentally swallow clicks on the menu items themselves. */}
          <div
            className="fixed inset-0 z-30"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            aria-hidden="true"
          />
          <div
            role="menu"
            className="absolute right-0 top-full mt-1 z-40 w-56 rounded-lg border border-border bg-bg-secondary shadow-panel p-1.5 text-xs"
          >
            {kind !== 'image' && (
              <ExportItem
                label="CSV (numeric fields)"
                description="Flattened, one row per message"
                busy={busy === 'csv'}
                onClick={() => handleExport('csv')}
              />
            )}
            <ExportItem
              label="JSON (NDJSON)"
              description="Full deserialized messages"
              busy={busy === 'json'}
              onClick={() => handleExport('json')}
            />
            <div className="px-2.5 pt-1.5 pb-0.5 text-text-tertiary text-[10px] leading-tight">
              First {EXPORT_MESSAGE_LIMIT.toLocaleString()} messages.
              {kind === 'image' && (
                <div className="text-text-tertiary/80 mt-0.5">
                  Images: NDJSON only (binary payloads base64-encoded).
                </div>
              )}
            </div>
            {error && (
              <div className="px-2.5 pt-1 text-accent-rose text-[10px] leading-tight">
                {error}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ExportItem({
  label,
  description,
  busy,
  onClick,
}: {
  label: string;
  description: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={busy}
      className="w-full flex items-start gap-2 px-2.5 py-2 rounded-md text-left text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-60 disabled:cursor-progress transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
    >
      <div className="flex-1 min-w-0">
        <div className="text-text-primary text-xs font-medium">{label}</div>
        <div className="text-text-tertiary text-[10px] leading-tight mt-0.5">
          {description}
        </div>
      </div>
      {busy && (
        <svg className="w-3.5 h-3.5 text-accent-blue animate-spin-slow flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
    </button>
  );
}
