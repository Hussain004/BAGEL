import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useRef, useState } from 'react';
import { useBagStore } from '../../store/bagStore';
import { useLiveStore } from '../../store/liveStore';
import { useLayoutStore, panelLeafId } from '../../store/layoutStore';
import { usePlayheadStore } from '../../store/playheadStore';
import { useUiStore } from '../../store/uiStore';
import { CopyErrorButton } from '../panels/shared/CopyErrorButton';
import { BrandLockup } from './Brand';
import { FileIngestPanel } from './FileIngestPanel';
import { TelemetryScene } from './TelemetryScene';
import { WorkspacePreview } from './WorkspacePreview';

const entrance = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0 },
};

export function LandingPage() {
  const loadBag = useBagStore((state) => state.loadBag);
  const loadBagFromUrl = useBagStore((state) => state.loadBagFromUrl);
  const addBagLive = useBagStore((state) => state.addBagLive);
  const isLoading = useBagStore((state) => state.isLoading);
  const loadProgress = useBagStore((state) => state.loadProgress);
  const error = useBagStore((state) => state.error);
  const clearError = useBagStore((state) => state.clearError);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();

  const handleFile = useCallback((file: File) => {
    clearError();
    return loadBag(file);
  }, [clearError, loadBag]);

  const handleUrl = useCallback((url: string) => {
    clearError();
    void loadBagFromUrl(url.trim()).catch(() => undefined);
  }, [clearError, loadBagFromUrl]);

  const handleLive = useCallback((url: string) => {
    clearError();
    addBagLive(url.trim());
  }, [addBagLive, clearError]);

  return (
    <div className="landing-shell">
      <TelemetryScene />
      <div className="landing-shell__wash" aria-hidden="true" />
      <div className="landing-shell__noise" aria-hidden="true" />

      <div className="landing-page">
        <LandingHeader />
        <main className="landing-main">
          <motion.div
            className="landing-copy"
            initial={reduceMotion ? false : 'hidden'}
            animate="visible"
            transition={{ staggerChildren: 0.08, delayChildren: 0.06 }}
          >
            <motion.div className="landing-eyebrow" variants={entrance} transition={{ duration: 0.5 }}>
              <span className="status-dot status-dot--live" />
              LOCAL DATA PLANE READY
              <span className="landing-eyebrow__version">BROWSER NATIVE</span>
            </motion.div>
            <motion.h1 variants={entrance} transition={{ duration: 0.62, ease: [0.16, 1, 0.3, 1] }}>
              See the whole robot.
              <span>One timeline.</span>
            </motion.h1>
            <motion.p className="landing-lede" variants={entrance} transition={{ duration: 0.55 }}>
              Inspect ROS recordings at full signal, directly in your browser. Decode, synchronize,
              and visualize high-volume sensor data without provisioning a backend.
            </motion.p>
            <motion.div className="landing-capabilities" variants={entrance} transition={{ duration: 0.5 }}>
              <Capability icon="cpu" label="Worker-isolated parsing" />
              <Capability icon="stream" label="HTTP range streaming" />
              <Capability icon="shield" label="Data never uploaded" />
            </motion.div>
            <motion.div variants={entrance} transition={{ duration: 0.55 }}>
              <FileIngestPanel isLoading={isLoading} progress={loadProgress} onFile={handleFile} inputRef={fileInputRef} />
            </motion.div>
            <motion.div variants={entrance} transition={{ duration: 0.5 }}>
              <SourceDock onUrl={handleUrl} onLive={handleLive} disabled={isLoading} />
            </motion.div>

            <AnimatePresence initial={false}>
              {error && <ErrorCard error={error} onDismiss={clearError} onChooseFile={() => fileInputRef.current?.click()} />}
            </AnimatePresence>

            <motion.div className="landing-actions" variants={entrance} transition={{ duration: 0.5 }}>
              <SampleBagButton onLoad={handleFile} disabled={isLoading} />
              <span className="landing-actions__divider" />
              <span>ROS 1 + ROS 2</span><span>MCAP</span><span>Point clouds</span><span>Gaussian splats</span>
            </motion.div>
          </motion.div>

          <div className="landing-visual">
            <div className="landing-visual__label"><span>LIVE INTERFACE</span><span>60 FPS TARGET</span></div>
            <WorkspacePreview />
            <div className="landing-metrics">
              <Metric value="100%" label="client-side" />
              <Metric value="0 B" label="uploaded" />
              <Metric value="7" label="file formats" />
            </div>
          </div>
        </main>

        <footer className="landing-footer">
          <span>OPEN SOURCE ROS DATA EXPLORATION</span>
          <span className="landing-footer__line" />
          <span>MCAP / DB3 / BAG / PCD / PLY / SPLAT</span>
        </footer>
      </div>
      <NarrowViewportNotice />
    </div>
  );
}

