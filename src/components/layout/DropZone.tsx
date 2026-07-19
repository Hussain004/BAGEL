import { useState, useCallback, useRef, useEffect } from 'react';
import { useBagStore } from '../../store/bagStore';
import { useUiStore } from '../../store/uiStore';
import { useLiveStore } from '../../store/liveStore';
import { useLayoutStore, panelLeafId } from '../../store/layoutStore';
import { usePlayheadStore } from '../../store/playheadStore';
import { CopyErrorButton } from '../panels/shared/CopyErrorButton';
import { ParticleField } from './ParticleField';

/**
 * DropZone - Full-screen drag-and-drop file input for bag files.
 * Renders when no bag file is loaded. Features particle background,
 * mouse-tracking parallax, staggered entrance, and animated border.
 */
export function DropZone() {
  const [isDragOver, setIsDragOver] = useState(false);
  const [, setDragCounter] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { loadBag, loadBagFromUrl, addBagLive, isLoading, loadProgress, error, clearError } =
    useBagStore();

  // Mouse tracking for parallax effect
  const containerRef = useRef<HTMLDivElement>(null);
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onMove = (e: MouseEvent) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      // Normalised -1..1 offset from center
      const nx = (e.clientX - cx) / (rect.width / 2);
      const ny = (e.clientY - cy) / (rect.height / 2);
      setMouseOffset({ x: nx, y: ny });
    };

    const onLeave = () => setMouseOffset({ x: 0, y: 0 });

    el.addEventListener('mousemove', onMove, { passive: true });
    el.addEventListener('mouseleave', onLeave);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      clearError();
      return loadBag(file);
    },
    [loadBag, clearError]
  );

  const handleUrl = useCallback(
    (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) return;
      clearError();
      void loadBagFromUrl(trimmed).catch(() => {});
    },
    [loadBagFromUrl, clearError],
  );

  const handleWsConnect = useCallback(
    (url: string) => {
      const trimmed = url.trim();
      if (!trimmed) return;
      clearError();
      addBagLive(trimmed);
    },
    [addBagLive, clearError],
  );

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragCounter((c) => c + 1);
      setIsDragOver(true);
    },
    []
  );

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragCounter((c) => {
        const next = c - 1;
        if (next <= 0) setIsDragOver(false);
        return Math.max(0, next);
      });
    },
    []
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      setDragCounter(0);

      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFile(files[0]);
      }
    },
    [handleFile]
  );

  // Parallax transform for the glow orbs (subtle, 8px max shift)
  const orbTransform = {
    transform: `translate(${mouseOffset.x * 8}px, ${mouseOffset.y * 8}px)`,
  };
  const orbTransformInverse = {
    transform: `translate(${mouseOffset.x * -6}px, ${mouseOffset.y * -6}px)`,
  };

  // Subtle 3D tilt on the main card (1.5deg max)
  const cardTilt = {
    transform: `perspective(1200px) rotateY(${mouseOffset.x * 1.2}deg) rotateX(${-mouseOffset.y * 1.2}deg)`,
  };

  return (
    <div
      ref={containerRef}
      className="min-h-screen flex items-center justify-center p-6 bg-gradient-radial bg-grid relative overflow-hidden"
    >
      {/* Particle canvas background */}
      <ParticleField />

      {/* Ambient glow orbs - parallax-linked */}
      <div
        className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent-blue/5 rounded-full blur-3xl animate-float pointer-events-none"
        style={orbTransform}
      />
      <div
        className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent-violet/5 rounded-full blur-3xl animate-float pointer-events-none"
        style={{ animationDelay: '1.5s', ...orbTransformInverse }}
      />
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-accent-cyan/3 rounded-full blur-3xl pointer-events-none"
        style={{ animationDelay: '3s', ...orbTransform }}
      />

      <div className="relative z-10 w-full max-w-2xl" style={cardTilt}>
        <NarrowViewportNotice />

        {/* Logo & Tagline with staggered entrance */}
        <div className="text-center mb-8 animate-stagger-in" style={{ animationDelay: '0.05s' }}>
          <div className="inline-flex items-center gap-4 mb-4">
            <BagelIcon />
            <h1 className="wordmark">
              BAGEL
            </h1>
          </div>
          <p className="text-text-secondary text-lg font-normal tracking-wide animate-stagger-in" style={{ animationDelay: '0.15s' }}>
            Explore ROS bag files in your browser.
          </p>
          <p className="text-text-tertiary text-sm mt-1.5 animate-stagger-in" style={{ animationDelay: '0.22s' }}>
            No install. No server. No data leaves your machine.
          </p>
        </div>

        {/* Drop Zone Area with stagger */}
        <div className="animate-stagger-in" style={{ animationDelay: '0.3s' }}>
          <div
            className={`dropzone ${isDragOver ? 'dropzone-active' : ''} p-12 text-center cursor-pointer`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => !isLoading && fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (!isLoading) fileInputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label="Drop a bag file here or click to browse"
            data-testid="file-input-zone"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".db3,.mcap,.bag,.pcd,.ply,.splat,.ksplat"
              onChange={handleFileInput}
              className="hidden"
              data-testid="file-input"
            />

            {isLoading ? (
              <LoadingState progress={loadProgress} />
            ) : (
              <IdleState isDragOver={isDragOver} />
            )}
          </div>
        </div>

        {/* URL + WS inputs with stagger */}
        <div className="mt-6 flex flex-col gap-3 animate-stagger-in" style={{ animationDelay: '0.4s' }}>
          <UrlInput onLoad={handleUrl} disabled={isLoading} />
          <WsConnectInput onConnect={handleWsConnect} disabled={isLoading} />
        </div>

        {/* Error Display */}
        {error && (
          <div className="mt-4 p-4 rounded-lg bg-accent-rose/10 border border-accent-rose/20 animate-fade-in">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-accent-rose flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-accent-rose font-medium text-sm">{error.title}</p>
                <p className="text-text-secondary text-sm mt-1">{error.detail}</p>
                <div className="flex items-center gap-3 mt-2">
                  {error.action && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (error.action?.kind === 'choose-file') {
                          fileInputRef.current?.click();
                        } else {
                          clearError();
                        }
                      }}
                      className="text-xs font-medium text-accent-blue hover:text-accent-cyan transition-colors"
                    >
                      {error.action.label}
                    </button>
                  )}
                  <CopyErrorButton text={error.raw} />
                </div>
              </div>
              <button
                onClick={() => {
                  clearError();
                }}
                className="text-text-tertiary hover:text-text-primary ml-auto"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Quick actions with stagger */}
        <div className="mt-6 flex items-center justify-center gap-3 animate-stagger-in" style={{ animationDelay: '0.48s' }}>
          <SampleBagButton onLoad={handleFile} disabled={isLoading} />
          <button
            onClick={() => useUiStore.getState().setModal('about')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-text-tertiary hover:text-text-secondary text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
          >
            About BAGEL
          </button>
          <button
            onClick={() => useUiStore.getState().setModal('shortcuts')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-text-tertiary hover:text-text-secondary text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
          >
            Keyboard shortcuts
          </button>
        </div>

        {/* Supported formats with stagger */}
        <div className="mt-6 animate-stagger-in" style={{ animationDelay: '0.55s' }}>
          <p className="text-center text-text-muted text-[10px] font-medium uppercase tracking-wider mb-2">
            Supported formats
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <FormatBadge accent="cyan" delay={0}>.mcap</FormatBadge>
            <FormatBadge accent="violet" delay={1}>.db3 (ROS2 SQLite)</FormatBadge>
            <FormatBadge accent="amber" delay={2}>.bag (ROS1)</FormatBadge>
            <FormatBadge accent="emerald" delay={3}>Foxglove live (ws://)</FormatBadge>
            <FormatBadge accent="rose" delay={4}>.pcd / .ply point clouds</FormatBadge>
            <FormatBadge accent="blue" delay={5}>.splat / .ksplat gaussian splats</FormatBadge>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * UrlInput - Paste a remote URL to load via HTTP Range.
 */
function UrlInput({
  onLoad,
  disabled,
}: {
  onLoad: (url: string) => void;
  disabled: boolean;
}) {
  const [url, setUrl] = useState('');
  const [focused, setFocused] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    onLoad(url);
  };

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2.5 group"
      aria-label="Load bag from URL"
    >
      <div className="relative flex-1">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            setFocused(false);
            setUrl(e.target.value.trim());
          }}
          placeholder="…or paste a bag URL (https://…)"
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          className={`input-premium w-full px-4 py-2.5 rounded-md bg-surface border text-text-primary text-sm mono placeholder:text-text-tertiary disabled:opacity-50 transition-all ${
            focused
              ? 'border-accent-blue/60 ring-2 ring-accent-blue/15'
              : 'border-border hover:border-border-hover'
          }`}
        />
      </div>
      <button
        type="submit"
        disabled={disabled || url.trim().length === 0}
        className="btn-glow w-28 px-4 py-2.5 rounded-md border border-accent-blue/30 bg-accent-blue/10 text-accent-blue text-sm font-medium hover:bg-accent-blue/20 hover:border-accent-blue/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
      >
        Open URL
      </button>
    </form>
  );
}

