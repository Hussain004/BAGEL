import { useRef, useState } from 'react';
import { useBagStore, resolveBagEntry } from '../../../store/bagStore';
import { useTimeSeriesPanelStore } from '../../../store/panelUiStores';
import { useLayoutStore } from '../../../store/layoutStore';
import { usePresetStore } from '../../../store/presetStore';

export function PresetsMenu() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const root = useLayoutStore((s) => s.root);
  const presets = usePresetStore((s) => s.presets);
  const savePreset = usePresetStore((s) => s.savePreset);
  const applyPreset = usePresetStore((s) => s.applyPreset);
  const deletePreset = usePresetStore((s) => s.deletePreset);

  const onSave = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !root) return;
    savePreset(trimmed);
    setName('');
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (open && event.key === 'Escape') {
            event.stopPropagation();
            setOpen(false);
          }
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-border hover:border-accent-blue/40 transition-colors"
        title="Save and restore named layouts for other bags"
        aria-label="Layout presets"
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <PresetIcon />
        <span className="hidden xl:inline">Presets</span>
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="absolute right-0 top-full mt-2 z-40 w-72 rounded-lg border border-border bg-surface shadow-xl overflow-hidden"
            role="dialog"
            aria-label="Layout presets"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setOpen(false);
              }
            }}
          >
            <div className="px-3 py-2.5 border-b border-border">
              <div className="text-xs font-medium text-text-primary">Layout presets</div>
              <div className="text-[10px] text-text-muted mt-0.5">
                Panels match the focused bag by message type.
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto py-1">
              {presets.length === 0 ? (
                <div className="px-3 py-3 text-xs text-text-muted">No saved presets yet.</div>
              ) : (
                presets.map((preset) => (
                  <div key={preset.id} className="group flex items-center gap-1 px-1.5">
                    <button
                      onClick={() => {
                        applyPreset(preset.id);
                        setOpen(false);
                      }}
                      className="min-w-0 flex-1 rounded px-2 py-2 text-left text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors truncate"
                      title={`Apply ${preset.name}`}
                    >
                      {preset.name}
                    </button>
                    <button
                      onClick={() => deletePreset(preset.id)}
                      className="w-7 h-7 rounded flex items-center justify-center text-text-muted opacity-60 group-hover:opacity-100 focus:opacity-100 hover:text-accent-rose hover:bg-accent-rose/10 transition-[color,background-color,opacity]"
                      aria-label={`Delete preset ${preset.name}`}
                      title={`Delete ${preset.name}`}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
            <form onSubmit={onSave} className="flex gap-1.5 p-2 border-t border-border">
              <label className="sr-only" htmlFor="preset-name">Preset name</label>
              <input
                id="preset-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="SLAM debug"
                maxLength={60}
                className="min-w-0 flex-1 rounded-md border border-border bg-surface-raised px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/60"
              />
              <button
                type="submit"
                disabled={!root || !name.trim()}
                className="rounded-md border border-accent-blue/40 bg-accent-blue/10 px-2.5 py-1.5 text-xs text-accent-blue hover:bg-accent-blue/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save
              </button>
            </form>
            <LayoutImport />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Open a Foxglove / Lichtblick layout JSON or a PlotJuggler layout XML and
 * replace the current layout with its BAGEL equivalent for the focused bag.
 * What could not be carried over is listed under the button.
 */
function LayoutImport() {
  const inputRef = useRef<HTMLInputElement>(null);
  const entry = useBagStore((s) => resolveBagEntry(s, null));
  const [notes, setNotes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !entry) return;
    setError(null);
    setNotes(null);
    try {
      // Loaded on use: the importer and its XML parser stay out of the main bundle.
      const { importLayout } = await import('../../../utils/layoutImport');
      const result = importLayout(await file.text(), entry.summary.topics, entry.id);
      if (result.root) {
        useLayoutStore.getState().restoreLayout(result.root);
        const update = useTimeSeriesPanelStore.getState().update;
        for (const [id, settings] of Object.entries(result.plots)) update(id, settings);
      }
      setNotes(result.notes);
    } catch (err) {
      setError(`Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="border-t border-border p-2 text-xs">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={!entry}
        className="w-full rounded-md border border-border px-2.5 py-1.5 text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        title={entry ? 'Replace the layout with one from Foxglove, Lichtblick or PlotJuggler' : 'Load a bag first'}
      >
        Import Foxglove / PlotJuggler layout...
      </button>
      <input ref={inputRef} type="file" accept=".json,.xml" className="hidden" onChange={(e) => void onFile(e)} aria-label="Layout file to import" />
      {error && <p className="mt-2 text-accent-rose" role="alert">{error}</p>}
      {notes && (
        <div className="mt-2 text-text-muted" role="status">
          {notes.length === 0 ? 'Imported everything.' : (
            <>
              Imported. Left out or changed:
              <ul className="mt-1 list-disc pl-4 space-y-0.5 max-h-32 overflow-y-auto">
                {notes.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PresetIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path strokeLinecap="round" d="M10 4v16M10 11h11" />
    </svg>
  );
}
