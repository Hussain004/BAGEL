import { describe, expect, it } from 'vitest';
import { collectDropped, ingestFromFiles } from '../../src/utils/droppedFiles';

function fileEntry(name: string): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (ok: (f: File) => void) => ok(new File(['x'], name)),
  } as unknown as FileSystemFileEntry;
}

/** A directory whose reader hands back `batches`, then an empty batch, like Chromium's 100-at-a-time. */
function dirEntry(name: string, batches: FileSystemEntry[][]): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let i = 0;
      return { readEntries: (ok: (b: FileSystemEntry[]) => void) => ok(batches[i++] ?? []) };
    },
  } as unknown as FileSystemDirectoryEntry;
}

function transfer(entries: FileSystemEntry[], files: File[] = []): DataTransfer {
  return {
    items: entries.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e })),
    files,
  } as unknown as DataTransfer;
}

describe('collectDropped', () => {
  it('expands a dropped folder and records the folder for each file', async () => {
    const dir = dirEntry('rosbag2_x', [[fileEntry('a_0.mcap'), fileEntry('metadata.yaml')]]);
    const out = await collectDropped(transfer([dir]));
    expect(out.map((o) => `${o.dir}/${o.name}`).sort()).toEqual(['rosbag2_x/a_0.mcap', 'rosbag2_x/metadata.yaml']);
  });

  it('keeps reading until the reader is exhausted (large folders)', async () => {
    const first = Array.from({ length: 100 }, (_, i) => fileEntry(`p_${i}.mcap`));
    const second = [fileEntry('p_100.mcap')];
    const out = await collectDropped(transfer([dirEntry('big', [first, second])]));
    expect(out).toHaveLength(101);
  });

  it('handles loose files and nested folders together', async () => {
    const inner = dirEntry('inner', [[fileEntry('deep.mcap')]]);
    const outer = dirEntry('outer', [[inner, fileEntry('top.mcap')]]);
    const out = await collectDropped(transfer([fileEntry('loose.bag'), outer]));
    expect(out.map((o) => `${o.dir}|${o.name}`).sort()).toEqual(['outer/inner|deep.mcap', 'outer|top.mcap', '|loose.bag']);
  });

  it('falls back to dt.files when no entries are available', async () => {
    const dt = { items: [{ kind: 'file' }], files: [new File(['x'], 'only.mcap')] } as unknown as DataTransfer;
    const out = await collectDropped(dt);
    expect(out.map((o) => o.name)).toEqual(['only.mcap']);
  });

  it('falls back to dt.files if reading a folder throws', async () => {
    const bad = {
      isFile: false,
      isDirectory: true,
      name: 'x',
      createReader: () => ({ readEntries: (_ok: unknown, fail: (e: Error) => void) => fail(new Error('denied')) }),
    } as unknown as FileSystemDirectoryEntry;
    const out = await collectDropped(transfer([bad], [new File(['x'], 'fallback.mcap')]));
    expect(out.map((o) => o.name)).toEqual(['fallback.mcap']);
  });
});

describe('ingestFromFiles', () => {
  it('derives the folder from webkitRelativePath', () => {
    const f = new File(['x'], 'a_0.mcap');
    Object.defineProperty(f, 'webkitRelativePath', { value: 'bagdir/a_0.mcap' });
    expect(ingestFromFiles([f])).toEqual([{ name: 'a_0.mcap', dir: 'bagdir', file: f }]);
    expect(ingestFromFiles([new File(['x'], 'b.mcap')])[0]!.dir).toBe('');
  });
});
