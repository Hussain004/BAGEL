import { useState } from 'react';
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
          </div>
        </>
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
