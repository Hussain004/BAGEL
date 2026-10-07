/**
 * Tests for the palette's fuzzy matcher.
 *
 * The ranking tiers are the whole point of the feature, so they are asserted
 * as *orderings* rather than as absolute scores. Hardcoding a score would make
 * these tests break every time a weight is tuned, while still not catching the
 * actual regression: two commands swapping places.
 */

import { describe, it, expect } from 'vitest';
import { fuzzyScore, fuzzyFilter } from '../../src/utils/fuzzy';

describe('fuzzyScore', () => {
  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('zzz', '/camera/image_raw')).toBeNull();
    // Out of order is not a subsequence either.
    expect(fuzzyScore('muci', '/camera/image_raw')).toBeNull();
  });

  it('matches an empty query against anything', () => {
    expect(fuzzyScore('', '/scan')).not.toBeNull();
  });

  it('is case-insensitive in both directions', () => {
    expect(fuzzyScore('CAMERA', '/camera/image_raw')).not.toBeNull();
    expect(fuzzyScore('camera', '/CAMERA/image_raw')).not.toBeNull();
  });

  it('ranks a prefix above a word-start match above a scattered subsequence', () => {
    // Deliberately no leading slash on the target. With `/camera/image_raw`
    // neither `cam` nor `raw` is a true prefix (both start after the `/`), so
    // they correctly tie; testing the tiers needs a target that actually has a
    // first character.
    const target = 'camera/image_raw';
    const prefix = fuzzyScore('cam', target)!;
    const wordStart = fuzzyScore('raw', target)!;
    const scattered = fuzzyScore('mra', target)!;

    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(scattered);
  });

  it('prefers the later word-start match over an earlier accidental one', () => {
    // The greedy-scan bug this guards: a naive left-to-right scan takes the `r`
    // in "ca[r]a" and scores `raw` no better than a scattered `mra`. The
    // matcher must instead find "ima[r]ew".
    const target = '/camera/image_raw';
    expect(fuzzyScore('raw', target)!).toBeGreaterThan(fuzzyScore('mra', target)!);
  });

  it('rewards contiguous runs over gapped matches of the same letters', () => {
    const contiguous = fuzzyScore('image', '/camera/image_raw')!;
    const gapped = fuzzyScore('image', '/i/m/a/g/e/nope')!;
    expect(contiguous).toBeGreaterThan(gapped);
  });

  it('prefers the shorter target when both match', () => {
    expect(fuzzyScore('scan', '/scan')!).toBeGreaterThan(fuzzyScore('scan', '/scan_filtered')!);
  });

  it('treats / and _ as skippable so abbreviated topic queries work', () => {
    // "camimg" is how people actually type a camera topic.
    expect(fuzzyScore('camimg', '/camera/image_raw')).not.toBeNull();
    expect(fuzzyScore('camimg', '/camera_rear/image_raw')).not.toBeNull();
    // Dashes too, for those used to non-ROS naming.
    expect(fuzzyScore('camimg', '/camera-front/image-raw')).not.toBeNull();
  });

  it('still awards a word-start bonus after a separator', () => {
    const afterSlash = fuzzyScore('raw', '/camera/image_raw')!;
    const midWord = fuzzyScore('mra', '/camera/image_raw')!;
    expect(afterSlash).toBeGreaterThan(midWord);
  });

  it('matches single characters', () => {
    expect(fuzzyScore('/', '/camera')).not.toBeNull();
    expect(fuzzyScore('a', '/camera')).not.toBeNull();
  });

  it('handles multi-byte targets without throwing', () => {
    expect(fuzzyScore('bä', '/bäcker')).not.toBeNull();
    expect(fuzzyScore('xyz', '/bäcker')).toBeNull();
  });
});

describe('fuzzyFilter', () => {
  const commands = [
    { id: 'open-image', label: 'Open /camera/image_raw in Image viewer' },
    { id: 'open-scan-3d', label: 'Open /scan in 3D scene' },
    { id: 'open-odom', label: 'Open /odom in Trajectory' },
    { id: 'theme', label: 'Toggle theme' },
    { id: 'copy-link', label: 'Copy link' },
    { id: 'bookmark', label: 'Add bookmark at playhead' },
    { id: 'export-clip', label: 'Export clip' },
  ];

  it('returns everything, unranked, for an empty query', () => {
    const result = fuzzyFilter(commands, '', (c) => c.label);
    expect(result.map((r) => r.item.id)).toEqual(commands.map((c) => c.id));
  });

  it('puts the intended match first and buries weak subsequence hits below it', () => {
    // Fuzzy matching keeps anything that is a subsequence, so `theme` also
    // weakly matches "Add bookmark at playhead" (t...h...e...m...e). That is
    // correct and intended, the same trade-off VS Code makes: better to show a
    // weak hit at the bottom than to hide a command the user can see. What
    // matters is the ranking.
    const result = fuzzyFilter(commands, 'theme', (c) => c.label);
    expect(result.length).toBeGreaterThan(1);
    expect(result[0].item.id).toBe('theme');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });

  it('drops items that are not a subsequence at all', () => {
    const result = fuzzyFilter(commands, 'zzqqxx', (c) => c.label);
    expect(result).toEqual([]);
  });

  it('puts the best match first', () => {
    const result = fuzzyFilter(commands, 'copy', (c) => c.label);
    expect(result[0].item.id).toBe('copy-link');
  });

  it('searches every key when an item has several', () => {
    const result = fuzzyFilter(
      [{ id: 'x', label: 'nothing helpful', alt: 'camera' }],
      'camera',
      (c) => [c.label, c.alt],
    );
    expect(result).toHaveLength(1);
  });

  it('uses the best-scoring key, not the first match', () => {
    // "camera" as a secondary key should not outrank a literal prefix hit.
    const result = fuzzyFilter(
      [
        { id: 'secondary', label: 'zzz', alt: 'camera/image' },
        { id: 'literal', label: 'camera', alt: 'qqq' },
      ],
      'camera',
      (c) => [c.label, c.alt],
    );
    expect(result[0].item.id).toBe('literal');
  });

  it('respects the limit and does not return the whole list', () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ id: String(i), label: `item ${i}` }));
    const result = fuzzyFilter(many, 'item', (c) => c.label, 50);
    expect(result).toHaveLength(50);
  });

  it('preserves the caller order on ties', () => {
    const tied = [
      { id: 'first', label: 'aaa' },
      { id: 'second', label: 'aaa' },
      { id: 'third', label: 'aaa' },
    ];
    const result = fuzzyFilter(tied, 'aaa', (c) => c.label);
    expect(result.map((r) => r.item.id)).toEqual(['first', 'second', 'third']);
  });

  it('returns nothing for a query that matches nothing', () => {
    expect(fuzzyFilter(commands, 'qqqqqq', (c) => c.label)).toEqual([]);
  });
});