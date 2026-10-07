/**
 * Tests for the recents-list logic in recentFiles.
 *
 * The IndexedDB round trip is deliberately thin (get/put on two stores) and is
 * exercised in the browser suite instead; what is pinned here is the part that
 * can silently go wrong in a refactor: ordering, dedupe by the (name, size,
 * lastModified) triple, and the cap. A recents list that re-orders wrong or
 * never evicts is worse than none, because it is chrome people learn to trust.
 */

import { describe, it, expect } from 'vitest';
import {
  upsertRecentEntry,
  fileEntryId,
  MAX_RECENT_FILES,
  type RecentFileEntry,
} from '../../src/utils/recentFiles';

function entry(name: string, openedAt: number, size = 1024, lastModified = 100): RecentFileEntry {
  return {
    id: fileEntryId(name, size, lastModified),
    name,
    size,
    lastModified,
    openedAt,
  };
}

describe('fileEntryId', () => {
  it('keys on the (name, size, lastModified) triple', () => {
    expect(fileEntryId('run.mcap', 1024, 100)).toBe('run.mcap:1024:100');
  });

  it('distinguishes a re-recorded file of the same name', () => {
    // Same path, new bytes: different id, so the stale handle is not reused.
    expect(fileEntryId('run.mcap', 1024, 100)).not.toBe(fileEntryId('run.mcap', 1024, 101));
    expect(fileEntryId('run.mcap', 1024, 100)).not.toBe(fileEntryId('run.mcap', 2048, 100));
  });
});

describe('upsertRecentEntry', () => {
  it('prepends the new entry', () => {
    const list = upsertRecentEntry([entry('b.mcap', 1)], entry('a.mcap', 2));
    expect(list.map((e) => e.name)).toEqual(['a.mcap', 'b.mcap']);
  });

  it('dedupes by id, moving the re-opened entry to the front', () => {
    const initial = [entry('a.mcap', 1), entry('b.mcap', 2), entry('c.mcap', 3)];
    const list = upsertRecentEntry(initial, entry('b.mcap', 4));
    expect(list.map((e) => e.name)).toEqual(['b.mcap', 'a.mcap', 'c.mcap']);
    expect(list).toHaveLength(3);
    // The newest openedAt wins.
    expect(list[0].openedAt).toBe(4);
  });

  it('caps the list at MAX_RECENT_FILES', () => {
    let list: RecentFileEntry[] = [];
    for (let i = 0; i < 20; i++) {
      list = upsertRecentEntry(list, entry(`run-${i}.mcap`, i));
    }
    expect(list).toHaveLength(MAX_RECENT_FILES);
    // The most recent eight survive, in order.
    expect(list[0].name).toBe('run-19.mcap');
    expect(list[MAX_RECENT_FILES - 1].name).toBe('run-12.mcap');
  });

  it('respects an explicit cap parameter', () => {
    const list = upsertRecentEntry(
      [entry('a.mcap', 1), entry('b.mcap', 2)],
      entry('c.mcap', 3),
      2,
    );
    expect(list.map((e) => e.name)).toEqual(['c.mcap', 'a.mcap']);
  });

  it('handles an empty list', () => {
    expect(upsertRecentEntry([], entry('a.mcap', 1))).toHaveLength(1);
  });

  it('does not dedupe files that share a name but differ in content', () => {
    const a = entry('run.mcap', 1, 1024, 100);
    const b = entry('run.mcap', 2, 1024, 200);
    const list = upsertRecentEntry([a], b);
    expect(list).toHaveLength(2);
  });

  it('does not dedupe a URL against a file with a matching display name', () => {
    const file = entry('https://example.com/run.mcap', 1);
    const url: RecentFileEntry = {
      id: 'url:https://example.com/run.mcap',
      name: 'https://example.com/run.mcap',
      size: 0,
      lastModified: 2,
      openedAt: 2,
      url: 'https://example.com/run.mcap',
    };
    const list = upsertRecentEntry([file], url);
    expect(list).toHaveLength(2);
  });
});