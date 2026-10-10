/**
 * Turn whatever the user handed us (a multi-select, a dropped folder, a mix)
 * into a flat list of files that remember which folder they came from, so
 * `groupBagFiles` never merges parts of two different recordings.
 */

import { groupBagFiles, type FileGroup } from './bagGroups';
import { useBagStore } from '../store/bagStore';
import { classifyBagError } from './actionableError';

export interface IngestFile {
  name: string;
  dir: string;
  file: File;
}

/** Folders deeper than this are ignored; bag directories are flat. */
const MAX_DEPTH = 3;

function dirOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/');
  return slash < 0 ? '' : relativePath.slice(0, slash);
}

/** Wrap picker / `<input>` files. `webkitRelativePath` is set for folder inputs. */
export function ingestFromFiles(files: Iterable<File>): IngestFile[] {
  return [...files].map((file) => ({ name: file.name, dir: dirOf(file.webkitRelativePath ?? ''), file }));
}

function readEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  // readEntries returns at most ~100 entries per call, so keep calling until
  // it returns an empty batch or a large folder is silently truncated.
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

async function walk(entry: FileSystemEntry, dir: string, depth: number, out: IngestFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.push({ name: file.name, dir, file });
  } else if (entry.isDirectory && depth < MAX_DEPTH) {
    const children = await readEntries((entry as FileSystemDirectoryEntry).createReader());
    const here = dir ? `${dir}/${entry.name}` : entry.name;
    for (const child of children) await walk(child, here, depth + 1, out);
  }
}

/**
 * Collect files from a drop event.
 *
 * `DataTransfer` is emptied once the event handler returns, so every entry is
 * grabbed synchronously before the first await.
 */
export async function collectDropped(dt: DataTransfer): Promise<IngestFile[]> {
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) entries.push(entry);
  }
  const fallback = ingestFromFiles(Array.from(dt.files));
  if (entries.length === 0) return fallback;
  const out: IngestFile[] = [];
  try {
    for (const entry of entries) await walk(entry, '', 0, out);
  } catch {
    return fallback;
  }
  return out.length > 0 ? out : fallback;
}

/** Group, then load: the first recording replaces the workspace in `replace` mode. */
export async function openBagFiles(
  items: IngestFile[],
  mode: 'replace' | 'add',
): Promise<Array<FileGroup<IngestFile>>> {
  const store = useBagStore.getState();
  const metadata = items.find((i) => i.name === 'metadata.yaml');
  const metadataText = metadata ? await metadata.file.text().catch(() => undefined) : undefined;
  const groups = groupBagFiles(items, metadataText);
  if (groups.length === 0) {
    useBagStore.setState({
      error: classifyBagError(
        'Unsupported file format. BAGEL supports .mcap, .db3, .bag, .ulg, .pcd, .ply, .splat, .ksplat, and .spz files.',
        'file',
      ),
    });
    return groups;
  }
  for (const g of groups) {
    if (g.missing.length > 0) {
      console.warn(`${g.displayName}: part ${g.missing.join(', ')} not found, opening what is there.`);
    }
  }
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    const files = g.files.map((f) => f.file);
    if (i === 0 && mode === 'replace') await store.loadBagFiles(files, g.displayName);
    else await store.addBagFromFiles(files, g.displayName);
  }
  return groups;
}
