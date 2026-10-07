/**
 * Embed mode: BAGEL inside an iframe on someone else's page.
 *
 * A paper's project page, a dataset site or a course can show a live,
 * scrubbable bag instead of a video. The mode is switched on by hash params,
 * the same channel as every other piece of shareable state, so one link works
 * in the full app and in an iframe:
 *
 *   #b=<bag url>&p=...&t=12.5&embed=1&theme=light&autoplay=1&loop=1
 *
 * Pure and DOM-free so the parsing rules can be tested without a browser.
 */

export interface EmbedConfig {
  /** Render only the panels and a compact timeline. */
  embed: boolean;
  /** Force a theme to match the host page; null follows the viewer's own. */
  theme: 'light' | 'dark' | null;
  /** Start playing as soon as the bag is ready. */
  autoplay: boolean;
  /** Loop playback at the end. */
  loop: boolean;
}

export const DEFAULT_EMBED: EmbedConfig = { embed: false, theme: null, autoplay: false, loop: false };

/** Hash keys that belong to embed mode and must survive hash rewrites. */
export const EMBED_KEYS = ['embed', 'theme', 'autoplay', 'loop'] as const;

const truthy = (v: string | null): boolean => v === '1' || v === 'true';

export function readEmbedConfig(hash: string): EmbedConfig {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const theme = params.get('theme');
  return {
    embed: truthy(params.get('embed')),
    theme: theme === 'light' || theme === 'dark' ? theme : null,
    autoplay: truthy(params.get('autoplay')),
    loop: truthy(params.get('loop')),
  };
}

/**
 * The embed params to carry through a hash rewrite. `useUrlState` regenerates
 * the whole hash on every change, so anything it does not write back is lost:
 * without this, the first scrub would silently turn an embed into the full app
 * on reload. Only validated values are returned, never a raw passthrough.
 */
export function embedExtras(config: EmbedConfig): Record<string, string> {
  const out: Record<string, string> = {};
  if (config.embed) out.embed = '1';
  if (config.theme) out.theme = config.theme;
  if (config.autoplay) out.autoplay = '1';
  if (config.loop) out.loop = '1';
  return out;
}

/** The same link with every embed param removed, i.e. what "Open in BAGEL" should open. */
export function fullAppHash(hash: string): string {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  for (const k of EMBED_KEYS) params.delete(k);
  return params.toString();
}

/** The same link, switched to embed mode (used by the Share modal's iframe snippet). */
export function withEmbed(hash: string, options: { theme?: 'light' | 'dark' } = {}): string {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  params.set('embed', '1');
  if (options.theme) params.set('theme', options.theme);
  return params.toString();
}

let pageLoad: EmbedConfig | null = null;

/**
 * The config from the URL the page was LOADED with, read once. The hash is
 * rewritten as the user interacts and cleared when empty, so reading it later
 * would lose the mode; the page-load value is the truth for the whole session.
 */
export function pageEmbedConfig(): EmbedConfig {
  if (pageLoad === null) {
    pageLoad = typeof window === 'undefined' ? DEFAULT_EMBED : readEmbedConfig(window.location.hash);
  }
  return pageLoad;
}
