import { useState } from 'react';
import { useMessageAtTime } from '../../../hooks/useMessageAtTime';
import { useBagStore, resolveBagEntry } from '../../../store/bagStore';
import { useBagLocalPlayhead } from '../../../hooks/useBagLocalPlayhead';
import { toHexDump } from '../../../utils/bytes';
import { nsToSeconds } from '../../../utils/time';
import { PanelShell } from '../PanelShell';
import { PanelLoadingState, PanelErrorState, PanelEmptyState } from '../shared/PanelStates';
import { getTopicColor } from '../../../utils/color';

interface RawMessageInspectorProps {
  panelId: string;
  topicName: string;
  type: string;
  bagId?: string;
}

/**
 * RawMessageInspector — Shows the deserialized message at the current
 * playhead time as a JSON tree. Falls back to hex when the type isn't in
 * the registry. Reads just the message at the playhead via
 * useMessageAtTime — never preloads the whole topic.
 */
export function RawMessageInspector({ panelId, topicName, type, bagId }: RawMessageInspectorProps) {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const bag = entry?.summary ?? null;
  const playheadNs = useBagLocalPlayhead(bagId);
  const { message, loading, error } = useMessageAtTime(topicName, playheadNs, bagId);

  const startNs = bag?.startTime ?? 0n;
  const showInitialLoading = loading && !message;

  return (
    <PanelShell
      panelId={panelId}
      kind="raw"
      topicName={topicName}
      type={type}
      accentColor={getTopicColor(topicName, type)}
      bagId={bagId}
    >
      {showInitialLoading && <PanelLoadingState message="Decoding messages…" />}
      {error && !message && <PanelErrorState title="Failed to load messages" message={error} />}
      {!loading && !error && !message && (
        <PanelEmptyState message="No messages on this topic." />
      )}
      {message && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-auto px-4 py-3 mono text-xs relative">
            {message.value ? (
              <JsonTree value={message.value} depth={0} />
            ) : (
              <div className="text-text-muted whitespace-pre">
                <div className="mb-2 text-accent-amber">
                  Could not deserialize this message — type not in the built-in registry.
                </div>
                <pre className="text-text-secondary">{placeholder}</pre>
              </div>
            )}
            {loading && (
              <div
                className="absolute top-2 right-2 w-3.5 h-3.5 text-accent-blue animate-spin-slow"
                title="Loading newer message…"
              >
                <svg fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            )}
          </div>

          <div className="px-4 py-1.5 border-t border-border flex items-center justify-end text-text-muted text-xs mono">
            <span>t = {nsToSeconds(message.timestamp - startNs).toFixed(3)}s</span>
          </div>
        </div>
      )}
    </PanelShell>
  );
}

const placeholder = '(raw bytes unavailable in this view)';

interface JsonTreeProps {
  value: unknown;
  depth: number;
  keyName?: string;
}

function JsonTree({ value, depth, keyName }: JsonTreeProps) {
  if (value == null) {
    return <Leaf keyName={keyName} text="null" className="text-text-muted" />;
  }
  if (typeof value === 'boolean') {
    return <Leaf keyName={keyName} text={String(value)} className="text-accent-violet" />;
  }
  if (typeof value === 'number') {
    return <Leaf keyName={keyName} text={String(value)} className="text-accent-cyan" />;
  }
  if (typeof value === 'bigint') {
    return <Leaf keyName={keyName} text={`${value.toString()}n`} className="text-accent-cyan" />;
  }
  if (typeof value === 'string') {
    return (
      <Leaf
        keyName={keyName}
        text={`"${value.length > 200 ? value.slice(0, 200) + '…' : value}"`}
        className="text-accent-emerald"
      />
    );
  }
  if (value instanceof Uint8Array) {
    return (
      <CollapsibleNode keyName={keyName} summary={`Uint8Array(${value.length})`}>
        <pre className="text-text-tertiary leading-relaxed">{toHexDump(value, 128)}</pre>
      </CollapsibleNode>
    );
  }
  if (Array.isArray(value)) {
    const preview =
      value.length > 0 && value.length <= 8 && value.every((v) => typeof v === 'number')
        ? `[${value.join(', ')}]`
        : `Array(${value.length})`;
    return (
      <CollapsibleNode keyName={keyName} summary={preview} startOpen={depth < 2 && value.length <= 8}>
        {value.map((v, i) => (
          <JsonTree key={i} value={v} depth={depth + 1} keyName={String(i)} />
        ))}
      </CollapsibleNode>
    );
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <CollapsibleNode
        keyName={keyName}
        summary={`{${entries.length} field${entries.length === 1 ? '' : 's'}}`}
        startOpen={depth < 2}
      >
        {entries.map(([k, v]) => (
          <JsonTree key={k} value={v} depth={depth + 1} keyName={k} />
        ))}
      </CollapsibleNode>
    );
  }
  return <Leaf keyName={keyName} text={String(value)} />;
}

function Leaf({
  keyName,
  text,
  className,
}: {
  keyName?: string;
  text: string;
  className?: string;
}) {
  return (
    <div className="flex gap-2 leading-relaxed">
      {keyName !== undefined && (
        <span className="text-text-secondary">{keyName}:</span>
      )}
      <span className={className ?? 'text-text-primary'}>{text}</span>
    </div>
  );
}

function CollapsibleNode({
  keyName,
  summary,
  startOpen = false,
  children,
}: {
  keyName?: string;
  summary: string;
  startOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(startOpen);

  return (
    <div className="leading-relaxed">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-left hover:bg-surface-hover rounded px-1"
      >
        <span className="w-3 text-text-tertiary">{open ? '▾' : '▸'}</span>
        {keyName !== undefined && <span className="text-text-secondary">{keyName}:</span>}
        <span className="text-text-tertiary">{summary}</span>
      </button>
      {open && <div className="pl-5 border-l border-border ml-1.5">{children}</div>}
    </div>
  );
}

