import { useEffect, useRef, useCallback, useState } from 'react';
import { useBagStore } from '../../store/bagStore';
import { usePlayheadStore } from '../../store/playheadStore';
import { useAnnotationStore, type Annotation } from '../../store/annotationStore';
import { nsToSeconds, formatDuration } from '../../utils/time';

/**
 * Timeline — Global playhead control at the bottom of the main view.
 * Click or drag along the bar to seek; the playhead syncs across all
 * open visualization panels.
 *
 * v1.4.3: annotation ticks rendered on the bar. Double-click the bar to
 * drop a named bookmark; click a tick to seek to it.
 */
export function Timeline() {
  const bag = useBagStore((s) => s.bag);
  const {
    timeNs,
    startNs,
    endNs,
    playing,
    speed,
    loop,
    seekFraction,
    setPlaying,
    setSpeed,
    setLoop,
    tick,
  } = usePlayheadStore();
  const { annotations, addAnnotation, removeAnnotation, updateLabel } = useAnnotationStore();

  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const lastFrameRef = useRef<number | null>(null);
  // Tracks which annotation tick is currently hovered so double-click can
  // rename it instead of creating a new one. Ref (not state) to avoid
  // re-renders on every mouse-enter/leave.
  const hoveredAnnIdRef = useRef<string | null>(null);

  // Inline label-edit state: set to the annotation id whose label is being typed.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  // Pixel offset from track left for positioning the input (clamped on render).
  const [editingX, setEditingX] = useState(0);
  // True when the edit is for a freshly-created annotation (cancel = delete it).
  // False when renaming an existing one (cancel = restore, don't delete).
  const [editingIsNew, setEditingIsNew] = useState(false);

  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // RAF loop for playback.
  useEffect(() => {
    if (!playing) {
      lastFrameRef.current = null;
      return;
    }
    let cancelled = false;
    const step = (t: number) => {
      if (cancelled) return;
      if (lastFrameRef.current != null) {
        const deltaSec = (t - lastFrameRef.current) / 1000;
        tick(deltaSec);
      }
      lastFrameRef.current = t;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    return () => {
      cancelled = true;
    };
  }, [playing, tick]);

  const seekFromEvent = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const fraction = (clientX - rect.left) / rect.width;
      seekFraction(fraction);
    },
    [seekFraction],
  );

  const handlePointerDown = (e: React.PointerEvent) => {
    isDraggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    seekFromEvent(e.clientX);
  };
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    seekFromEvent(e.clientX);
  };
  const handlePointerUp = (e: React.PointerEvent) => {
    isDraggingRef.current = false;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  };

  // Double-click on track -> rename hovered annotation, or add a new one.
  const handleTrackDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();

      // If a tick is currently hovered, rename it instead of creating a new one.
      if (hoveredAnnIdRef.current) {
        const ann = useAnnotationStore.getState().annotations.find(
          (a) => a.id === hoveredAnnIdRef.current,
        );
        if (ann) {
          const ph = usePlayheadStore.getState();
          const range = ph.endNs - ph.startNs;
          const f = range > 0n ? Number(ann.timeNs - ph.startNs) / Number(range) : 0;
          setEditingLabel(ann.label);
          setEditingX(f * rect.width);
          setEditingIsNew(false);
          setEditingId(ann.id);
          return;
        }
      }

      const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const ph = usePlayheadStore.getState();
      const range = ph.endNs - ph.startNs;
      const raw = ph.startNs + BigInt(Math.round(Number(range) * fraction));
      const clamped = raw < ph.startNs ? ph.startNs : raw > ph.endNs ? ph.endNs : raw;
      const anns = useAnnotationStore.getState().annotations;
      const count = anns.length + 1;
      const id = addAnnotation(clamped, `Mark ${count}`);
      setEditingLabel(`Mark ${count}`);
      setEditingX(e.clientX - rect.left);
      setEditingIsNew(true);
      setEditingId(id);
    },
    [addAnnotation],
  );

  // Confirm the inline label edit.
  const commitEdit = useCallback(() => {
    if (!editingId) return;
    const trimmed = editingLabel.trim();
    if (trimmed) {
      updateLabel(editingId, trimmed);
    } else {
      removeAnnotation(editingId);
    }
    setEditingId(null);
  }, [editingId, editingLabel, updateLabel, removeAnnotation]);

  // Cancel the inline label edit.
  // Only delete the annotation if it was just created (Escape on a rename keeps it).
  const cancelEdit = useCallback(() => {
    if (editingId && editingIsNew) removeAnnotation(editingId);
    setEditingId(null);
  }, [editingId, editingIsNew, removeAnnotation]);

  // Add bookmark at current playhead.
  const addBookmarkHere = useCallback(() => {
    const { timeNs: t } = usePlayheadStore.getState();
    const count = useAnnotationStore.getState().annotations.length + 1;
    addAnnotation(t, `Mark ${count}`);
  }, [addAnnotation]);

  // Spacebar toggles playback (when no text input is focused).
  useEffect(() => {
    if (!bag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      setPlaying(!usePlayheadStore.getState().playing);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bag, setPlaying]);

  if (!bag) return null;

  const duration = Number(endNs - startNs) / 1e9;
  const elapsed = Number(timeNs - startNs) / 1e9;
  const fraction = endNs > startNs ? elapsed / duration : 0;

  return (
    <div className="border-t border-border bg-bg-secondary/70 backdrop-blur-md px-4 py-3 flex items-center gap-4 animate-fade-in flex-shrink-0">
      <button
        onClick={() => setPlaying(!playing)}
        className="w-9 h-9 rounded-full flex items-center justify-center bg-accent-blue/15 hover:bg-accent-blue/25 border border-accent-blue/30 text-accent-blue transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
        aria-label={playing ? 'Pause playback' : 'Start playback'}
        id="timeline-play-pause"
      >
        {playing ? (
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg className="w-4 h-4 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      <div className="flex items-center gap-1 mono text-xs text-text-secondary min-w-[140px]">
        <span className="text-text-primary tabular-nums">
          {formatRelative(timeNs - startNs)}
        </span>
        <span className="text-text-muted">/</span>
        <span className="text-text-muted tabular-nums">{formatDuration(duration)}</span>
      </div>

      <div
        ref={trackRef}
        className="flex-1 h-8 flex items-center cursor-pointer select-none group relative"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleTrackDoubleClick}
        id="timeline-track"
        role="slider"
        aria-label="Playhead - drag or use arrow keys to scrub"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration * 1000) / 1000}
        aria-valuenow={Math.round(elapsed * 1000) / 1000}
        aria-valuetext={`${elapsed.toFixed(2)} of ${duration.toFixed(2)} seconds`}
      >
        <div className="w-full h-1.5 rounded-full bg-surface overflow-hidden relative">
          <div
            className="absolute inset-y-0 left-0 progress-bar"
            style={{ width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }}
          />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-glow-blue border border-accent-blue transition-transform group-hover:scale-110"
            style={{ left: `calc(${Math.max(0, Math.min(1, fraction)) * 100}% - 7px)` }}
          />
        </div>

        {/* Annotation ticks */}
        {annotations.map((ann) => {
          const f =
            endNs > startNs
              ? Math.max(0, Math.min(1, Number(ann.timeNs - startNs) / Number(endNs - startNs)))
              : 0;
          return (
            <AnnotationTick
              key={ann.id}
              annotation={ann}
              fraction={f}
              isEditing={editingId === ann.id}
              onSeek={() => usePlayheadStore.getState().seek(ann.timeNs)}
              onRemove={() => removeAnnotation(ann.id)}
              onRename={() => {
                setEditingLabel(ann.label);
                setEditingX(f * (trackRef.current?.clientWidth ?? 300));
                setEditingIsNew(false);
                setEditingId(ann.id);
              }}
              onHoverChange={(id) => { hoveredAnnIdRef.current = id; }}
            />
          );
        })}

        {/* Inline label editor - positioned near the new annotation tick */}
        {editingId && (
          <div
            className="absolute z-30 pointer-events-none"
            style={{
              left: `${Math.max(40, Math.min(editingX, (trackRef.current?.clientWidth ?? 300) - 40))}px`,
              bottom: '100%',
              marginBottom: '4px',
              transform: 'translateX(-50%)',
            }}
          >
            <input
              ref={editInputRef}
              value={editingLabel}
              onChange={(e) => setEditingLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                e.stopPropagation();
              }}
              onBlur={commitEdit}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              className="pointer-events-auto w-32 bg-bg-primary border border-accent-amber/60 rounded-md px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-amber shadow-lg"
              placeholder="Bookmark name"
              maxLength={60}
            />
          </div>
        )}
      </div>

      <button
        onClick={addBookmarkHere}
        className="w-8 h-8 rounded-md flex items-center justify-center border border-border text-text-secondary hover:border-accent-amber/40 hover:text-accent-amber transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-amber/60"
        title="Add bookmark at playhead (M)"
        aria-label="Add timeline bookmark"
        id="timeline-bookmark-btn"
      >
        <BookmarkIcon />
      </button>

      <button
        onClick={() => setLoop(!loop)}
        className={`w-8 h-8 rounded-md flex items-center justify-center border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60 ${
          loop
            ? 'bg-accent-blue/15 border-accent-blue/40 text-accent-blue'
            : 'border-border text-text-secondary hover:border-accent-blue/40 hover:text-accent-blue'
        }`}
        title={loop ? 'Loop on (L)' : 'Loop off (L)'}
        aria-label={loop ? 'Disable loop playback' : 'Enable loop playback'}
        aria-pressed={loop}
        id="timeline-loop-toggle"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 1l4 4-4 4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 11V9a4 4 0 014-4h14" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 23l-4-4 4-4" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 13v2a4 4 0 01-4 4H3" />
        </svg>
      </button>

      <SpeedSelect value={speed} onChange={setSpeed} />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface AnnotationTickProps {
  annotation: Annotation;
  fraction: number;
  isEditing: boolean;
  onSeek: () => void;
  onRemove: () => void;
  onRename: () => void;
  onHoverChange: (id: string | null) => void;
}

