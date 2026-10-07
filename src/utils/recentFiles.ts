/**
 * Recent files, via the File System Access API.
 *
 * Re-opening the same 2 GB bag means navigating the file picker every time,
 * on every visit. Chromium browsers can persist a `FileSystemFileHandle` in
 * IndexedDB and re-open it after one permission click: no copy, no upload,
 * and the file stays exactly where the user left it.
 *
 * Two storage halves, deliberately separate:
 *  - **metadata** (name, size, lastModified, openedAt): JSON in a single
 *    IndexedDB record, because the list ordering and dedupe logic is easier to
 *    keep honest when it is pure data.
 *  - **handles**: `FileSystemFileHandle`s, which are not JSON-serialisable, in
 *    a second IndexedDB record keyed by the same id. A metadata entry with no
 *    handle (written before the user granted access, or after the browser
 *    dropped it) degrades to a plain row the user can dismiss.
 *
 * Firefox and Safari have no File System Access API at all: the landing page
 * hides the section in that case and the plain file input is the fallback, so
 * nothing here runs.
 */

export const MAX_RECENT_FILES = 8;

export interface RecentFileEntry {
  /** Stable dedupe key: `${name}:${size}:${lastModified}` for files, `url:${url}` for remotes. */
  id: string;
  /** Display name (basename for files, full URL for remotes). */
  name: string;
  /** Byte size for files; 0 for remotes. */
  size: number;
  /** File's lastModified timestamp for files; openedAt for remotes. */
  lastModified: number;
  /** When this entry was last opened, for ordering. */
  openedAt: number;
  /** Remote entries have no handle and reopen by URL instead. */
  url?: string;
}

/**
 * Reconcile an entry into a recents list: remove any existing entry with the
 * same id, prepend the new one, cap the list.
 *
 * Pure and exported for tests. The IndexedDB layer is deliberately the only
 * part of this module that touches storage, so this logic never depends on a
 * browser environment.
 */
export function upsertRecentEntry(
  list: RecentFileEntry[],
  entry: RecentFileEntry,
  cap = MAX_RECENT_FILES,
): RecentFileEntry[] {
  const deduped = list.filter((existing) => existing.id !== entry.id);
  return [entry, ...deduped].slice(0, cap);
}

/** File id from the (name, size, lastModified) triple the roadmap keys on. */
export function fileEntryId(name: string, size: number, lastModified: number): string {
  return `${name}:${size}:${lastModified}`;
}

/** True when the File System Access picker exists in this browser. */
export function supportsFileSystemAccess(): boolean {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

// ---------------------------------------------------------------------------
// IndexedDB persistence
// ---------------------------------------------------------------------------

const DB_NAME = 'bagel:recent-files';
const DB_VERSION = 1;
const META_STORE = 'meta';
const HANDLE_STORE = 'handles';
const LIST_KEY = 'recent';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = run(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * Load the recents list. Returns [] on any storage failure: a recents list is
 * a convenience, and nothing about the app should depend on it working.
 */
export async function loadRecentEntries(): Promise<RecentFileEntry[]> {
  try {
    const stored = await withStore(META_STORE, 'readonly', (s) => s.get(LIST_KEY));
    return Array.isArray(stored) ? (stored as RecentFileEntry[]) : [];
  } catch {
    return [];
  }
}

/** Persist the recents list. */
async function saveRecentEntries(entries: RecentFileEntry[]): Promise<void> {
  try {
    await withStore(META_STORE, 'readwrite', (s) => s.put(entries, LIST_KEY));
  } catch {
    // Best-effort: a failed save just means the list is stale next session.
  }
}

/** Store the handle for a file entry (no-op for remotes, which have none). */
export async function saveHandle(id: string, handle: FileSystemFileHandle): Promise<void> {
  try {
    await withStore(HANDLE_STORE, 'readwrite', (s) => s.put(handle, id));
  } catch {
    // Without the handle the entry still shows, it just cannot reopen in one click.
  }
}

/** Retrieve a stored handle, or null if the browser has dropped it. */
export async function loadHandle(id: string): Promise<FileSystemFileHandle | null> {
  try {
    const handle = await withStore(HANDLE_STORE, 'readonly', (s) => s.get(id));
    return (handle as FileSystemFileHandle) ?? null;
  } catch {
    return null;
  }
}

async function deleteHandle(id: string): Promise<void> {
  try {
    await withStore(HANDLE_STORE, 'readwrite', (s) => s.delete(id));
  } catch {
    // Nothing to clean up if the handle store itself is unreachable.
  }
}

/** Record a local file open, returning the updated list. */
export async function recordRecentFile(
  file: File,
  handle: FileSystemFileHandle | null,
): Promise<RecentFileEntry[]> {
  const id = fileEntryId(file.name, file.size, file.lastModified);
  const entries = upsertRecentEntry(await loadRecentEntries(), {
    id,
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    openedAt: Date.now(),
  });
  await saveRecentEntries(entries);
  if (handle) await saveHandle(id, handle);
  return entries;
}

/** Record a remote-URL open, returning the updated list. */
export async function recordRecentUrl(url: string): Promise<RecentFileEntry[]> {
  const id = `url:${url}`;
  const entries = upsertRecentEntry(await loadRecentEntries(), {
    id,
    name: url,
    size: 0,
    lastModified: Date.now(),
    openedAt: Date.now(),
    url,
  });
  await saveRecentEntries(entries);
  return entries;
}

/** Remove an entry and its handle, returning the updated list. */
export async function removeRecentEntry(id: string): Promise<RecentFileEntry[]> {
  const entries = (await loadRecentEntries()).filter((entry) => entry.id !== id);
  await saveRecentEntries(entries);
  await deleteHandle(id);
  return entries;
}