import { ModalShell } from './ModalShell';
import { useUiStore } from '../../store/uiStore';
import { usePlayheadStore } from '../../store/playheadStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { exportLabels } from '../../utils/labelsExport';

const seconds = (ns: bigint, startNs: bigint) => `${(Number(ns - startNs) / 1e9).toFixed(3)} s`;

/**
 * Every bookmark and labelled range on the timeline, editable, with a note per
 * label and export to JSON or CSV: the list people otherwise keep in a spreadsheet.
 */
export function LabelsModal() {
  const annotations = useAnnotationStore((s) => s.annotations);
  const update = useAnnotationStore((s) => s.updateAnnotation);
  const remove = useAnnotationStore((s) => s.removeAnnotation);
  const startNs = usePlayheadStore((s) => s.startNs);
  const close = () => useUiStore.getState().setModal(null);

  return (
    <ModalShell title="Labels" subtitle="Bookmarks and labelled ranges on the timeline" onClose={close} width="lg">
      {annotations.length === 0 ? (
        <div className="p-6 text-sm text-text-secondary space-y-2">
          <p>No labels yet. Three ways to make one:</p>
          <ul className="list-disc pl-5 space-y-1 text-xs">
            <li><strong>Shift+drag</strong> along the timeline to label a range.</li>
            <li>Press <kbd className="mono">[</kbd> at the start and <kbd className="mono">]</kbd> at the end.</li>
            <li>Press <kbd className="mono">M</kbd>, or double-click the timeline, to drop a bookmark.</li>
          </ul>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border" aria-label="Labels">
            {annotations.map((a) => (
              <li key={a.id} className="p-3 flex flex-col gap-1.5" data-testid="label-row">
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Label"
                    defaultValue={a.label}
                    maxLength={60}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== a.label) update(a.id, { label: v });
                      else e.target.value = a.label;
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    className="flex-1 min-w-0 bg-bg-primary border border-border rounded-md px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-accent-blue/60"
                  />
                  <span className="mono text-[11px] text-text-tertiary whitespace-nowrap">
                    {seconds(a.timeNs, startNs)}
                    {a.endNs !== undefined && ` to ${seconds(a.endNs, startNs)} (${(Number(a.endNs - a.timeNs) / 1e9).toFixed(2)} s)`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      usePlayheadStore.getState().seek(a.timeNs);
                      close();
                    }}
                    className="px-2 py-1 rounded-md text-xs border border-border text-text-secondary hover:border-accent-blue/40"
                    title="Jump to the start of this label"
                  >
                    Go
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(a.id)}
                    aria-label={`Delete ${a.label}`}
                    className="px-2 py-1 rounded-md text-xs border border-border text-text-muted hover:text-accent-rose hover:border-accent-rose/40"
                  >
                    Delete
                  </button>
                </div>
                <textarea
                  aria-label="Note"
                  defaultValue={a.note ?? ''}
                  placeholder="Note (kept on this device and in exports, never in a shared link)"
                  rows={2}
                  maxLength={2000}
                  onBlur={(e) => update(a.id, { note: e.target.value.trim() })}
                  className="w-full bg-bg-primary border border-border rounded-md px-2 py-1 text-xs text-text-secondary focus:outline-none focus:border-accent-blue/60 resize-y"
                />
              </li>
            ))}
          </ul>
          <div className="p-3 flex items-center justify-between border-t border-border">
            <span className="text-xs text-text-tertiary">
              {annotations.length} {annotations.length === 1 ? 'label' : 'labels'}. Times are on the bag's own clock, in nanoseconds.
            </span>
            <div className="flex gap-2">
              <button type="button" onClick={() => exportLabels('csv')} className="px-3 py-1.5 rounded-md text-xs border border-border text-text-secondary hover:border-accent-blue/40">
                Export CSV
              </button>
              <button type="button" onClick={() => exportLabels('json')} className="px-3 py-1.5 rounded-md text-xs bg-accent-blue/20 border border-accent-blue/40 text-text-primary hover:bg-accent-blue/30">
                Export JSON
              </button>
            </div>
          </div>
        </>
      )}
    </ModalShell>
  );
}
