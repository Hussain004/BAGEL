import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ModalShell } from './ModalShell';
import { useUiStore } from '../../store/uiStore';
import { buildCommands, type Command } from '../../utils/commands';
import { fuzzyFilter } from '../../utils/fuzzy';

/**
 * How many results to keep. The command list is built fresh on every open, so
 * a bag with 400 topics produces 800+ entries; capping the rendered set keeps
 * the DOM small without anyone noticing, since nobody scrolls past 50 results.
 */
const MAX_RESULTS = 50;

/**
 * CommandPalette - Cmd/Ctrl+K.
 *
 * BAGEL has accumulated actions across a toolbar, six modals, per-panel cards,
 * and roughly a dozen single-key shortcuts. That is a lot to hold in your head,
 * and a palette is the standard fix: one place, keyboard-only, searchable.
 *
 * Accessibility notes, since a palette is exactly the component that usually
 * gets this wrong:
 *  - The input keeps DOM focus for the whole interaction, so typing always
 *    works and the screen reader stays in the text field.
 *  - Selection is communicated with `aria-activedescendant` on the input rather
 *    than by moving focus into the list. That is the standard combobox pattern,
 *    and it means Tab and typing are not fighting over focus.
 *  - `role="listbox"` / `role="option"` with ids the input points at.
 *  - Arrow keys move the selection, Enter runs it, Escape closes (handled by
 *    ModalShell).
 */
export function CommandPalette() {
  const setModal = useUiStore((s) => s.setModal);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ModalShell deliberately focuses its close button on mount, so `autoFocus`
  // alone loses the race (child effects run before the parent's). Claim focus
  // explicitly in an effect, which is also the only place it is guaranteed to
  // happen after ModalShell's.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const commands = useMemo(() => buildCommands(query), [query]);

  const results = useMemo(
    () => fuzzyFilter(commands, query, (c) => [c.label, ...(c.keywords ?? [])], MAX_RESULTS),
    [commands, query],
  );

  // A new query invalidates the previous selection index; clamping here rather
  // than in every setQuery call means arrow keys can never select past the end.
  const activeIndex = Math.min(selected, Math.max(0, results.length - 1));

  const runCommand = useCallback(
    (command: Command) => {
      // Close first so a command that opens a modal does not stack the palette
      // underneath it, and so ModalShell's focus restore lands on the trigger.
      setModal(null);
      command.run();
    },
    [setModal],
  );

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    const option = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    option?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((current) => Math.min(current + 1, results.length - 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Home' && results.length > 0) {
      event.preventDefault();
      setSelected(0);
      return;
    }
    if (event.key === 'End' && results.length > 0) {
      event.preventDefault();
      setSelected(results.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = results[activeIndex]?.item;
      if (command) runCommand(command);
      return;
    }
    // Escape closes the palette immediately.
    //
    // ModalShell's own Escape handling blurs a focused text field first rather
    // than closing, so a dialog containing an input takes two presses to
    // dismiss. That is right for a form (it protects what you typed) and wrong
    // here: dismissing a search field is the expected consequence of Escape, and
    // requiring a second press makes the palette feel stuck. Consume the key
    // before it reaches the window handler.
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setModal(null);
    }
  };

  const activeId = results[activeIndex]
    ? `palette-option-${results[activeIndex].item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
    : undefined;

  // Group headers, inserted as we walk the ranked list. Ranks interleave groups
  // by design (the best match wins, wherever it is), so a header appears only
  // when consecutive results share one.
  //
  // Computed up front rather than by mutating a variable inside the map: doing
  // it during render is exactly the kind of thing the react-hooks rules are
  // there to catch, and it is also wrong under concurrent rendering.
  const rows = useMemo(() => {
    const seen = new Set<string>();
    return results.map(({ item }, index) => {
      const showHeader = !seen.has(item.group);
      seen.add(item.group);
      return { item, index, showHeader };
    });
  }, [results]);

  return (
    <ModalShell title="Command palette" subtitle="Search topics, actions, and go-to targets" onClose={() => setModal(null)} width="md">
      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Type a topic, an action, or a time in seconds"
          aria-label="Search commands"
          aria-controls="palette-results"
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          spellCheck={false}
          autoComplete="off"
          className="px-3 py-2 rounded-md bg-bg-primary border border-border text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/60"
        />

        <ul
          ref={listRef}
          id="palette-results"
          role="listbox"
          aria-label="Command results"
          className="max-h-[46vh] overflow-y-auto flex flex-col"
        >
          {results.length === 0 && (
            <li className="px-3 py-4 text-xs text-text-muted text-center">
              No matching command
            </li>
          )}

          {rows.map(({ item, index, showHeader }) => {
            const optionId = `palette-option-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
            const isActive = index === activeIndex;
            return (
              <li key={item.id}>
                {showHeader && (
                  <div
                    aria-hidden="true"
                    className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-text-muted mono"
                  >
                    {item.group}
                  </div>
                )}
                <div
                  id={optionId}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => runCommand(item)}
                  className={`px-3 py-2 rounded-md cursor-pointer flex items-baseline gap-3 ${
                    isActive ? 'bg-accent-blue/15 text-text-primary' : 'text-text-secondary'
                  }`}
                >
                  <span className="text-sm truncate flex-1 min-w-0">{item.label}</span>
                  {item.hint && (
                    <span className="text-[11px] mono text-text-muted truncate max-w-[45%]">{item.hint}</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-3 px-1 text-[11px] text-text-muted">
          <span>
            <kbd className="mono">↑</kbd> <kbd className="mono">↓</kbd> navigate
          </span>
          <span>
            <kbd className="mono">Enter</kbd> run
          </span>
          <span>
            <kbd className="mono">Esc</kbd> close
          </span>
          {results.length >= MAX_RESULTS && <span className="ml-auto">showing first {MAX_RESULTS}</span>}
        </div>
      </div>
    </ModalShell>
  );
}