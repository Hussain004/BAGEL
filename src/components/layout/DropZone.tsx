import { useState, useCallback, useRef } from 'react';
import { useBagStore } from '../../store/bagStore';
import { useUiStore } from '../../store/uiStore';
import { useLiveStore } from '../../store/liveStore';

/**
 * DropZone — Full-screen drag-and-drop file input for bag files.
 * Renders when no bag file is loaded. Features animated border,
 * BAGEL branding, and a file input fallback.
 */
export function DropZone() {
  const [isDragOver, setIsDragOver] = useState(false);
  // Tracks nested dragenter/dragleave events so the active state doesn't
  // flicker as the cursor crosses child element boundaries.
  const [, setDragCounter] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { loadBag, loadBagFromUrl, addBagLive, isLoading, loadProgress, error, clearError } =
    useBagStore();

  const handleFile = useCallback(
    (file: File) => {
      clearError();
      loadBag(file);
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

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-radial bg-grid relative overflow-hidden">
      {/* Ambient glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-accent-blue/5 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent-violet/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '1.5s' }} />

      <div className="relative z-10 w-full max-w-2xl animate-fade-in-up">
        {/* Logo & Tagline */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <BagelIcon />
            <h1 className="text-6xl font-bold tracking-tight text-gradient">
              BAGEL
            </h1>
          </div>
          <p className="text-text-secondary text-xl font-normal">
            BAG ExpLoration: Explore ROS bag files in your browser
          </p>
          <p className="text-text-secondary/70 text-sm mt-2">
            No installation required. No data leaves your machine.
          </p>
        </div>

        {/* Drop Zone Area */}
        <div
          className={`dropzone ${isDragOver ? 'dropzone-active' : ''} p-12 text-center cursor-pointer transition-all`}
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

        <div className="mt-6 flex flex-col gap-3">
          {/* Or paste a URL - fetches via HTTP Range so multi-GB bags only
              pull the chunks the user scrubs through. Public S3 / GitHub
              release assets / personal servers all work as long as CORS +
              Content-Length are exposed. */}
          <UrlInput onLoad={handleUrl} disabled={isLoading} />

          {/* Or connect to a live robot running Foxglove WebSocket bridge
              (ros2 run foxglove_bridge foxglove_bridge) or rosbridge. */}
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
                <p className="text-accent-rose font-medium text-sm">Failed to parse bag file</p>
                <p className="text-text-secondary text-sm mt-1">{error}</p>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
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

        {/* Quick actions: sample bag + about */}
        <div className="mt-6 flex items-center justify-center gap-3">
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

        {/* Supported formats */}
        <div className="mt-6">
          <p className="text-center text-text-muted text-[10px] font-medium uppercase tracking-wider mb-2">
            Supported formats
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <FormatBadge accent="cyan">.mcap</FormatBadge>
            <FormatBadge accent="violet">.db3 (ROS2 SQLite)</FormatBadge>
            <FormatBadge accent="amber">.bag (ROS1)</FormatBadge>
            <FormatBadge accent="emerald">Foxglove live (ws://)</FormatBadge>
            <FormatBadge accent="rose">.pcd / .ply point clouds</FormatBadge>
            <FormatBadge accent="blue">.splat / .ksplat gaussian splats</FormatBadge>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * UrlInput — Paste a remote URL to load via HTTP Range. The bagStore handles
 * the HEAD request, range probe, and per-failure-mode error surfacing; we
 * just collect the text and hand it off.
 */
function UrlInput({
  onLoad,
  disabled,
}: {
  onLoad: (url: string) => void;
  disabled: boolean;
}) {
  const [url, setUrl] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    onLoad(url);
  };

  return (
    <form
      onSubmit={submit}
      className="flex items-center gap-2.5"
      aria-label="Load bag from URL"
    >
      <input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="…or paste a bag URL (https://…)"
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        // Trim leading/trailing spaces invisibly so a copy-paste with
        // surrounding whitespace doesn't fail with "invalid URL".
        onBlur={(e) => setUrl(e.target.value.trim())}
        className="flex-1 px-4 py-2.5 rounded-md bg-surface border border-border text-text-primary text-sm mono placeholder:text-text-tertiary hover:border-border-hover focus:outline-none focus:border-accent-blue/60 focus:ring-2 focus:ring-accent-blue/15 disabled:opacity-50 transition-colors"
      />
      <button
        type="submit"
        disabled={disabled || url.trim().length === 0}
        className="w-28 px-4 py-2.5 rounded-md border border-accent-blue/30 bg-accent-blue/10 text-accent-blue text-sm font-medium hover:bg-accent-blue/20 hover:border-accent-blue/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
      >
        Open URL
      </button>
    </form>
  );
}

/**
 * WsConnectInput — Connect to a live Foxglove WebSocket bridge.
 * Accepts ws:// and wss:// URLs (e.g. ws://robot.local:8765).
 */
function WsConnectInput({
  onConnect,
  disabled,
}: {
  onConnect: (url: string) => void;
  disabled: boolean;
}) {
  const [url, setUrl] = useState('');
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
      <input
        type="text"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="…or connect to a robot (ws://robot.local:8765)"
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        onBlur={(e) => setUrl(e.target.value.trim())}
        className="flex-1 px-4 py-2.5 rounded-md bg-surface border border-border text-text-primary text-sm mono placeholder:text-text-tertiary hover:border-border-hover focus:outline-none focus:border-accent-emerald/60 focus:ring-2 focus:ring-accent-emerald/15 disabled:opacity-50 transition-colors"
      />
      <button
        type="submit"
        disabled={disabled || !url.trim().startsWith('ws')}
        className="w-28 px-4 py-2.5 rounded-md border border-accent-emerald/30 bg-accent-emerald/10 text-accent-emerald text-sm font-medium hover:bg-accent-emerald/20 hover:border-accent-emerald/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-emerald/60 flex items-center justify-center gap-1.5"
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
 * SampleBagButton — Fetches the bundled synthetic tour bag and feeds it to
 * the bag store so first-time visitors can try BAGEL without their own
 * data. The bag is generated by `scripts/build-sample-bag.mjs` at dev time
 * and checked into `public/sample-bags/tour.mcap`.
 */
function SampleBagButton({
  onLoad,
  disabled,
}: {
  onLoad: (file: File) => void;
  disabled: boolean;
}) {
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handle = async () => {
    if (fetching || disabled) return;
    setFetching(true);
    setError(null);
    try {
      // Use a path relative to the document so it works under both `/` and
      // any future GitHub Pages subpath without hardcoding a base.
      const resp = await fetch(`${import.meta.env.BASE_URL ?? '/'}sample-bags/tour.mcap`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      // File constructors need a name + lastModified for the parser cache key.
      const file = new File([blob], 'bagel-tour.mcap', { type: 'application/octet-stream' });
      onLoad(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFetching(false);
    }
  };
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={handle}
        disabled={fetching || disabled}
        className="inline-flex items-center gap-2 px-4 py-1.5 rounded-md border border-accent-blue/30 bg-accent-blue/10 text-accent-blue text-xs font-medium hover:bg-accent-blue/20 hover:border-accent-blue/50 disabled:opacity-60 disabled:cursor-progress transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
      >
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

/** Idle state content inside the drop zone */
function IdleState({ isDragOver }: { isDragOver: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className={`w-20 h-20 rounded-2xl flex items-center justify-center transition-all ${isDragOver ? 'bg-accent-blue/20 scale-110' : 'bg-surface'}`}>
        <svg
          className={`w-9 h-9 transition-colors ${isDragOver ? 'text-accent-blue' : 'text-text-tertiary'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
      </div>
      <div className="text-center">
        <p className={`text-xl font-semibold transition-colors ${isDragOver ? 'text-accent-blue' : 'text-text-primary'}`}>
          {isDragOver ? 'Release to explore' : 'Drop your bag file here'}
        </p>
        <p className="text-text-secondary/70 text-sm mt-1.5">
          or click to browse • supports .mcap, .db3, .bag, .pcd, .ply, .splat, .ksplat
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
        <p className="text-text-primary text-xl font-semibold">Parsing bag file...</p>
        <p className="text-text-secondary/70 text-sm mt-1.5">
          Reading and analyzing topics
        </p>
      </div>
      <div className="w-full max-w-xs h-1.5 bg-surface rounded-full overflow-hidden">
        <div
          className="progress-bar h-full"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}

/** BAGEL logo icon */
function BagelIcon() {
  return (
    <div className="relative w-14 h-14">
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-accent-blue via-accent-cyan to-accent-violet opacity-80 animate-spin-slow" />
      <div className="absolute inset-[3px] rounded-full bg-bg-primary" />
      <div className="absolute inset-[6px] rounded-full bg-gradient-to-br from-accent-blue/20 to-accent-violet/20" />
      <div className="absolute inset-[10px] rounded-full bg-bg-primary" />
    </div>
  );
}

/** Per-accent pill classes for the supported-formats legend. Full class
 * strings (not interpolated) so Tailwind's static scanner generates them -
 * reuses the existing `.badge` shape/type treatment with each format's
 * already-established accent colour, no new hex values. */
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
}: {
  accent: keyof typeof FORMAT_BADGE_CLASSES;
  children: React.ReactNode;
}) {
  return <span className={`badge border ${FORMAT_BADGE_CLASSES[accent]}`}>{children}</span>;
}