function LandingHeader() {
  return (
    <motion.header className="landing-header" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}>
      <BrandLockup compact />
      <div className="landing-header__context"><span>BAG EXPLORATION</span><i /><span>ROS DATA WORKSPACE</span></div>
      <nav className="landing-header__actions" aria-label="Utility navigation">
        <button type="button" onClick={() => useUiStore.getState().setModal('shortcuts')}>SHORTCUTS</button>
        <button type="button" onClick={() => useUiStore.getState().setModal('about')}>ABOUT</button>
        <a
          className="landing-header__support"
          href="https://donatr.ee/hussain/"
          target="_blank"
          rel="noreferrer"
          aria-label="Support BAGEL on donatr.ee"
        >
          SUPPORT BAGEL
        </a>
      </nav>
    </motion.header>
  );
}

function Capability({ icon, label }: { icon: 'cpu' | 'stream' | 'shield'; label: string }) {
  const paths = {
    cpu: <><rect x="5" y="5" width="10" height="10" rx="2" /><path d="M8 1v4m4-4v4m4 3h4m-4 4h4M8 15v4m4-4v4M1 8h4m-4 4h4" /></>,
    stream: <><path d="M3 12h14M13 8l4 4-4 4" /><path d="M3 6h8M3 18h8" /></>,
    shield: <path d="M10 2 3.5 4.7v4.8c0 4.1 2.7 7.1 6.5 8.5 3.8-1.4 6.5-4.4 6.5-8.5V4.7L10 2Zm-3 8 2 2 4-4" />,
  };
  return <span className="landing-capability"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.35">{paths[icon]}</svg>{label}</span>;
}

function SourceDock({ onUrl, onLive, disabled }: { onUrl: (url: string) => void; onLive: (url: string) => void; disabled: boolean }) {
  const [mode, setMode] = useState<'url' | 'live'>('url');
  const [value, setValue] = useState('');
  const isConnecting = useLiveStore((state) => [...state.statuses.values()].some((status) => status === 'connecting'));
  const valid = mode === 'url' ? /^https?:\/\//i.test(value.trim()) : /^wss?:\/\//i.test(value.trim());

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (disabled || !valid) return;
    if (mode === 'url') onUrl(trimmed);
    else { onLive(trimmed); setValue(''); }
  };

  return (
    <div className="source-dock">
      <div className="source-dock__modes" role="tablist" aria-label="Alternate data sources">
        <button type="button" role="tab" aria-selected={mode === 'url'} onClick={() => { setMode('url'); setValue(''); }}>REMOTE URL</button>
        <button type="button" role="tab" aria-selected={mode === 'live'} onClick={() => { setMode('live'); setValue(''); }}>LIVE ROBOT</button>
      </div>
      <form onSubmit={submit}>
        <span className="source-dock__protocol">{mode === 'url' ? 'HTTPS' : 'WSS'}</span>
        <input value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => setValue((current) => current.trim())} placeholder={mode === 'url' ? 'https://data.example/run.mcap' : 'ws://robot.local:8765'} spellCheck={false} autoComplete="off" disabled={disabled} aria-label={mode === 'url' ? 'Remote bag URL' : 'Live robot WebSocket URL'} />
        <motion.button type="submit" disabled={disabled || !valid} whileHover={valid ? { x: 2 } : undefined} whileTap={valid ? { scale: 0.97 } : undefined}>
          {mode === 'live' && isConnecting ? 'CONNECTING' : mode === 'url' ? 'OPEN' : 'CONNECT'}
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 8h9m-3-3 3 3-3 3" /></svg>
        </motion.button>
      </form>
    </div>
  );
}

function ErrorCard({ error, onDismiss, onChooseFile }: { error: NonNullable<ReturnType<typeof useBagStore.getState>['error']>; onDismiss: () => void; onChooseFile: () => void }) {
  return (
    <motion.div className="landing-error" initial={{ opacity: 0, height: 0, y: -6 }} animate={{ opacity: 1, height: 'auto', y: 0 }} exit={{ opacity: 0, height: 0 }} role="alert">
      <span className="landing-error__code">ERR</span>
      <div><strong>{error.title}</strong><p>{error.detail}</p></div>
      <div className="landing-error__actions">
        {error.action && <button type="button" onClick={error.action.kind === 'choose-file' ? onChooseFile : onDismiss}>{error.action.label}</button>}
        <CopyErrorButton text={error.raw} />
        <button type="button" onClick={onDismiss} aria-label="Dismiss error">CLOSE</button>
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
    <span className="sample-action">
      <motion.button type="button" onClick={load} disabled={fetching || disabled} whileHover={{ x: 2 }} whileTap={{ scale: 0.97 }}>
        {fetching ? 'LOADING SAMPLE' : 'EXPLORE SAMPLE DATA'}
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 8h9m-3-3 3 3-3 3" /></svg>
      </motion.button>
      {sampleError && <small role="alert">Sample failed: {sampleError}</small>}
    </span>
  );
}

function Metric({ value, label }: { value: string; label: string }) { return <div><strong>{value}</strong><span>{label}</span></div>; }

function NarrowViewportNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return <div className="narrow-notice" role="note"><span>BAGEL is designed for a desktop-class viewport.</span><button type="button" onClick={() => setDismissed(true)}>DISMISS</button></div>;
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
