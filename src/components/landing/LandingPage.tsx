import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useRef, useState } from 'react';
import { useBagStore } from '../../store/bagStore';
import { useLiveStore } from '../../store/liveStore';
import { useLayoutStore, panelLeafId } from '../../store/layoutStore';
import { usePlayheadStore } from '../../store/playheadStore';
import { useUiStore } from '../../store/uiStore';
import { CopyErrorButton } from '../panels/shared/CopyErrorButton';
import { DATASET_HOSTING_DOC_URL } from '../../utils/actionableError';
import { BrandLockup } from './Brand';
import { FileIngestPanel } from './FileIngestPanel';
import { RecentFiles } from './RecentFiles';
import { recordRecentUrl } from '../../utils/recentFiles';
import { openBagFiles, type IngestFile } from '../../utils/droppedFiles';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';

export function LandingPage() {
  const loadBag = useBagStore((state) => state.loadBag);
  const loadBagFromUrl = useBagStore((state) => state.loadBagFromUrl);
  const addBagLive = useBagStore((state) => state.addBagLive);
  const isLoading = useBagStore((state) => state.isLoading);
  const loadProgress = useBagStore((state) => state.loadProgress);
  const error = useBagStore((state) => state.error);
  const clearError = useBagStore((state) => state.clearError);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    clearError();
    return loadBag(file);
  }, [clearError, loadBag]);

  // The drop zone can hand over several files or a folder; those may be parts
  // of one split recording, so they go through grouping rather than loadBag.
  const handleFiles = useCallback((items: IngestFile[]) => {
    clearError();
    return openBagFiles(items, 'replace');
  }, [clearError]);

  const handleUrl = useCallback((url: string) => {
    clearError();
    const trimmed = url.trim();
    void recordRecentUrl(trimmed);
    void loadBagFromUrl(trimmed).catch(() => undefined);
  }, [clearError, loadBagFromUrl]);

  const handleLive = useCallback((url: string) => {
    clearError();
    addBagLive(url.trim());
  }, [addBagLive, clearError]);

  return (
    <div className="landing">
      <LandingHeader />
      <main className="landing__main">
        <section className="landing__intro" aria-labelledby="landing-title">
          <h1 id="landing-title">
            See the whole robot.
            <span>One timeline.</span>
          </h1>
          <p className="landing__lede">
            Open a ROS recording and see every sensor on one synchronized timeline: 3D, camera, plots and
            logs. It runs entirely in your browser, and nothing is uploaded.
          </p>

          <FileIngestPanel isLoading={isLoading} progress={loadProgress} onFiles={handleFiles} inputRef={fileInputRef} />
          <AnimatePresence initial={false}>
            {error && <ErrorCard error={error} onDismiss={clearError} onChooseFile={() => fileInputRef.current?.click()} />}
          </AnimatePresence>
          <SampleBagButton onLoad={handleFile} disabled={isLoading} />
          <SourceCards onUrl={handleUrl} onLive={handleLive} disabled={isLoading} />
          <RecentFiles onFile={handleFile} onUrl={handleUrl} disabled={isLoading} />
        </section>

        <figure className="landing__preview" aria-label="BAGEL showing the sample recording">
          <div className="landing__preview-bar"><span>bagel-tour.mcap</span><span>sample recording</span></div>
          <img src={`${import.meta.env.BASE_URL ?? '/'}landing/hero.jpg`} alt="The BAGEL workspace with a 3D view, a camera image and a plot, playing the sample recording" width={1028} height={744} />
        </figure>
      </main>

      <footer className="landing__footer">
        <span>Open source, MIT licensed</span>
        <span>Parsing runs in a worker in this tab</span>
        <a href="https://github.com/Hussain004/BAGEL" target="_blank" rel="noreferrer">GitHub</a>
      </footer>
    </div>
  );
}

function LandingHeader() {
  const install = useInstallPrompt();
  return (
    <header className="landing__header">
      <BrandLockup />
      <nav aria-label="Utility navigation">
        {install && <button type="button" onClick={() => void install()}>Install app</button>}
        <button type="button" onClick={() => useUiStore.getState().setModal('shortcuts')}>Shortcuts</button>
        <button type="button" onClick={() => useUiStore.getState().setModal('about')}>About</button>
        <a href="https://github.com/Hussain004/BAGEL" target="_blank" rel="noreferrer">GitHub</a>
        <a className="landing__support" href="https://donatr.ee/hussain/" target="_blank" rel="noreferrer" aria-label="Support BAGEL on donatr.ee">Support</a>
      </nav>
    </header>
  );
}

