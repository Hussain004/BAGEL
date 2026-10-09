import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveStore, type LiveStatus } from '../../../store/liveStore';
import type { LiveConnection } from '../../../live/liveConnection';
import { formatFileSize } from '../../../utils/bytes';
import { downloadBytes } from '../../../utils/clipEncoder';
import { formatNumber } from './format';

interface RecordButtonProps {
  bagId: string;
  liveConn: LiveConnection | null;
  status: LiveStatus;
}

export function RecordButton({ bagId, liveConn, status }: RecordButtonProps) {
  const recordingStats = useLiveStore((s) => s.recording.get(bagId));
  const isRecording = recordingStats !== undefined;
  const [finishing, setFinishing] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  // null = record all; a Set means record only those topics.
  const [topicFilter, setTopicFilter] = useState<Set<string> | null>(null);

  const allTopics = liveConn?.summary.topics.map((t) => t.name) ?? [];

  const onStop = useCallback(async () => {
    if (!liveConn || finishing) return;
    setFinishing(true);
    try {
      const bytes = await liveConn.stopRecording();
      const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
      downloadBytes(bytes, `bagel-recording-${ts}.mcap`);
    } finally {
      setFinishing(false);
    }
  }, [liveConn, finishing]);

  // Auto-stop when the buffer hits the 500 MB limit. Runs in an effect
  // rather than during render: onStop starts an async download and flips
  // state, neither of which belongs in the render path, and calling it on
  // every qualifying render could invoke liveConn.stopRecording() more than
  // once (it throws "Not recording" after the first successful call).
  // autoStoppedRef limits it to one attempt per recording session so a
  // failed stop cannot loop.
  const isFull = recordingStats?.isFull ?? false;
  const autoStoppedRef = useRef(false);
  useEffect(() => {
    if (!isRecording) {
      autoStoppedRef.current = false;
      return;
    }
    if (!isFull || finishing || autoStoppedRef.current) return;
    autoStoppedRef.current = true;
    void onStop();
  }, [isFull, isRecording, finishing, onStop]);

  if (finishing) {
    return (
      <button
        disabled
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-border text-text-muted cursor-not-allowed"
        aria-label="Saving recording"
      >
        <span className="w-2 h-2 rounded-full bg-accent-rose animate-pulse flex-shrink-0" />
        <span className="hidden xl:inline">Saving…</span>
      </button>
    );
  }

  if (isRecording) {
    const nearFull = recordingStats.byteCount > 400 * 1024 * 1024;
    return (
      <button
        onClick={onStop}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-colors ${
          nearFull
            ? 'border-accent-amber/60 bg-accent-amber/10 text-accent-amber hover:bg-accent-amber/15'
            : 'border-accent-rose/40 bg-accent-rose/10 text-accent-rose hover:bg-accent-rose/15'
        }`}
        title={`Recording - ${formatNumber(recordingStats.messageCount)} messages, ${formatFileSize(recordingStats.byteCount)}${nearFull ? ' (approaching 500 MB limit)' : ''}. Click to stop and download.`}
        aria-label="Stop recording and download MCAP"
      >
        <span className={`w-2 h-2 rounded-full animate-pulse flex-shrink-0 ${nearFull ? 'bg-accent-amber' : 'bg-accent-rose'}`} />
        <span className="tabular-nums hidden xl:inline">
          {formatFileSize(recordingStats.byteCount)}
        </span>
      </button>
    );
  }

  const filterCount = topicFilter?.size ?? null;
  const filterLabel = filterCount !== null ? `${filterCount}/${allTopics.length}` : null;

  return (
    <div className="flex items-center gap-1">
      {/* Topic filter picker */}
      {allTopics.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setShowPicker((v) => !v)}
            className={`w-7 h-7 rounded-md flex items-center justify-center text-xs border transition-colors ${
              status === 'connected'
                ? filterCount !== null
                  ? 'border-accent-violet/50 bg-accent-violet/10 text-accent-violet hover:bg-accent-violet/15'
                  : 'border-border text-text-tertiary hover:text-text-secondary hover:bg-surface-hover'
                : 'border-border text-text-muted opacity-40 cursor-not-allowed'
            }`}
            disabled={status !== 'connected'}
            title={filterCount !== null ? `Recording ${filterCount} of ${allTopics.length} topics. Click to change.` : 'Filter topics to record'}
            aria-label="Filter topics to record"
            aria-expanded={showPicker}
            aria-haspopup="listbox"
          >
            {filterCount !== null ? (
              <span className="text-[10px] font-medium leading-none">{filterLabel}</span>
            ) : (
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 8h10M11 12h2M13 16h-2" />
              </svg>
            )}
          </button>
          {showPicker && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowPicker(false)} aria-hidden="true" />
              <TopicFilterPicker
                topics={allTopics}
                selected={topicFilter}
                onChange={(s) => setTopicFilter(s)}
                onClose={() => setShowPicker(false)}
              />
            </>
          )}
        </div>
      )}

      {/* Record button */}
      <button
        onClick={() => liveConn?.startRecording(topicFilter)}
        disabled={status !== 'connected'}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-[background-color,border-color,color,opacity] ${
          status === 'connected'
            ? 'border-border text-text-secondary hover:text-accent-rose hover:bg-accent-rose/10 hover:border-accent-rose/40'
            : 'border-border text-text-muted cursor-not-allowed opacity-50'
        }`}
        title={
          status === 'connected'
            ? filterCount !== null
              ? `Record ${filterCount} selected topics to MCAP`
              : 'Record live data to MCAP - capture all incoming messages and download when stopped'
            : 'Connect to a live robot first to enable recording'
        }
        aria-label="Record live data"
      >
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
        </svg>
        <span className="hidden xl:inline">Record</span>
      </button>
    </div>
  );
}

