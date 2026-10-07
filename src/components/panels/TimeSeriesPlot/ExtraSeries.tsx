import { useEffect, useMemo, useState } from 'react';
import { useBagStore } from '../../../store/bagStore';
import { useTopicMessages, type DecodedMessage } from '../../../hooks/useTopicMessages';
import { readMessageAtTime } from '../../../parsers';
import { flattenNumeric } from '../../../utils/messages';
import { defaultAlias, extraKey } from '../../../utils/alignSeries';
import type { ExtraSeriesDef } from '../../../store/panelUiStores';

/** What the plot needs to know about one extra topic's decode. */
export interface ExtraState {
  messages: DecodedMessage[] | null;
  loading: boolean;
  error: string | null;
}

/** Expression names: same shape as an identifier, so `a_b - c_d` parses. */
const ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Loads one extra topic and reports it upward. A component rather than a hook
 * call in the plot because the number of extra topics changes at runtime and
 * hooks cannot be called in a loop.
 */
export function ExtraSeriesLoader({
  bagId,
  topic,
  limit,
  onState,
}: {
  bagId: string;
  topic: string;
  limit: number;
  onState: (key: string, state: ExtraState | null) => void;
}) {
  const { messages, loading, error } = useTopicMessages(topic, limit, true, bagId);
  const key = extraKey(bagId, topic);
  useEffect(() => {
    onState(key, { messages, loading, error });
  }, [key, messages, loading, error, onState]);
  useEffect(() => () => onState(key, null), [key, onState]);
  return null;
}

interface PickerProps {
  /** Aliases already used by this panel's fields, expressions and extras. */
  takenAliases: ReadonlySet<string>;
  /** Bag the panel itself plots, preselected. */
  defaultBagId: string | undefined;
  onAdd: (def: Omit<ExtraSeriesDef, 'id'>) => void;
  onCancel: () => void;
}

/**
 * Inline form: pick a topic (from any loaded bag), then one of its numeric
 * fields. Fields come from the topic's first message, which is enough because
 * the same schema applies to every message on a topic.
 */
export function ExtraSeriesPicker({ takenAliases, defaultBagId, onAdd, onCancel }: PickerProps) {
  const bags = useBagStore((s) => s.bags);
  const bagOrder = useBagStore((s) => s.bagOrder);
  const candidates = useMemo(
    () =>
      bagOrder
        .map((id) => bags.get(id))
        .filter((e): e is NonNullable<typeof e> => !!e && e.kind !== 'live' && !!e.source),
    [bags, bagOrder],
  );

  const [bagId, setBagId] = useState(defaultBagId ?? candidates[0]?.id ?? '');
  const [topic, setTopic] = useState('');
  const [field, setField] = useState('');
  const [aliasEdit, setAliasEdit] = useState<string | null>(null);
  const [sample, setSample] = useState<{ key: string; names: string[]; error?: string } | null>(null);

  const entry = candidates.find((e) => e.id === bagId) ?? candidates[0];
  const topicInfo = entry?.summary.topics.find((t) => t.name === topic);
  const sampleKey = entry && topicInfo ? extraKey(entry.id, topicInfo.name) : '';

  useEffect(() => {
    if (!entry || !topicInfo || !entry.source) return;
    let cancelled = false;
    const key = extraKey(entry.id, topicInfo.name);
    readMessageAtTime(entry.id, entry.source, entry.summary.format, topicInfo.name, entry.summary.startTime)
      .then((msg) => {
        if (cancelled) return;
        const names = msg?.value ? Object.keys(flattenNumeric(msg.value)) : [];
        setSample({ key, names });
        setField(names[0] ?? '');
        setAliasEdit(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSample({ key, names: [], error: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [entry, topicInfo]);

  const ready = sample?.key === sampleKey && !!sampleKey;
  const fields = ready ? sample.names : [];
  const alias = aliasEdit ?? (topicInfo && field ? defaultAlias(topicInfo.name, field, takenAliases) : '');
  const aliasError = !alias
    ? null
    : !ALIAS_PATTERN.test(alias)
      ? 'Letters, digits and _ only; cannot start with a digit.'
      : takenAliases.has(alias)
        ? 'That name is already used in this plot.'
        : null;
  const canAdd = !!entry && !!topicInfo && !!field && !!alias && !aliasError;

  const submit = () => {
    if (!canAdd || !entry || !topicInfo) return;
    onAdd({ bagId: entry.id, topic: topicInfo.name, field, alias });
  };

  const inputCls =
    'bg-surface border border-border rounded-md px-2 py-1 text-xs mono text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-blue/60';

  return (
    <div
      className="space-y-1"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {candidates.length > 1 && (
          <select
            aria-label="Bag"
            value={entry?.id ?? ''}
            onChange={(e) => {
              setBagId(e.target.value);
              setTopic('');
              setField('');
            }}
            className={inputCls}
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary.fileName}
              </option>
            ))}
          </select>
        )}
        <input
          autoFocus
          list="extra-series-topics"
          aria-label="Topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="topic, e.g. /cmd_vel"
          className={`${inputCls} flex-1 min-w-[140px]`}
        />
        <datalist id="extra-series-topics">
          {entry?.summary.topics.map((t) => (
            <option key={t.name} value={t.name} />
          ))}
        </datalist>
        <select
          aria-label="Field"
          value={field}
          onChange={(e) => {
            setField(e.target.value);
            setAliasEdit(null);
          }}
          disabled={fields.length === 0}
          className={`${inputCls} max-w-[200px]`}
        >
          {fields.length === 0 && <option value="">{topicInfo ? (ready ? 'no numeric fields' : 'loading…') : 'field'}</option>}
          {fields.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <input
          aria-label="Name in expressions"
          value={alias}
          onChange={(e) => setAliasEdit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          className={`${inputCls} w-36`}
          title="The name to use for this series in math expressions"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!canAdd}
          className="px-2 py-1 rounded-md text-xs mono bg-accent-blue/10 border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/15 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-2 py-1 rounded-md text-xs mono border border-border text-text-muted hover:border-border-hover transition-colors"
        >
          Cancel
        </button>
      </div>
      {aliasError && <p className="text-xs mono text-accent-rose px-1">{aliasError}</p>}
      {ready && sample.error && <p className="text-xs mono text-accent-rose px-1">{sample.error}</p>}
      {topic && !topicInfo && entry && (
        <p className="text-xs mono text-text-muted px-1">Pick a topic from the list.</p>
      )}
    </div>
  );
}
