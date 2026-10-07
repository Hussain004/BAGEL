import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EMBED,
  embedExtras,
  fullAppHash,
  readEmbedConfig,
  withEmbed,
} from '../../src/utils/embedConfig';
import { encodeHash } from '../../src/hooks/useUrlState';

describe('readEmbedConfig', () => {
  it('is off for an ordinary link', () => {
    expect(readEmbedConfig('')).toEqual(DEFAULT_EMBED);
    expect(readEmbedConfig('#t=1.000&p=Pplot:%2Fodom&b=https%3A%2F%2Fx.org%2Fa.mcap')).toEqual(DEFAULT_EMBED);
  });

  it('reads every param, with or without the leading #', () => {
    const want = { embed: true, theme: 'light', autoplay: true, loop: true };
    expect(readEmbedConfig('#embed=1&theme=light&autoplay=1&loop=1')).toEqual(want);
    expect(readEmbedConfig('embed=true&theme=light&autoplay=true&loop=true')).toEqual(want);
  });

  it('only accepts known values, so a typo never switches a mode on', () => {
    expect(readEmbedConfig('#embed=yes&autoplay=2&loop=0').embed).toBe(false);
    expect(readEmbedConfig('#embed=yes&autoplay=2&loop=0').autoplay).toBe(false);
    expect(readEmbedConfig('#theme=blue').theme).toBeNull();
    expect(readEmbedConfig('#embed=0').embed).toBe(false);
  });

  it('is unaffected by the other params in the same hash', () => {
    const c = readEmbedConfig(`#b=${encodeURIComponent('https://x.org/a.mcap?embed=1')}&t=3.000&embed=1`);
    expect(c.embed).toBe(true);
  });
});

describe('embedExtras', () => {
  it('emits only what is on', () => {
    expect(embedExtras(DEFAULT_EMBED)).toEqual({});
    expect(embedExtras({ embed: true, theme: 'dark', autoplay: false, loop: true })).toEqual({
      embed: '1', theme: 'dark', loop: '1',
    });
  });
  it('round-trips through readEmbedConfig', () => {
    const cfg = { embed: true, theme: 'light' as const, autoplay: true, loop: true };
    const hash = new URLSearchParams(embedExtras(cfg)).toString();
    expect(readEmbedConfig(hash)).toEqual(cfg);
  });
});

describe('fullAppHash / withEmbed', () => {
  it('strips only embed params, keeping the rest of the view', () => {
    const hash = '#t=2.000&p=Pplot%3A%2Fodom&embed=1&theme=light&autoplay=1&loop=1&b=https%3A%2F%2Fx.org%2Fa.mcap';
    const full = fullAppHash(hash);
    expect(readEmbedConfig(full)).toEqual(DEFAULT_EMBED);
    expect(full).toContain('t=2.000');
    expect(full).toContain('b=https%3A%2F%2Fx.org%2Fa.mcap');
  });
  it('withEmbed adds the flag and optional theme without disturbing the view', () => {
    const e = withEmbed('#t=2.000', { theme: 'dark' });
    expect(readEmbedConfig(e)).toMatchObject({ embed: true, theme: 'dark' });
    expect(e).toContain('t=2.000');
    expect(fullAppHash(e)).toBe('t=2.000');
  });
});

describe('encodeHash keeps embed params across rewrites', () => {
  it('writes the extras after the view state', () => {
    const hash = encodeHash(1.5, null, 'https://x.org/a.mcap', null, null, { embed: '1', theme: 'light' });
    const params = new URLSearchParams(hash);
    expect(params.get('embed')).toBe('1');
    expect(params.get('theme')).toBe('light');
    expect(params.get('t')).toBe('1.500');
    expect(params.get('b')).toBe('https://x.org/a.mcap');
  });
  it('is byte-identical to before when there are no extras', () => {
    const a = encodeHash(1.5, null, null, null, null);
    expect(encodeHash(1.5, null, null, null, null, {})).toBe(a);
    expect(a).toBe('t=1.500');
  });
});
