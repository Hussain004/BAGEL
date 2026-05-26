import { useMemo } from 'react';
import { useUiStore } from '../../store/uiStore';
import { SHORTCUTS, type ShortcutDescription } from '../../hooks/useKeyboardShortcuts';
import { ModalShell } from './ModalShell';

/**
 * ShortcutsModal — Lists every global keyboard shortcut, grouped by purpose.
 *
 * Source of truth is `SHORTCUTS` in `useKeyboardShortcuts.ts`, so adding a
 * new binding there shows up here automatically.
 */
export function ShortcutsModal() {
  const setModal = useUiStore((s) => s.setModal);
  const groups = useMemo(() => groupByGroup(SHORTCUTS), []);
  return (
    <ModalShell
      title="Keyboard shortcuts"
      subtitle="Faster than reaching for the mouse."
      onClose={() => setModal(null)}
      width="md"
    >
      <div className="px-6 py-5 space-y-5">
        {groups.map(([group, items]) => (
          <section key={group}>
            <h3 className="text-text-tertiary text-[10px] uppercase tracking-widest mb-2">
              {group}
            </h3>
            <div className="rounded-lg border border-border overflow-hidden">
              {items.map((s, i) => (
                <div
                  key={s.keys}
                  className={`flex items-center justify-between gap-4 px-4 py-2 ${
                    i % 2 === 0 ? 'bg-surface/30' : 'bg-surface/10'
                  }`}
                >
                  <span className="text-text-secondary text-sm">{s.description}</span>
                  <Kbd keys={s.keys} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </ModalShell>
  );
}

function groupByGroup(items: ShortcutDescription[]): [string, ShortcutDescription[]][] {
  const order = ['Playback', 'Panels', 'Navigation', 'Help'] as const;
  const map = new Map<string, ShortcutDescription[]>();
  for (const item of items) {
    const arr = map.get(item.group) ?? [];
    arr.push(item);
    map.set(item.group, arr);
  }
  return order.filter((g) => map.has(g)).map((g) => [g, map.get(g)!]);
}

/** Render a key combo string like "Shift + ←  →" as styled <kbd> tokens. */
function Kbd({ keys }: { keys: string }) {
  // Split on " + " (combo separator) but keep spaces inside individual tokens
  // for things like "←  →".
  const tokens = keys.split(/\s\+\s/);
  return (
    <span className="flex items-center gap-1 flex-shrink-0">
      {tokens.map((t, i) => (
        <span key={`${t}-${i}`} className="flex items-center gap-1">
          {i > 0 && <span className="text-text-muted text-xs">+</span>}
          <kbd className="px-2 py-0.5 rounded-md border border-border bg-surface text-text-primary text-xs mono font-medium shadow-sm">
            {t}
          </kbd>
        </span>
      ))}
    </span>
  );
}
