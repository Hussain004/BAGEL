import { useCallback, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent, type RefObject } from 'react';
import { recordRecentFile, supportsFileSystemAccess } from '../../utils/recentFiles';
import { collectDropped, ingestFromFiles, type IngestFile } from '../../utils/droppedFiles';

interface FileIngestPanelProps {
  isLoading: boolean;
  progress: number;
  onFiles: (items: IngestFile[]) => void | Promise<unknown>;
  inputRef: RefObject<HTMLInputElement | null>;
}

/**
 * Extensions BAGEL accepts, shared by the picker and the fallback input so the
 * two paths never drift apart.
 */
const ACCEPTED_EXTENSIONS = ['.db3', '.mcap', '.bag', '.pcd', '.ply', '.splat', '.ksplat', '.spz'] as const;

/**
 * The file types shown in the File System Access picker. The fallback input
 * gets the same list as an accept string.
 */
const PICKER_TYPES = [
  {
    description: 'ROS recordings and point clouds',
    accept: {
      'application/octet-stream': [...ACCEPTED_EXTENSIONS],
    },
  },
];

const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(',');

export function FileIngestPanel({ isLoading, progress, onFiles, inputRef }: FileIngestPanelProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

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

    // DataTransfer empties once this handler returns, so both the file-system
    // handle (Chromium only, lets a single file be reopened from recents) and
    // the folder-expanding collector are started synchronously, then awaited.
    const dt = event.dataTransfer;
    const only = dt.items.length === 1 ? dt.items[0] : null;
    const handleP: Promise<FileSystemHandle | null> =
      only && only.kind === 'file' && typeof only.getAsFileSystemHandle === 'function'
        ? only.getAsFileSystemHandle().catch(() => null)
        : Promise.resolve(null);
    const collected = collectDropped(dt);
    void Promise.all([handleP, collected]).then(([handle, items]) => {
      if (items.length === 1 && handle && handle.kind === 'file') {
        void recordRecentFile(items[0]!.file, handle as FileSystemFileHandle);
      }
      void onFiles(items);
    });
  }, [onFiles]);

  const onChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const items = ingestFromFiles(event.target.files ?? []);
    if (items.length === 1) {
      // The input path has no handle to persist, so it lands in recents as
      // metadata only: the row shows, reopening falls back to the picker.
      void recordRecentFile(items[0]!.file, null);
    }
    if (items.length > 0) void onFiles(items);
    event.target.value = '';
  }, [onFiles]);

  const activate = () => {
    if (isLoading) return;
    // Use the File System Access picker when it exists so the handle can be
    // stored for one-click reopen later. Falling back to the input matters:
    // Firefox and Safari have no picker at all.
    if (supportsFileSystemAccess()) {
      void window
        .showOpenFilePicker({ types: PICKER_TYPES, multiple: true })
        .then(async (handles) => {
          const files = await Promise.all(handles.map((h) => h.getFile()));
          // Only a lone file goes to recents: a split recording would need
          // every part's handle to reopen, which the recents list can't hold.
          if (handles.length === 1) void recordRecentFile(files[0]!, handles[0]!);
          void onFiles(ingestFromFiles(files));
        })
        .catch((error: unknown) => {
          // AbortError is the user pressing Escape in the picker; anything
          // else is a reason to try the input path instead of failing.
          if (error instanceof DOMException && error.name === 'AbortError') return;
          inputRef.current?.click();
        });
      return;
    }
    inputRef.current?.click();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate();
    }
  };

  return (
    <>
      <div
        className={`dropzone${isDragOver ? ' dropzone--active' : ''}${isLoading ? ' dropzone--loading' : ''}`}
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
      >
        <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR} onChange={onChange} className="hidden" data-testid="file-input" />
        {isLoading ? <LoadingSequence progress={progress} /> : (
          <>
            <div className="dropzone__main">
              <span className="dropzone__icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" />
                  <path d="M4 15.5v2.25A2.25 2.25 0 0 0 6.25 20h11.5A2.25 2.25 0 0 0 20 17.75V15.5" />
                </svg>
              </span>
              <div>
                <strong>{isDragOver ? 'Release to open' : 'Drop a recording here'}</strong>
                <p>or choose it from your computer. It is read in this tab and never uploaded.</p>
              </div>
              <span className="dropzone__cta">Choose files</span>
            </div>
            <div className="dropzone__meta">
              <span>MCAP, DB3, BAG, PCD, PLY, SPLAT, SPZ</span>
              <button
                type="button"
                disabled={isLoading}
                onClick={(event) => { event.stopPropagation(); folderInputRef.current?.click(); }}
                onKeyDown={(event) => event.stopPropagation()}
                title="Pick a recording's folder: split bags (name_0.mcap, name_1.mcap, ...) open as one recording"
              >
                Open a folder
              </button>
            </div>
          </>
        )}
      </div>
      <input ref={folderInputRef} type="file" onChange={onChange} className="hidden" data-testid="folder-input" {...{ webkitdirectory: '' }} />
    </>
  );
}

function LoadingSequence({ progress }: { progress: number }) {
  const stage = progress < 25 ? 'Reading the file' : progress < 70 ? 'Indexing topics' : 'Building the workspace';
  return (
    <div className="loading" role="status" aria-live="polite">
      <div className="loading__copy"><strong>{stage}</strong><span>{Math.round(progress)}%</span></div>
      <div className="loading__track"><span style={{ width: `${Math.max(4, progress)}%` }} /></div>
      <p>Parsing stays in this browser tab.</p>
    </div>
  );
}