function TopicFilterPicker({
  topics,
  selected,
  onChange,
  onClose,
}: {
  topics: string[];
  selected: Set<string> | null;
  onChange: (s: Set<string> | null) => void;
  onClose: () => void;
}) {
  const allSelected = selected === null;
  const effectiveSet = selected ?? new Set(topics);

  const toggleAll = () => {
    // null = record every topic (no filter); a Set records only those
    // listed. Unchecking "All" clears the selection (an empty set records
    // nothing), checking it drops back to null.
    onChange(allSelected ? new Set<string>() : null);
  };

  const toggleTopic = (topic: string) => {
    const next = new Set(effectiveSet);
    if (next.has(topic)) next.delete(topic);
    else next.add(topic);
    // If all topics are selected again, revert to null (all). An empty set
    // is a legal "record nothing" state, so it passes through unchanged.
    onChange(next.size === topics.length ? null : next);
  };

  return (
    <div
      role="listbox"
      aria-label="Topics to record"
      aria-multiselectable="true"
      className="absolute right-0 top-full mt-1 z-40 w-64 rounded-lg border border-border bg-bg-secondary shadow-panel text-xs"
    >
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <input
          type="checkbox"
          id="record-all-topics"
          checked={allSelected}
          onChange={toggleAll}
          className="accent-accent-blue"
        />
        <label htmlFor="record-all-topics" className="text-text-primary font-medium cursor-pointer select-none">
          All topics {allSelected ? '' : `(${effectiveSet.size}/${topics.length} selected)`}
        </label>
      </div>
      <div className="max-h-52 overflow-y-auto py-1">
        {topics.map((topic) => {
          const checked = effectiveSet.has(topic);
          return (
            <label
              key={topic}
              className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-surface-hover transition-colors select-none"
              role="option"
              aria-selected={checked}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleTopic(topic)}
                className="accent-accent-blue flex-shrink-0"
              />
              <span className="mono text-text-secondary truncate" title={topic}>{topic}</span>
            </label>
          );
        })}
      </div>
      <div className="px-3 py-1.5 border-t border-border">
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text-primary text-[10px] transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}
