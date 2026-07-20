import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type RefObject } from 'react';

interface FileIngestPanelProps {
  isLoading: boolean;
  progress: number;
  onFile: (file: File) => void | Promise<unknown>;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function FileIngestPanel({ isLoading, progress, onFile, inputRef }: FileIngestPanelProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const reduceMotion = useReducedMotion();

  const onDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current += 1;
    setIsDragOver(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setIsDragOver(false);
  }, []);

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current = 0;
    setIsDragOver(false);
    const file = event.dataTransfer.files.item(0);
    if (file) void onFile(file);
  }, [onFile]);

  const onChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.item(0);
    if (file) void onFile(file);
    event.target.value = '';
  }, [onFile]);

  const activate = () => {
    if (!isLoading) inputRef.current?.click();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  };

  return (
    <motion.div
      className={`ingest-panel${isDragOver ? ' ingest-panel--active' : ''}${isLoading ? ' ingest-panel--loading' : ''}`}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onDrop={onDrop}
      onClick={activate}
      onKeyDown={onKeyDown}
      role="button"
      tabIndex={0}
      aria-label="Drop a ROS bag file here or click to browse"
      aria-busy={isLoading}
      data-testid="file-input-zone"
      animate={{
        scale: isDragOver && !reduceMotion ? 1.012 : 1,
        borderColor: isDragOver ? 'rgba(84, 246, 176, 0.72)' : 'rgba(87, 160, 204, 0.28)',
      }}
      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
    >
      <input ref={inputRef} type="file" accept=".db3,.mcap,.bag,.pcd,.ply,.splat,.ksplat" onChange={onChange} className="hidden" data-testid="file-input" />
      <div className="ingest-panel__corners" aria-hidden="true"><i /><i /><i /><i /></div>
      <AnimatePresence mode="wait" initial={false}>
        {isLoading ? <LoadingSequence key="loading" progress={progress} /> : (
          <motion.div
            key="idle"
            className="ingest-panel__content"
            initial={reduceMotion ? false : { opacity: 0, y: 7 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -7 }}
            transition={{ duration: 0.24 }}
          >
            <motion.div className="ingest-panel__icon" animate={isDragOver && !reduceMotion ? { y: [0, -6, 0] } : { y: 0 }} transition={{ duration: 0.9, repeat: isDragOver ? Infinity : 0 }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
                <path d="M4 15.5v2.25A2.25 2.25 0 0 0 6.25 20h11.5A2.25 2.25 0 0 0 20 17.75V15.5" />
              </svg>
            </motion.div>
            <div><strong>{isDragOver ? 'Release to decode' : 'Drop a recording to begin'}</strong><p>Local-first ingestion for multi-gigabyte robotics datasets</p></div>
            <span className="ingest-panel__browse">BROWSE FILES</span>
            <div className="ingest-panel__formats"><span>.MCAP</span><span>.DB3</span><span>.BAG</span><span>.PCD</span><span>.PLY</span><span>.SPLAT</span></div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function LoadingSequence({ progress }: { progress: number }) {
  const stage = progress < 25 ? 'Reading container' : progress < 70 ? 'Indexing channels' : 'Building workspace';
  return (
    <motion.div className="loading-sequence" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} role="status" aria-live="polite">
      <div className="loading-sequence__radar"><motion.span animate={{ rotate: 360 }} transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }} /><i /></div>
      <div className="loading-sequence__copy"><div><strong>{stage}</strong><span>{Math.round(progress)}%</span></div><p>Parsing stays in this browser process</p></div>
      <div className="loading-sequence__track"><motion.span animate={{ width: `${Math.max(4, progress)}%` }} transition={{ duration: 0.35 }} /></div>
      <div className="loading-sequence__stages" aria-hidden="true">
        <span className={progress >= 10 ? 'is-complete' : ''}>HEADER</span>
        <span className={progress >= 30 ? 'is-complete' : ''}>SCHEMA</span>
        <span className={progress >= 70 ? 'is-complete' : ''}>INDEX</span>
      </div>
    </motion.div>
  );
}
