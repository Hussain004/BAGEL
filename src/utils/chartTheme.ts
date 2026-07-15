import type { Theme } from '../store/themeStore';

/**
 * Theme-dependent colours for canvas-rendered surfaces (uPlot axes, the
 * trajectory canvas, the Three.js clear colour). CSS variables can't reach
 * inside a canvas, so these mirror the token values in index.css - if the
 * palette there changes, update this map to match.
 */
export interface ChartTheme {
  /** Axis label text (uPlot axis stroke). */
  axis: string;
  /** Minor grid lines. */
  grid: string;
  /** Axis tick marks. */
  tick: string;
  /** Emphasised origin axes on the trajectory grid. */
  origin: string;
  /** Foreground ink for canvas-drawn markers, arrows, scale bars. */
  fg: string;
  /** Contrast outline behind fg markers. */
  fgOutline: string;
  /** Three.js renderer clear colour (matches --color-bg-secondary). */
  sceneClear: number;
}

const DARK: ChartTheme = {
  axis: '#94a3b8',
  grid: 'rgba(255,255,255,0.05)',
  tick: 'rgba(255,255,255,0.1)',
  origin: 'rgba(255,255,255,0.16)',
  fg: '#f1f5f9',
  fgOutline: '#0c1020',
  sceneClear: 0x0c1020,
};

const LIGHT: ChartTheme = {
  axis: '#475569',
  grid: 'rgba(15,23,42,0.07)',
  tick: 'rgba(15,23,42,0.14)',
  origin: 'rgba(15,23,42,0.28)',
  fg: '#0f172a',
  fgOutline: '#fafbfc',
  sceneClear: 0xf3f5f8,
};

export function chartTheme(theme: Theme): ChartTheme {
  return theme === 'light' ? LIGHT : DARK;
}