/**
 * WsConnectInput - Connect to a live Foxglove WebSocket bridge.
 */
function WsConnectInput({
  onConnect,
  disabled,
}: {
  onConnect: (url: string) => void;
  disabled: boolean;
}) {
  const [url, setUrl] = useState('');
  const [focused, setFocused] = useState(false);
  const isConnecting = useLiveStore((s) => {
    for (const status of s.statuses.values()) {
      if (status === 'connecting') return true;
    }
    return false;
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || disabled) return;
    onConnect(trimmed);
    setUrl('');
  };

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2.5"
      aria-label="Connect to a live robot"
    >
      <div className="relative flex-1">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="…or connect to a robot (ws://robot.local:8765)"
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          className={`input-premium-emerald w-full px-4 py-2.5 rounded-md bg-surface border text-text-primary text-sm mono placeholder:text-text-tertiary disabled:opacity-50 transition-all ${
            focused
              ? 'border-accent-emerald/60 ring-2 ring-accent-emerald/15'
              : 'border-border hover:border-border-hover'
          }`}
        />
      </div>
      <button
        type="submit"
        disabled={disabled || !url.trim().startsWith('ws')}
        className="btn-glow w-28 px-4 py-2.5 rounded-md border border-accent-emerald/30 bg-accent-emerald/10 text-accent-emerald text-sm font-medium hover:bg-accent-emerald/20 hover:border-accent-emerald/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-emerald/60 flex items-center justify-center gap-1.5"
      >
        {isConnecting ? (
          <svg className="w-3.5 h-3.5 animate-spin-slow" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
          </svg>
        )}
        Connect
      </button>
    </form>
  );
}