function AnnotationTick({ annotation, fraction, isEditing, onSeek, onRemove, onRename, onHoverChange }: AnnotationTickProps) {
  const [hovered, setHovered] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Delayed hide so moving the mouse from the tick into the tooltip above it
  // doesn't instantly dismiss the tooltip (the gap between them would otherwise
  // fire onMouseLeave before the mouse reaches the tooltip).
  const enter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setHovered(true);
    onHoverChange(annotation.id);
  };
  const leave = () => {
    hideTimer.current = setTimeout(() => {
      setHovered(false);
      onHoverChange(null);
    }, 200);
  };

  return (
    <div
      // w-6 wide hit area (centered via -translate-x-1/2) so the tick is easy
      // to hover even though the visible bar is only a few px wide.
      className="absolute top-0 bottom-0 z-10 w-6 -translate-x-1/2"
      style={{ left: `${fraction * 100}%` }}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onClick={(e) => { e.stopPropagation(); onSeek(); }}
      onDoubleClick={(e) => { e.stopPropagation(); onRename(); }}
    >
      {/* Tick bar - centered in the hit area */}
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm cursor-pointer transition-all ${
          isEditing
            ? 'w-1.5 h-5 bg-accent-amber'
            : 'w-1 h-4 bg-accent-amber/70 group-hover:bg-accent-amber'
        } ${hovered && !isEditing ? 'w-1.5 h-5 bg-accent-amber' : ''}`}
      />

      {/* Tooltip + delete - floats above; has its own enter/leave so the
          mouse can travel into it without triggering the hide timer. */}
      {hovered && !isEditing && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 z-20"
          style={{ paddingBottom: '6px' }}
          onMouseEnter={enter}
          onMouseLeave={leave}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center gap-2 bg-bg-primary border border-border rounded-md px-3 py-1.5 shadow-lg whitespace-nowrap">
            <span className="text-xs text-text-secondary max-w-[160px] truncate">
              {annotation.label}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              onPointerDown={(e) => e.stopPropagation()}
              className="text-sm leading-none text-text-muted hover:text-accent-rose transition-colors flex-shrink-0 cursor-pointer"
              title="Remove bookmark"
              aria-label="Remove bookmark"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BookmarkIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
      <line x1="12" y1="8" x2="12" y2="14" />
      <line x1="9" y1="11" x2="15" y2="11" />
    </svg>
  );
}

function formatRelative(ns: bigint): string {
  const sec = nsToSeconds(ns);
  if (sec < 60) return `${sec.toFixed(2)}s`;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}m ${s.toFixed(1)}s`;
}

function SpeedSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const speeds = [0.25, 0.5, 1, 2, 4];
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-text-muted mono">speed</span>
      <select
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="bg-surface border border-border rounded-md px-2 py-1 mono text-text-primary focus:outline-none focus:border-accent-blue/50"
      >
        {speeds.map((s) => (
          <option key={s} value={s}>
            {s}x
          </option>
        ))}
      </select>
    </div>
  );
}
