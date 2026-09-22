/**
 * Pure-function tests for the URL-hash codec behind useUrlState.
 *
 * The hook itself needs a React environment (unavailable here: node test
 * env, no jsdom), so what protects shared links is exercised directly:
 *
 *   - b/p/t/a/bm params survive an encode -> parse round trip, because the
 *     snapshot captured on the first commit is the ONLY copy auto-load and
 *     restore ever read (the hash-write effect may clear the URL first);
 *   - readSnapshotOnce captures that snapshot exactly once, even if the
 *     location hash is wiped before restore runs;
 *   - the `splat` panel kind round-trips (an omitted kind used to abort the
 *     whole layout parse and drop every panel in the hash);
 *   - corrupt hashes degrade to "no restore" instead of throwing.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  encodeHash,
  hasRestoreContent,
  parseHash,
  readSnapshotOnce,
  type ParsedHash,
} from '../../src/hooks/useUrlState';
import type { LayoutNode } from '../../src/store/layoutStore';

describe('parseHash / encodeHash round trip', () => {
  it('round-trips t, b, a, bm and the layout tree', () => {
    const root: LayoutNode = {
      node: 'split',
      id: 'split:live1',
      orientation: 'horizontal',
      children: [
        {
          node: 'panel',
          id: 'image:b1:/camera',
          kind: 'image',
          topicName: '/camera',
          type: '',
          bagId: 'b1',
        },
        {
          node: 'panel',
          id: 'plot:/odom',
          kind: 'plot',
          topicName: '/odom',
          type: '',
        },
      ],
    };
    const encoded = encodeHash(
      12.345,
      root,
      'https://example.com/bags/run.mcap',
      new Map([['b1', 5_000_000_000n]]),
      [{ timeSec: 1.5, label: 'Mark 1' }],
    );

    const parsed = parseHash(`#${encoded}`);

    expect(parsed.timeSec).toBeCloseTo(12.345, 3);
    expect(parsed.bagUrl).toBe('https://example.com/bags/run.mcap');
    expect(parsed.anchors?.get('b1')).toBe(5_000_000_000n);
    expect(parsed.bookmarks).toHaveLength(1);
    expect(parsed.bookmarks![0]).toMatchObject({ timeSec: 1.5, label: 'Mark 1' });
    expect(parsed.root).toMatchObject({
      node: 'split',
      orientation: 'horizontal',
      children: [
        { node: 'panel', kind: 'image', topicName: '/camera', bagId: 'b1' },
        { node: 'panel', kind: 'plot', topicName: '/odom' },
      ],
    });
  });

  it('round-trips a splat panel (kind once missing from the accepted set)', () => {
    const root: LayoutNode = {
      node: 'panel',
      id: 'splat:b2:/points',
      kind: 'splat',
      topicName: '/points',
      type: '',
      bagId: 'b2',
    };
    const parsed = parseHash(`#${encodeHash(0, root, null, null, null)}`);
    expect(parsed.root).toMatchObject({
      node: 'panel',
      kind: 'splat',
      topicName: '/points',
      bagId: 'b2',
      id: 'splat:b2:/points',
    });
  });

  it('keeps sibling panels when a split contains a splat leaf', () => {
    // Before `splat` was added to the accepted kinds, parsePanel returned
    // null for it, parseSplit aborted on the null child, and this hash
    // would have restored NO panels at all.
    const parsed = parseHash('#p=H(Psplat:b1:%2Fcloud,Pplot:%2Fodom)');
    expect(parsed.root).toMatchObject({
      node: 'split',
      orientation: 'horizontal',
      children: [
        { kind: 'splat', topicName: '/cloud', bagId: 'b1' },
        { kind: 'plot', topicName: '/odom' },
      ],
    });
  });
});

describe('parseHash robustness', () => {
  it('degrades corrupt layout encodings to "no restore" without throwing', () => {
    // Unknown kind aborts the enclosing split: whole layout dropped.
    expect(parseHash('#p=H(Pbogus:%2Fx,Pplot:%2Fy)').root).toBeNull();
    // Unclosed split.
    expect(parseHash('#p=V(Pimage:%2Fcaml').root).toBeNull();
    // Not a key=value shape at all.
    expect(() => parseHash('#total-garbage')).not.toThrow();
    expect(parseHash('#total-garbage').root).toBeNull();
  });

  it('ignores malformed t / b / a / bm values individually', () => {
    expect(parseHash('#t=not-a-number').timeSec).toBeUndefined();
    expect(parseHash('#t=-3').timeSec).toBeUndefined();
    expect(parseHash('#b=not a url').bagUrl).toBeUndefined();

    // One bad anchor pair and one bad bookmark must not discard the rest.
    const parsed = parseHash('#a=b1:notanumber,b2:7000000000');
    expect(parsed.anchors?.size).toBe(1);
    expect(parsed.anchors?.get('b2')).toBe(7_000_000_000n);
    expect(parseHash('#bm=NaN,x|1.000,').bookmarks).toBeUndefined();
    expect(parseHash('#bm=1.000,Keep').bookmarks).toHaveLength(1);
  });

  it('never throws on undecodable percent escapes', () => {
    expect(() => parseHash('#%E0%A4%A')).not.toThrow();
    expect(() => parseHash('#p=%FF%FE')).not.toThrow();
    expect(parseHash('#p=Pplot:%E0%A4%A').root).toBeNull();
  });
});

describe('hasRestoreContent (pending shared-link classification)', () => {
  it('treats b/p/t/a/bm params as pending restore state', () => {
    expect(hasRestoreContent(parseHash('#b=https://example.com/x.mcap'))).toBe(true);
    expect(hasRestoreContent(parseHash('#p=Pplot:%2Fodom'))).toBe(true);
    expect(hasRestoreContent(parseHash('#t=3.5'))).toBe(true);
    expect(hasRestoreContent(parseHash('#a=b1:123'))).toBe(true);
    expect(hasRestoreContent(parseHash('#bm=1.000,Mark'))).toBe(true);
  });

  it('treats empty or unknown-only hashes as clearable, not pending', () => {
    expect(hasRestoreContent(parseHash(''))).toBe(false);
    expect(hasRestoreContent(parseHash('#'))).toBe(false);
    expect(hasRestoreContent(parseHash('#unrelated=1'))).toBe(false);
  });
});

describe('readSnapshotOnce (first-commit capture)', () => {
  it('parses the incoming hash once and survives a later wipe of the URL', () => {
    vi.stubGlobal('window', {
      location: { hash: '#t=2.000&p=Pplot:%2Fodom&b=https://example.com/x.mcap' },
    });
    try {
      const ref: { current: ParsedHash | null } = { current: null };
      const first = readSnapshotOnce(ref);
      expect(first.timeSec).toBe(2);
      expect(first.root).not.toBeNull();
      expect(first.bagUrl).toBe('https://example.com/x.mcap');
      expect(hasRestoreContent(first)).toBe(true);

      // Simulate the hash-write effect's clear branch running before the
      // restore effect: the snapshot must not be re-read from the (now
      // empty) location hash.
      (window.location as { hash: string }).hash = '';
      const second = readSnapshotOnce(ref);
      expect(second).toBe(first);
      expect(second.timeSec).toBe(2);
      expect(second.root).not.toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('parses an empty hash when no window is available', () => {
    const ref: { current: ParsedHash | null } = { current: null };
    const parsed = readSnapshotOnce(ref);
    expect(parsed.root).toBeNull();
    expect(hasRestoreContent(parsed)).toBe(false);
  });
});
