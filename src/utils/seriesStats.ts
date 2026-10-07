/**
 * Statistics and export for the plotted range of a time-series panel.
 *
 * After zooming into a region of a plot people want numbers (mean, spread,
 * RMS), and then they want the data in a spreadsheet or the figure in a paper.
 * Everything here is pure and DOM-free so it can be tested exactly.
 */

export interface RangeStats {
  name: string;
  /** Samples inside the range with a finite value. */
  n: number;
  min: number;
  max: number;
  mean: number;
  /** Sample standard deviation (n - 1); 0 for a single sample. */
  std: number;
  rms: number;
  first: number;
  last: number;
}

export interface PlotColumn {
  name: string;
  values: ArrayLike<number | null>;
  color: string;
}

/**
 * Statistics of one series over `lo <= t <= hi`.
 *
 * Variance uses Welford's running update rather than E[x^2] - E[x]^2: with
 * values like a 1.7e9 timestamp-scale offset and a tiny spread, the naive form
 * cancels catastrophically and can even go negative.
 *
 * `times` need not be sorted (bags with non-monotonic stamps exist), so this is
 * a scan, not a binary search.
 */
export function rangeStats(
  name: string,
  times: ArrayLike<number>,
  values: ArrayLike<number | null>,
  lo: number,
  hi: number,
): RangeStats | null {
  let n = 0;
  let mean = 0;
  let m2 = 0;
  let sumSq = 0;
  let min = Infinity;
  let max = -Infinity;
  let first = NaN;
  let last = NaN;
  const len = Math.min(times.length, values.length);
  for (let i = 0; i < len; i++) {
    const t = times[i]!;
    if (!(t >= lo && t <= hi)) continue;
    const v = values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    n++;
    const d = v - mean;
    mean += d / n;
    m2 += d * (v - mean);
    sumSq += v * v;
    if (v < min) min = v;
    if (v > max) max = v;
    if (n === 1) first = v;
    last = v;
  }
  if (n === 0) return null;
  return { name, n, min, max, mean, std: n > 1 ? Math.sqrt(m2 / (n - 1)) : 0, rms: Math.sqrt(sumSq / n), first, last };
}

function csvCell(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV of the rows with `lo <= t <= hi`; a missing value is an empty cell. */
export function plotCsv(
  time: ArrayLike<number>,
  columns: ReadonlyArray<Pick<PlotColumn, 'name' | 'values'>>,
  lo: number,
  hi: number,
): string {
  const lines = [['t_s', ...columns.map((c) => csvCell(c.name))].join(',')];
  for (let i = 0; i < time.length; i++) {
    const t = time[i]!;
    if (!(t >= lo && t <= hi)) continue;
    const cells = columns.map((c) => {
      const v = c.values[i];
      return v === null || v === undefined || !Number.isFinite(v) ? '' : String(v);
    });
    lines.push([String(t), ...cells].join(','));
  }
  return `${lines.join('\n')}\n`;
}

/** "Nice" tick values (1, 2, 5 times a power of ten) covering [min, max]. */
export function niceTicks(min: number, max: number, target = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const rawStep = (max - min) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) {
    // Round away accumulated float error so labels read 0.3, not 0.30000000000000004.
    out.push(Number(v.toPrecision(12)));
  }
  return out;
}

function xml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function fmt(n: number): string {
  return Math.abs(n) >= 1e5 || (n !== 0 && Math.abs(n) < 1e-3) ? n.toExponential(2) : String(Number(n.toPrecision(5)));
}

export interface SvgOptions {
  title: string;
  time: ArrayLike<number>;
  columns: ReadonlyArray<PlotColumn>;
  lo: number;
  hi: number;
  width?: number;
  height?: number;
}

/**
 * A standalone SVG of the visible range, for papers and slides.
 *
 * Deliberately a light, print-ready figure on a white background regardless of
 * the app theme. A series with more points than the plot has pixels is reduced
 * to the min and max of each pixel column, which draws the same picture at a
 * file size that does not grow with the data.
 */
