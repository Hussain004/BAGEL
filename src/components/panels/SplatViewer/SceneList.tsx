import { useRef } from 'react';

export interface SceneInfo {
  name: string;
  count: number;
}

export interface SceneTransform {
  x: number;
  y: number;
  z: number;
  scale: number;
}

interface Props {
  scenes: SceneInfo[];
  active: number;
  onPick: (index: number) => void;
  onRemove: (index: number) => void;
  onAddFiles: (files: File[]) => void;
  adding: boolean;
  error: string | null;
  /** Current transform of a scene, read from the viewer (not React state, so it follows the spin keys). */
  readTransform: (index: number) => SceneTransform | null;
  onTransform: (index: number, patch: Partial<SceneTransform>) => void;
}

const AXES = ['x', 'y', 'z'] as const;

/**
 * The splat files in a panel. The first is the bag's own; others are added by
 * hand and can be moved, scaled and removed. The spin keys and V act on the
 * active scene.
 */
export function SceneList({ scenes, active, onPick, onRemove, onAddFiles, adding, error, readTransform, onTransform }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const transform = readTransform(active);
  return (
    <div
      className="w-56 rounded-md border border-border bg-surface/90 p-1.5 text-[10px] mono text-text-secondary flex flex-col gap-1"
      data-testid="splat-scenes"
    >
      <div className="flex items-center justify-between">
        <span className="text-text-tertiary">{scenes.length === 1 ? '1 scene' : `${scenes.length} scenes`}</span>
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={adding}
          className="px-1.5 py-0.5 rounded border border-border hover:border-accent-blue/40 hover:text-accent-blue disabled:opacity-50 transition-colors"
          title="Add another splat file to this scene (or drop one on the panel)"
        >
          {adding ? 'Adding...' : 'Add splat'}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept=".ply,.splat,.ksplat,.spz"
          className="hidden"
          data-testid="splat-add-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length > 0) onAddFiles(files);
          }}
        />
      </div>

      <ul className="flex flex-col gap-0.5" aria-label="Splat scenes">
        {scenes.map((scene, i) => (
          <li key={`${i}:${scene.name}`} className={`flex items-center gap-1 rounded px-1 py-0.5 ${i === active ? 'bg-accent-blue/15' : ''}`}>
            <button
              type="button"
              className="flex-1 min-w-0 flex items-center gap-1 text-left"
              onClick={() => onPick(i)}
              aria-pressed={i === active}
              title={`${scene.name}: ${scene.count.toLocaleString()} splats. Select to move it; the spin keys act on it.`}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${i === active ? 'bg-accent-blue' : 'bg-border'}`} />
              <span className="truncate">{scene.name}</span>
              <span className="text-text-muted flex-shrink-0">{scene.count.toLocaleString()}</span>
            </button>
            {i > 0 && (
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="text-text-muted hover:text-accent-rose flex-shrink-0 px-0.5"
                aria-label={`Remove ${scene.name}`}
                title="Remove this splat"
              >
                x
              </button>
            )}
          </li>
        ))}
      </ul>

      {transform && (
        <div className="grid grid-cols-4 gap-1 pt-0.5" aria-label="Active scene position and scale">
          {AXES.map((axis) => (
            <label key={axis} className="flex flex-col gap-0.5">
              <span className="text-text-muted">{axis}</span>
              <input
                type="number"
                step={0.1}
                value={Number(transform[axis].toFixed(3))}
                onChange={(e) => {
                  const v = e.target.valueAsNumber;
                  if (Number.isFinite(v)) onTransform(active, { [axis]: v });
                }}
                className="w-full min-w-0 bg-transparent border border-border rounded px-1 py-0.5"
              />
            </label>
          ))}
          <label className="flex flex-col gap-0.5">
            <span className="text-text-muted">scale</span>
            <input
              type="number"
              step={0.1}
              min={0.01}
              value={Number(transform.scale.toFixed(3))}
              onChange={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isFinite(v) && v > 0) onTransform(active, { scale: v });
              }}
              className="w-full min-w-0 bg-transparent border border-border rounded px-1 py-0.5"
            />
          </label>
        </div>
      )}

      {error && (
        <div className="text-accent-rose" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