/**
 * SampleBagButton - Fetches the bundled synthetic tour bag.
 */
function SampleBagButton({
  onLoad,
  disabled,
}: {
  onLoad: (file: File) => void | Promise<unknown>;
  disabled: boolean;
}) {
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);
  const handle = async () => {
    if (fetching || disabled) return;
    setFetching(true);
    setError(null);
    try {
      const resp = await fetch(`${import.meta.env.BASE_URL ?? '/'}sample-bags/tour.mcap`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const file = new File([blob], 'bagel-tour.mcap', { type: 'application/octet-stream' });
      await onLoad(file);
      applyCuratedSampleLayout();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFetching(false);
    }
  };
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={handle}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        disabled={fetching || disabled}
        className="btn-glow inline-flex items-center gap-2 px-4 py-1.5 rounded-md border border-accent-blue/30 bg-accent-blue/10 text-accent-blue text-xs font-medium hover:bg-accent-blue/20 hover:border-accent-blue/50 disabled:opacity-60 disabled:cursor-progress transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60 relative overflow-hidden"
      >
        {/* Shimmer sweep on hover */}
        {hovered && !fetching && (
          <span className="absolute inset-0 overflow-hidden rounded-md pointer-events-none">
            <span
              className="absolute inset-0 -translate-x-full"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(59,130,246,0.1), transparent)',
                animation: 'shimmer-sweep 0.8s ease-out forwards',
              }}
            />
          </span>
        )}
        {fetching ? (
          <>
            <svg className="w-3.5 h-3.5 animate-spin-slow" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading…
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Try a sample bag
          </>
        )}
      </button>
      {error && (
        <span className="text-accent-rose text-[10px]" role="alert">
          Failed to load sample: {error}
        </span>
      )}
    </div>
  );
}

/**
 * NarrowViewportNotice - shown only below the sm breakpoint.
 */
function NarrowViewportNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div
      role="note"
      className="sm:hidden mb-6 flex items-start gap-2.5 p-3 rounded-lg bg-accent-amber/10 border border-accent-amber/25 text-left animate-stagger-in"
      style={{ animationDelay: '0s' }}
    >
      <p className="flex-1 text-text-secondary text-xs leading-relaxed">
        BAGEL is built for desktop browsers. Panels, docking, and hover
        actions will be cramped on a small screen.
      </p>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="text-text-tertiary hover:text-text-primary flex-shrink-0 -mt-0.5"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/** Idle state content inside the drop zone */
