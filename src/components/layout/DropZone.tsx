import { useState, useCallback, useRef } from 'react';
import { useBagStore } from '../../store/bagStore';
import { useUiStore } from '../../store/uiStore';

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
  const { loadBag, loadBagFromUrl, isLoading, loadProgress, error, clearError } =
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
      loadBagFromUrl(trimmed);
    },
    [loadBagFromUrl, clearError],
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
            <h1 className="text-5xl font-bold tracking-tight text-gradient">
              BAGEL
            </h1>
          </div>
          <p className="text-text-secondary text-lg font-light">
            BAG ExpLoration: Explore ROS bag files in your browser
          </p>
          <p className="text-text-tertiary text-sm mt-2">
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
          role="button"
          tabIndex={0}
          aria-label="Drop a bag file here or click to browse"
          data-testid="file-input-zone"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".db3,.mcap,.bag"
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

        {/* Or paste a URL — fetches via HTTP Range so multi-GB bags only
            pull the chunks the user scrubs through. Public S3 / GitHub
            release assets / personal servers all work as long as CORS +
            Content-Length are exposed. */}
        <UrlInput onLoad={handleUrl} disabled={isLoading} />

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
        <div className="mt-6 flex items-center justify-center gap-6 text-text-muted text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent-cyan/50" />
            .mcap files
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent-violet/50" />
            .db3 (ROS2 SQLite)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent-amber/50" />
            .bag (ROS1)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-accent-emerald/50" />
            100% client-side
          </span>
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
      className="mt-4 flex items-center gap-2"
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
        className="flex-1 px-3 py-2 rounded-md bg-surface border border-border text-text-primary text-sm mono placeholder:text-text-tertiary focus:outline-none focus:border-accent-blue/50 disabled:opacity-50"
      />
      <button
        type="submit"
        disabled={disabled || url.trim().length === 0}
        className="px-4 py-2 rounded-md border border-accent-blue/30 bg-accent-blue/10 text-accent-blue text-sm font-medium hover:bg-accent-blue/20 hover:border-accent-blue/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
      >
        Open URL
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
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all ${isDragOver ? 'bg-accent-blue/20 scale-110' : 'bg-surface'}`}>
        <svg
          className={`w-8 h-8 transition-colors ${isDragOver ? 'text-accent-blue' : 'text-text-tertiary'}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
      </div>
      <div className="text-center">
        <p className={`text-lg font-medium transition-colors ${isDragOver ? 'text-accent-blue' : 'text-text-primary'}`}>
          {isDragOver ? 'Release to explore' : 'Drop your bag file here'}
        </p>
        <p className="text-text-tertiary text-sm mt-1">
          or click to browse • supports .mcap, .db3, .bag
        </p>
      </div>
    </div>
  );
}

/** Loading state with progress bar */
function LoadingState({ progress }: { progress: number }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="w-16 h-16 rounded-2xl bg-accent-blue/10 flex items-center justify-center">
        <svg className="w-8 h-8 text-accent-blue animate-spin-slow" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-text-primary font-medium">Parsing bag file...</p>
        <p className="text-text-tertiary text-sm mt-1">
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
    <div className="relative w-12 h-12">
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-accent-blue via-accent-cyan to-accent-violet opacity-80 animate-spin-slow" />
      <div className="absolute inset-[3px] rounded-full bg-bg-primary" />
      <div className="absolute inset-[6px] rounded-full bg-gradient-to-br from-accent-blue/20 to-accent-violet/20" />
      <div className="absolute inset-[10px] rounded-full bg-bg-primary" />
    </div>
  );
}
