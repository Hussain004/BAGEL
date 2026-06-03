import { useEffect, useRef, useCallback } from 'react';
import { useBagStore } from '../../store/bagStore';
import { usePlayheadStore } from '../../store/playheadStore';
import { nsToSeconds, formatDuration } from '../../utils/time';

/**
 * Timeline — Global playhead control at the bottom of the main view.
 * Click or drag along the bar to seek; the playhead syncs across all
 * open visualization panels.
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
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const lastFrameRef = useRef<number | null>(null);
  // Note: the playhead range is owned by bagStore now (it varies with
  // alignment mode + the union of every loaded bag's range). The Timeline
  // used to reset it on every `bag` change; that's no longer necessary —
  // bagStore.syncPlayheadRange is the single source of truth.

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

  // Use the playhead range (set by bagStore.syncPlayheadRange) rather than
  // bag.duration directly — multi-bag with bag-start alignment gives a
  // range equal to max(bag1, bag2) which may differ from any single bag.
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
        className="flex-1 h-8 flex items-center cursor-pointer select-none group"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        id="timeline-track"
        role="slider"
        aria-label="Playhead — drag or use arrow keys to scrub"
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
      </div>

      <button
        onClick={() => setLoop(!loop)}
        className={`w-8 h-8 rounded-md flex items-center justify-center border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60 ${
          loop
            ? 'bg-accent-blue/15 border-accent-blue/40 text-accent-blue'
            : 'border-border text-text-secondary hover:border-accent-blue/40 hover:text-accent-blue'
        }`}
        title={loop ? 'Loop on (L) - playback wraps to start at end' : 'Loop off (L) - playback pauses at end'}
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