function IdleState({ isDragOver }: { isDragOver: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className={`w-20 h-20 rounded-2xl flex items-center justify-center transition-all duration-300 ${isDragOver ? 'bg-accent-blue/20 scale-110 shadow-[0_0_24px_rgba(59,130,246,0.2)]' : 'bg-surface group-hover:bg-surface-hover'}`}>
        <svg
          className={`w-9 h-9 transition-all duration-300 ${isDragOver ? 'text-accent-blue scale-110' : 'text-text-tertiary'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
      </div>
      <div className="text-center">
        <p className={`text-xl font-semibold transition-colors duration-300 ${isDragOver ? 'text-accent-blue' : 'text-text-primary'}`}>
          {isDragOver ? 'Release to explore' : 'Drop your bag file here'}
        </p>
        <p className="text-text-secondary/70 text-sm mt-1.5">
          or click to browse . supports .mcap, .db3, .bag, .pcd, .ply, .splat, .ksplat
        </p>
      </div>
    </div>
  );
}

/** Loading state with progress bar */
function LoadingState({ progress }: { progress: number }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-20 h-20 rounded-2xl bg-accent-blue/10 flex items-center justify-center">
        <svg className="w-9 h-9 text-accent-blue animate-spin-slow" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-text-primary text-xl font-semibold">Parsing bag file…</p>
        <p className="text-text-secondary/70 text-sm mt-1.5">
          Reading and analyzing topics
        </p>
      </div>
      <div className="w-full max-w-xs h-1.5 bg-surface rounded-full overflow-hidden">
        <div
          className="progress-bar h-full transition-[width] duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

/**
 * applyCuratedSampleLayout - lands the sample-bag first-time visitor on a
 * working cockpit instead of an empty grid.
 */
function applyCuratedSampleLayout(): void {
  const layout = useLayoutStore.getState();
  layout.openPanel({ kind: '3d', topicName: '/scan', type: 'sensor_msgs/msg/LaserScan' });
  layout.openPanel({ kind: 'image', topicName: '/camera/image_raw', type: 'sensor_msgs/msg/Image' });
  layout.openPanel({ kind: 'plot', topicName: '/imu/data', type: 'sensor_msgs/msg/Imu' });
  const imageId = panelLeafId('image', '/camera/image_raw');
  const plotId = panelLeafId('plot', '/imu/data');
  layout.dockPanel(plotId, imageId, 'bottom');

  const playhead = usePlayheadStore.getState();
  playhead.seek(playhead.startNs + 3_000_000_000n);
  playhead.setPlaying(true);

  useUiStore.getState().triggerOnboardingHint();
}

/**
 * Enhanced BagelIcon - breathing glow, orbiting ring, polished gradient.
 */
function BagelIcon() {
  return (
    <div className="relative w-14 h-14" style={{ animation: 'glow-breathe 4s ease-in-out infinite' }}>
      {/* Outer orbiting ring */}
      <div
        className="absolute inset-[-4px] rounded-full border border-accent-blue/20"
        style={{ animation: 'ring-orbit 12s linear infinite' }}
      >
        <div className="absolute -top-[2px] left-1/2 w-1 h-1 rounded-full bg-accent-cyan/60" />
      </div>
      {/* Main ring gradient */}
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-accent-blue via-accent-cyan to-accent-violet opacity-80" style={{ animation: 'spin-slow 8s linear infinite' }} />
      <div className="absolute inset-[3px] rounded-full bg-bg-primary" />
      <div className="absolute inset-[6px] rounded-full bg-gradient-to-br from-accent-blue/25 to-accent-violet/25" />
      <div className="absolute inset-[10px] rounded-full bg-bg-primary" />
      {/* Inner glow dot */}
      <div className="absolute inset-[13px] rounded-full bg-gradient-to-br from-accent-cyan/40 to-accent-blue/30" />
    </div>
  );
}

/** Per-accent pill classes for the supported-formats legend. */
const FORMAT_BADGE_CLASSES = {
  cyan: 'bg-accent-cyan/15 text-accent-cyan border-accent-cyan/25',
  violet: 'bg-accent-violet/15 text-accent-violet border-accent-violet/25',
  amber: 'bg-accent-amber/15 text-accent-amber border-accent-amber/25',
  emerald: 'bg-accent-emerald/15 text-accent-emerald border-accent-emerald/25',
  rose: 'bg-accent-rose/15 text-accent-rose border-accent-rose/25',
  blue: 'bg-accent-blue/15 text-accent-blue border-accent-blue/25',
} as const;

function FormatBadge({
  accent,
  children,
  delay = 0,
}: {
  accent: keyof typeof FORMAT_BADGE_CLASSES;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <span
      className={`badge border ${FORMAT_BADGE_CLASSES[accent]}`}
      style={{
        animation: `badge-pop 0.4s ease-out ${0.6 + delay * 0.08}s both`,
      }}
    >
      {children}
    </span>
  );
}