export function plotSvg(opts: SvgOptions): string {
  const { title, time, columns, lo, hi } = opts;
  const W = opts.width ?? 900;
  const H = opts.height ?? 420;
  const m = { left: 64, right: 16, top: 44, bottom: 40 };
  const pw = W - m.left - m.right;
  const ph = H - m.top - m.bottom;

  let yMin = Infinity;
  let yMax = -Infinity;
  for (const c of columns) {
    for (let i = 0; i < time.length; i++) {
      const t = time[i]!;
      const v = c.values[i];
      if (!(t >= lo && t <= hi) || v === null || v === undefined || !Number.isFinite(v)) continue;
      if (v < yMin) yMin = v;
      if (v > yMax) yMax = v;
    }
  }
  if (!Number.isFinite(yMin)) {
    yMin = 0;
    yMax = 1;
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const pad = (yMax - yMin) * 0.05;
  yMin -= pad;
  yMax += pad;
  const xSpan = hi > lo ? hi - lo : 1;
  const sx = (t: number) => m.left + ((t - lo) / xSpan) * pw;
  const sy = (v: number) => m.top + ph - ((v - yMin) / (yMax - yMin)) * ph;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Helvetica, Arial, sans-serif" font-size="11">`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text x="${m.left}" y="18" font-size="13" font-weight="600" fill="#111827">${xml(title)}</text>`,
  );

  for (const v of niceTicks(yMin, yMax)) {
    const y = sy(v).toFixed(1);
    parts.push(
      `<line x1="${m.left}" x2="${W - m.right}" y1="${y}" y2="${y}" stroke="#e5e7eb"/>`,
      `<text x="${m.left - 6}" y="${(sy(v) + 4).toFixed(1)}" text-anchor="end" fill="#374151">${xml(fmt(v))}</text>`,
    );
  }
  for (const v of niceTicks(lo, hi)) {
    const x = sx(v).toFixed(1);
    parts.push(
      `<line x1="${x}" x2="${x}" y1="${m.top}" y2="${m.top + ph}" stroke="#f3f4f6"/>`,
      `<text x="${x}" y="${H - m.bottom + 16}" text-anchor="middle" fill="#374151">${xml(fmt(v))}s</text>`,
    );
  }
  parts.push(`<rect x="${m.left}" y="${m.top}" width="${pw}" height="${ph}" fill="none" stroke="#9ca3af"/>`);

  let legendX = m.left;
  for (const c of columns) {
    // Per-pixel-column min/max when there are more points than pixels.
    const buckets = new Map<number, { min: number; max: number }>();
    const direct: Array<[number, number]> = [];
    let count = 0;
    for (let i = 0; i < time.length; i++) {
      const t = time[i]!;
      const v = c.values[i];
      if (!(t >= lo && t <= hi) || v === null || v === undefined || !Number.isFinite(v)) continue;
      count++;
    }
    const decimate = count > pw * 2;
    for (let i = 0; i < time.length; i++) {
      const t = time[i]!;
      const v = c.values[i];
      if (!(t >= lo && t <= hi) || v === null || v === undefined || !Number.isFinite(v)) continue;
      if (decimate) {
        const b = Math.min(pw - 1, Math.floor(((t - lo) / xSpan) * pw));
        const cur = buckets.get(b);
        if (!cur) buckets.set(b, { min: v, max: v });
        else {
          if (v < cur.min) cur.min = v;
          if (v > cur.max) cur.max = v;
        }
      } else direct.push([t, v]);
    }
    const pts: string[] = [];
    if (decimate) {
      for (const b of [...buckets.keys()].sort((a, d) => a - d)) {
        const cur = buckets.get(b)!;
        const x = (m.left + b + 0.5).toFixed(1);
        // Two points per column keep the envelope (min then max) without ordering within the pixel.
        pts.push(`${x},${sy(cur.min).toFixed(1)}`, `${x},${sy(cur.max).toFixed(1)}`);
      }
    } else {
      for (const [t, v] of direct) pts.push(`${sx(t).toFixed(1)},${sy(v).toFixed(1)}`);
    }
    if (pts.length > 0) {
      parts.push(`<polyline fill="none" stroke="${xml(c.color)}" stroke-width="1.4" stroke-linejoin="round" points="${pts.join(' ')}"/>`);
    }
    parts.push(
      `<rect x="${legendX}" y="26" width="10" height="3" fill="${xml(c.color)}"/>`,
      `<text x="${legendX + 14}" y="30" fill="#111827">${xml(c.name)}</text>`,
    );
    legendX += 24 + c.name.length * 6.2;
  }
  parts.push('</svg>');
  return parts.join('\n');
}

/** `<bag>__<topic>__plot.<ext>` with path characters made safe. */
export function plotFilename(bagFileName: string, topicName: string, ext: 'csv' | 'svg' | 'png'): string {
  const stem = bagFileName.replace(/\.[^.]+$/, '');
  const topic = topicName.replace(/^\/+/, '').replace(/[^a-zA-Z0-9._-]+/g, '_');
  return `${stem}__${topic}__plot.${ext}`;
}
