/**
 * Theme preference store.
 *
 * Persists the user's choice (dark | light) to localStorage under
 * `bagel:theme:v1`. The first-render default honours `prefers-color-scheme`
 * only when no explicit choice has been saved — subsequent visits respect
 * the user's manual toggle even if their OS switches to a different theme.
 *
 * Theme drives CSS variables (via an attribute on the <html> element).
 * Canvas-rendered surfaces (uPlot axes, the trajectory canvas, the Three.js
 * clear colour) can't read CSS variables, so they follow the store through
 * utils/chartTheme.ts instead.
 */

import { create } from 'zustand';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'bagel:theme:v1';

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    // localStorage access can throw in sandboxed iframes; fall through to OS.
  }
  // No saved choice → fall back to the OS preference. matchMedia is defined
  // in every modern browser; defensive check just in case.
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: light)').matches
  ) {
    return 'light';
  }
  return 'dark';
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readInitialTheme(),
  setTheme: (theme: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Best-effort persistence.
    }
    set({ theme });
  },
  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark';
    get().setTheme(next);
  },
}));

/**
 * Apply the current theme to the document root. Call once from `App.tsx`
 * (or any other singleton mount point) so the `<html data-theme="…">`
 * attribute stays in sync with the store across the entire app.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  // Keep the browser chrome (mobile address bar, PWA title bar) matched to
  // --color-bg-primary; the static value in index.html only covers first paint.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'light' ? '#fafbfc' : '#06080f');
}
