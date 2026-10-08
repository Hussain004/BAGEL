import { useEffect, useMemo, useRef, useState } from 'react';
import { turboColor } from '../../../utils/pointcloud';
import { niceTicks } from '../../../utils/seriesStats';
import { xyBounds, nearestByTime, nearestOnScreen, type XYPoints } from '../../../utils/xyPlot';
import { useThemeStore } from '../../../store/themeStore';

export interface XYSeries {
  name: string;
  color: string;
  points: XYPoints;
}

interface Props {
  series: XYSeries[];
  xLabel: string;
  playheadSec: number;
  equalScale: boolean;
  /** Called with the time of the point the user clicked, so the playhead can jump there. */
  onSeek: (timeSec: number) => void;
  /** Receives the canvas so the panel's PNG export can read it. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

const M = { left: 58, right: 14, top: 10, bottom: 34 };
/** Dots are thinned to about this many so a 50k-point path does not cost 50k fillStyle changes. */
const MAX_DOTS = 4000;

/**
 * XY scatter-and-path chart on a plain canvas. Not uPlot: uPlot's x axis is a
 * sorted scale, and an XY path is neither sorted nor single-valued.
 */
export function XYChart({ series, xLabel, playheadSec, equalScale, onSeek, canvasRef }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 600, h: 300 });
  const theme = useThemeStore((s) => s.theme);
  // Screen positions from the last draw, for click-to-seek.
  const hitRef = useRef<{ sx: Float64Array; sy: Float64Array; t: Float64Array } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.max(160, el.clientWidth), h: Math.max(160, el.clientHeight) });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, []);

  // Plot area shape, so equal scale means equal pixels per unit on both axes.
  const aspect = (size.w - M.left - M.right) / (size.h - M.top - M.bottom);
  const bounds = useMemo(() => xyBounds(series.map((s) => s.points), equalScale, aspect), [series, equalScale, aspect]);
  const timeRange = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) {
      for (const t of s.points.t) {
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      }
    }
    return Number.isFinite(lo) ? { lo, hi: hi > lo ? hi : lo + 1 } : null;
  }, [series]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.w * dpr);
    canvas.height = Math.floor(size.h * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size.w, size.h);
    hitRef.current = null;
    if (!bounds || !timeRange) return;

    const root = getComputedStyle(document.documentElement);
    const grid = root.getPropertyValue('--color-border').trim() || 'rgba(255,255,255,0.08)';
    const text = root.getPropertyValue('--color-text-muted').trim() || '#94a3b8';
    const pw = size.w - M.left - M.right;
    const ph = size.h - M.top - M.bottom;
    const sx = (v: number) => M.left + ((v - bounds.xMin) / (bounds.xMax - bounds.xMin)) * pw;
    const sy = (v: number) => M.top + ph - ((v - bounds.yMin) / (bounds.yMax - bounds.yMin)) * ph;

    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = text;
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const v of niceTicks(bounds.yMin, bounds.yMax, 6)) {
      const y = Math.round(sy(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(M.left, y);
      ctx.lineTo(M.left + pw, y);
      ctx.stroke();
      ctx.fillText(String(Number(v.toPrecision(5))), M.left - 6, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const v of niceTicks(bounds.xMin, bounds.xMax, 7)) {
      const x = Math.round(sx(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, M.top);
      ctx.lineTo(x, M.top + ph);
      ctx.stroke();
      ctx.fillText(String(Number(v.toPrecision(5))), x, M.top + ph + 4);
    }
    ctx.fillStyle = text;
    ctx.fillText(xLabel, M.left + pw / 2, M.top + ph + 18);

    ctx.save();
    ctx.beginPath();
    ctx.rect(M.left, M.top, pw, ph);
    ctx.clip();

    const total = series.reduce((n, s) => n + s.points.x.length, 0);
    const hitX = new Float64Array(total);
    const hitY = new Float64Array(total);
    const hitT = new Float64Array(total);
    let h = 0;

    for (const s of series) {
      const { x, y, t } = s.points;
      if (x.length === 0) continue;
      ctx.strokeStyle = s.color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < x.length; i++) {
        const px = sx(x[i]!);
        const py = sy(y[i]!);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        hitX[h] = px;
        hitY[h] = py;
        hitT[h] = t[i]!;
        h++;
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Colour by time so direction is readable: early is blue, late is red.
      const step = Math.max(1, Math.ceil(x.length / MAX_DOTS));
      for (let i = 0; i < x.length; i += step) {
        const c = turboColor((t[i]! - timeRange.lo) / (timeRange.hi - timeRange.lo));
        ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
        ctx.fillRect(sx(x[i]!) - 1.5, sy(y[i]!) - 1.5, 3, 3);
      }
      // Playhead: a ring on the sample nearest the current time.
      const near = nearestByTime(t, playheadSec);
      if (near >= 0) {
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sx(x[near]!), sy(y[near]!), 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
    hitRef.current = { sx: hitX.subarray(0, h), sy: hitY.subarray(0, h), t: hitT.subarray(0, h) };

    // Colour bar: what the dot colours mean.
    const bw = 90;
    const bx = M.left + pw - bw - 8;
    const by = M.top + 8;
    for (let i = 0; i < bw; i++) {
      const c = turboColor(i / (bw - 1));
      ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
      ctx.fillRect(bx + i, by, 1, 6);
    }
    ctx.fillStyle = text;
    ctx.textAlign = 'left';
    ctx.fillText(`${timeRange.lo.toFixed(1)}s`, bx, by + 10);
    ctx.textAlign = 'right';
    ctx.fillText(`${timeRange.hi.toFixed(1)}s`, bx + bw, by + 10);
  }, [series, bounds, timeRange, size, playheadSec, xLabel, theme, canvasRef]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hit = hitRef.current;
    if (!hit) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const i = nearestOnScreen(hit.sx, hit.sy, e.clientX - rect.left, e.clientY - rect.top, 14);
    if (i >= 0) onSeek(hit.t[i]!);
  };

  return (
    <div ref={wrapRef} className="flex-1 min-h-[240px] min-w-0 relative">
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, display: 'block', cursor: 'crosshair' }}
        onClick={onClick}
        role="img"
        aria-label={`XY plot of ${series.map((s) => s.name).join(', ')} against ${xLabel}. Click a point to seek to it.`}
        data-testid="xy-canvas"
      />
      {!bounds && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-text-muted pointer-events-none">
          No samples where both fields have a value.
        </div>
      )}
    </div>
  );
}
