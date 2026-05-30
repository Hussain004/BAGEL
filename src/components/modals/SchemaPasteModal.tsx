import { useEffect, useRef, useState } from 'react';
import { ModalShell } from './ModalShell';
import { useUiStore } from '../../store/uiStore';
import { useCustomSchemaStore } from '../../store/customSchemaStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useBagStore } from '../../store/bagStore';
import { validateSchema } from '../../parsers';

/**
 * SchemaPasteModal — Adds (or replaces) a custom `.msg` definition for a
 * ROS2 type so a `.db3` bag carrying that type can decode.
 *
 * Flow:
 *  1. Pre-populates with the existing schema text if the user is editing.
 *  2. On Save: validates by parsing through the worker (no commit on parse
 *     failure — we'd rather the user see the underlying error than ship a
 *     broken schema into localStorage).
 *  3. Persists via `customSchemaStore` (localStorage-backed), which the
 *     `useCustomSchemaSync` hook in App.tsx mirrors to the worker.
 *  4. If a `followupPanelKind` was supplied (the user got here by clicking a
 *     schema-missing topic), opens that panel automatically so they don't
 *     have to click again.
 *
 * Format: concatenated `.msg` text matching the convention `mcap convert`
 * uses i.e., primary type at the top, then each dependency separated by an
 * `=====` line followed by `MSG: pkg/Type` and that type's fields. This is
 * the same shape `@foxglove/rosmsg.parse(... { ros2: true })` expects.
 */
export function SchemaPasteModal() {
  const target = useUiStore((s) => s.schemaPaste);
  const closeSchemaPaste = useUiStore((s) => s.closeSchemaPaste);
  const existingSchema = useCustomSchemaStore((s) =>
    target ? (s.schemas[target.typeName] ?? '') : '',
  );
  const setSchema = useCustomSchemaStore((s) => s.setSchema);
  const openPanel = useLayoutStore((s) => s.openPanel);
  const bag = useBagStore((s) => s.bag);

  const [text, setText] = useState(existingSchema);
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Pre-populate once on open. We intentionally don't reset when the user
  // types — that would erase their edit on every keystroke via state-derived
  // re-renders.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    setText(existingSchema);
  }, [existingSchema]);

  // Focus the textarea on open so the user can paste immediately. The
  // ModalShell focuses its close button first; we override on the next tick.
  useEffect(() => {
    const t = window.setTimeout(() => textareaRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, []);

  if (!target) return null;

  const onSave = async () => {
    setError(null);
    const trimmed = text.trim();
    if (!trimmed) {
      setError('Schema text is empty.');
      return;
    }
    setValidating(true);
    try {
      const result = await validateSchema(trimmed);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSchema(target.typeName, trimmed);
      // Open the panel the user wanted before they got side-tracked. We
      // need the topic's actual ROS type for layoutStore, which is what
      // the bag's topic table holds.
      if (target.followupPanelKind && target.topicName && bag) {
        const topic = bag.topics.find((t) => t.name === target.topicName);
        if (topic) {
          openPanel({
            kind: target.followupPanelKind,
            topicName: topic.name,
            type: topic.type,
            bagId: target.bagId,
          });
        }
      }
      closeSchemaPaste();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setValidating(false);
    }
  };

  // Ctrl/Cmd+Enter saves — common paste-modal convention.
  const onTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void onSave();
    }
  };

  const subtitle = target.topicName
    ? `topic ${target.topicName}`
    : 'custom message definition';

  return (
    <ModalShell
      title={target.typeName}
      subtitle={subtitle}
      width="lg"
      onClose={closeSchemaPaste}
    >
      <div className="px-6 py-4 space-y-3 text-sm">
        <p className="text-text-secondary leading-relaxed">
          ROS2 <code className="mono text-text-primary">.db3</code> files don't
          embed message schemas, so BAGEL can't decode types outside the
          bundled <code className="mono text-text-primary">ros2galactic</code>{' '}
          set (std/geometry/sensor/nav/tf2/visualization/etc.) without one.
          Paste the <code className="mono text-text-primary">.msg</code>{' '}
          definition for this type i.e., primary type at the top, then every
          dependency block separated by{' '}
          <code className="mono text-text-primary">=====</code>, the same form{' '}
          <code className="mono text-text-primary">mcap convert</code> writes.
        </p>
        <details className="text-xs text-text-tertiary">
          <summary className="cursor-pointer hover:text-text-secondary select-none">
            example
          </summary>
          <pre className="mt-2 p-3 rounded-md bg-bg-primary border border-border mono text-[10px] whitespace-pre overflow-x-auto">{`std_msgs/Header header
geometry_msgs/Pose pose
================================================================================
MSG: std_msgs/Header
builtin_interfaces/Time stamp
string frame_id
================================================================================
MSG: geometry_msgs/Pose
geometry_msgs/Point position
geometry_msgs/Quaternion orientation
================================================================================
MSG: geometry_msgs/Point
float64 x
float64 y
float64 z
================================================================================
MSG: geometry_msgs/Quaternion
float64 x
float64 y
float64 z
float64 w
================================================================================
MSG: builtin_interfaces/Time
int32 sec
uint32 nanosec`}</pre>
        </details>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={onTextareaKeyDown}
          placeholder="Paste the .msg definition here…"
          className="w-full h-64 px-3 py-2 rounded-md bg-bg-primary border border-border focus:border-accent-blue/60 focus:ring-1 focus:ring-accent-blue/30 focus:outline-none mono text-xs text-text-primary placeholder:text-text-muted resize-y"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
        />
        {error && (
          <div className="px-3 py-2 rounded-md border border-accent-rose/30 bg-accent-rose/10 text-accent-rose text-xs mono whitespace-pre-wrap break-words">
            {error}
          </div>
        )}
        <div className="text-xs text-text-tertiary">
          Saved schemas live in your browser only (localStorage) and apply to
          every future bag that mentions this type. Already-open panels need
          a close + reopen to pick up the new schema.
        </div>
      </div>
      <footer className="px-6 py-3 border-t border-border bg-surface/40 flex items-center justify-end gap-2 flex-shrink-0">
        <button
          onClick={closeSchemaPaste}
          className="px-3 py-1.5 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={validating}
          className="px-3 py-1.5 rounded-md text-sm bg-accent-blue/15 text-accent-blue border border-accent-blue/40 hover:bg-accent-blue/25 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60 disabled:opacity-60 disabled:cursor-progress flex items-center gap-2"
        >
          {validating && (
            <svg
              className="w-3.5 h-3.5 animate-spin-slow"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          {validating ? 'Validating…' : 'Save schema'}
        </button>
      </footer>
    </ModalShell>
  );
}
