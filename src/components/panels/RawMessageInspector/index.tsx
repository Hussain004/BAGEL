import { useMemo, useState } from 'react';
import { useTopicMessages } from '../../../hooks/useTopicMessages';
import { usePlayheadStore } from '../../../store/playheadStore';
import { nearestMessageIndex } from '../../../utils/messages';
import { toHexDump } from '../../../utils/bytes';
import { nsToSeconds } from '../../../utils/time';
import { PanelShell } from '../PanelShell';
import { getTopicColor } from '../../../utils/color';

interface RawMessageInspectorProps {
  panelId: string;
  topicName: string;
  type: string;
}

/**
 * RawMessageInspector — Shows the deserialized message at the current playhead
 * time as a JSON tree. Falls back to hex when the type isn't in the registry.
 */
export function RawMessageInspector({ panelId, topicName, type }: RawMessageInspectorProps) {
  const { messages, loading, error } = useTopicMessages(topicName);
  const playheadNs = usePlayheadStore((s) => s.timeNs);

  const currentIndex = useMemo(() => {
    if (!messages || messages.length === 0) return -1;
    return nearestMessageIndex(messages, playheadNs);
  }, [messages, playheadNs]);

  const current = currentIndex >= 0 && messages ? messages[currentIndex] : null;

  return (
    <PanelShell
      panelId={panelId}
      kind="raw"
      topicName={topicName}
      type={type}
      accentColor={getTopicColor(topicName, type)}
    >
      {loading && <Loading />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (!messages || messages.length === 0) && (
        <EmptyState message="No messages on this topic." />
      )}
      {messages && messages.length > 0 && current && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-auto px-4 py-3 mono text-xs">
            {current.value ? (
              <JsonTree value={current.value} depth={0} />
            ) : (
              <div className="text-text-muted whitespace-pre">
                <div className="mb-2 text-accent-amber">
                  Could not deserialize this message — type not in the built-in registry.
                </div>
                <pre className="text-text-secondary">
                  {/* hex dump fallback if the message exposes its raw bytes */}
                  {placeholder}
                </pre>
              </div>
            )}
          </div>

          <div className="px-4 py-1.5 border-t border-border flex items-center justify-between text-text-muted text-xs mono">
            <span>
              message {currentIndex + 1} / {messages.length}
            </span>
            <span>
              t = {nsToSeconds(current.timestamp - messages[0].timestamp).toFixed(3)}s
            </span>
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

function Loading() {
  return (
    <div className="flex-1 flex items-center justify-center text-text-secondary text-sm p-8">
      Decoding messages…
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="text-accent-rose text-sm font-medium">Failed to load messages</div>
      <div className="text-text-secondary text-xs max-w-md">{message}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-text-muted text-sm p-8">
      {message}
    </div>
  );
}