function SourceCards({ onUrl, onLive, disabled }: { onUrl: (url: string) => void; onLive: (url: string) => void; disabled: boolean }) {
  const isConnecting = useLiveStore((state) => [...state.statuses.values()].some((status) => status === 'connecting'));
  return (
    <div className="sources">
      <SourceCard
        title="Remote URL"
        hint="A bag served over HTTPS"
        placeholder="https://example.com/run.mcap"
        label="Remote bag URL"
        action="Open"
        valid={(v) => /^https?:\/\//i.test(v)}
        disabled={disabled}
        onSubmit={onUrl}
      />
      <SourceCard
        title="Live robot"
        hint="A Foxglove bridge WebSocket"
        placeholder="ws://robot.local:8765"
        label="Live robot WebSocket URL"
        action={isConnecting ? 'Connecting' : 'Connect'}
        valid={(v) => /^wss?:\/\//i.test(v)}
        clearOnSubmit
        disabled={disabled}
        onSubmit={onLive}
      />
    </div>
  );
}

function SourceCard({
  title, hint, placeholder, label, action, valid, clearOnSubmit, disabled, onSubmit,
}: {
  title: string; hint: string; placeholder: string; label: string; action: string;
  valid: (value: string) => boolean; clearOnSubmit?: boolean; disabled: boolean; onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState('');
  const ok = valid(value.trim());
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (disabled || !ok) return;
    onSubmit(value.trim());
    if (clearOnSubmit) setValue('');
  };
  return (
    <form className="source" onSubmit={submit}>
      <div className="source__head"><strong>{title}</strong><span>{hint}</span></div>
      <div className="source__row">
        <input value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => setValue((current) => current.trim())} placeholder={placeholder} spellCheck={false} autoComplete="off" disabled={disabled} aria-label={label} />
        <button type="submit" disabled={disabled || !ok}>{action}</button>
      </div>
    </form>
  );
}

function ErrorCard({ error, onDismiss, onChooseFile }: { error: NonNullable<ReturnType<typeof useBagStore.getState>['error']>; onDismiss: () => void; onChooseFile: () => void }) {
  return (
    <motion.div className="landing__error" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} role="alert">
      <div className="landing__error-body">
        <div><strong>{error.title}</strong><p>{error.detail}</p></div>
        <div className="landing__error-actions">
          {error.action?.kind === 'choose-file' && (
            <button type="button" onClick={onChooseFile}>{error.action.label}</button>
          )}
          {error.action?.kind === 'hosting-doc' && (
            // The fix for a remote-host CORS or Range failure is a server
            // config, so this opens the doc rather than doing anything in-app.
            <a href={DATASET_HOSTING_DOC_URL} target="_blank" rel="noreferrer">
              {error.action.label}
            </a>
          )}
          {error.action?.kind === 'retry' && (
            <button type="button" onClick={onDismiss}>{error.action.label}</button>
          )}
          <CopyErrorButton text={error.raw} />
          <button type="button" onClick={onDismiss} aria-label="Dismiss error">Dismiss</button>
        </div>
      </div>
    </motion.div>
  );
}

function SampleBagButton({ onLoad, disabled }: { onLoad: (file: File) => void | Promise<unknown>; disabled: boolean }) {
  const [fetching, setFetching] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);
  const load = async () => {
    if (fetching || disabled) return;
    setFetching(true);
    setSampleError(null);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL ?? '/'}sample-bags/tour.mcap`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const file = new File([await response.blob()], 'bagel-tour.mcap', { type: 'application/octet-stream' });
      await onLoad(file);
      applyCuratedSampleLayout();
    } catch (error) {
      setSampleError(error instanceof Error ? error.message : String(error));
      setFetching(false);
    }
  };
  return (
    <div className="sample">
      <div>
        <strong>No recording handy?</strong>
        <p>Try a 30 second robot run with lidar, a camera, IMU, GPS and a map.</p>
        {sampleError && <small role="alert">Sample failed: {sampleError}</small>}
      </div>
      <button type="button" onClick={load} disabled={fetching || disabled}>
        {fetching ? 'Loading sample' : 'Explore sample data'}
      </button>
    </div>
  );
}

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
