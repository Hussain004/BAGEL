import { useEffect, useState } from 'react';
import {
  loadRecentEntries,
  loadHandle,
  removeRecentEntry,
  type RecentFileEntry,
} from '../../utils/recentFiles';

interface RecentFilesProps {
  onFile: (file: File) => void | Promise<unknown>;
  onUrl: (url: string) => void | Promise<unknown>;
  disabled: boolean;
}

/**
 * RecentFiles - reopen the files you opened recently, in one click.
 *
 * Local entries reopen through their persisted FileSystemFileHandle after a
 * single permission prompt; no file picker, no re-navigation of your disk, no
 * copy. URL entries just re-issue the remote load, which works in any browser.
 *
 * The component is hidden on browsers without the File System Access API
 * unless there are URL entries to show, and hidden entirely when there is
 * nothing recent: an empty "Recent" section is decoration, not help.
 */
export function RecentFiles({ onFile, onUrl, disabled }: RecentFilesProps) {
  const [entries, setEntries] = useState<RecentFileEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadRecentEntries().then((loaded) => {
      if (!cancelled) setEntries(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (entries === null) return null;

  const visible = entries.filter((entry) => entry.url || typeof window.showOpenFilePicker === 'function');
  if (visible.length === 0) return null;

  const reopen = async (entry: RecentFileEntry) => {
    if (disabled) return;
    if (entry.url) {
      void onUrl(entry.url);
      return;
    }
    const handle = await loadHandle(entry.id);
    if (!handle) return;
    // requestPermission needs a user gesture, which the click provides.
    const permission = await handle.requestPermission({ mode: 'read' });
    if (permission !== 'granted') return;
    const file = await handle.getFile();
    void onFile(file);
  };

  const remove = (entry: RecentFileEntry) => {
    void removeRecentEntry(entry.id).then(setEntries);
  };

  return (
    <div className="recent-files" aria-label="Recently opened files">
      <div className="recent-files__label">RECENT</div>
      <ul className="recent-files__list">
        {visible.map((entry) => (
          <li key={entry.id} className="recent-files__item">
            <button
              type="button"
              className="recent-files__open"
              onClick={() => void reopen(entry)}
              disabled={disabled}
              title={entry.url ? `Reopen ${entry.name}` : `Reopen ${entry.name} (${formatSize(entry.size)})`}
            >
              <span className="recent-files__icon" aria-hidden="true">
                {entry.url ? <LinkIcon /> : <FileIcon />}
              </span>
              <span className="recent-files__name">{shorten(entry.name)}</span>
              {!entry.url && <span className="recent-files__meta">{formatSize(entry.size)}</span>}
            </button>
            <button
              type="button"
              className="recent-files__remove"
              onClick={() => remove(entry)}
              aria-label={`Remove ${entry.name} from recent files`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Basename for files, full text for URLs, capped so the row never wraps. */
function shorten(name: string): string {
  if (name.length <= 44) return name;
  return `${name.slice(0, 22)}…${name.slice(-19)}`;
}

function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function FileIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M13 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8l-5-5z" />
      <path d="M13 3v5h5" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}