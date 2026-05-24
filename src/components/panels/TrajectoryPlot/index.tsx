import { useCallback, useEffect, useRef, useState } from 'react';
import { useBagStore } from '../../../store/bagStore';
import { usePlayheadStore } from '../../../store/playheadStore';
import { PanelShell } from '../PanelShell';
import { getTopicColor } from '../../../utils/color';
import { nsToSeconds } from '../../../utils/time';
import { nearestPointIndex } from '../../../utils/trajectory';
import { useTrajectory } from './useTrajectory';

interface TrajectoryPlotProps {
  panelId: string;
  topicName: string;
  type: string;
}

interface View {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const MARGIN = 30;

/**
 * TrajectoryPlot — Renders a topic's planar path on a canvas.
 *
 * Supports pose-bearing types (Odometry / PoseStamped / TransformStamped / …)
 * and NavSatFix (equirectangular projection anchored at the first GPS fix).
 *
 * The trajectory is drawn as a blue→red gradient polyline so the eye can
 * follow direction without needing arrows. A filled marker at the playhead
 * sample shows the robot/sensor position at the current scrubbed time, and
 * an arrow points along the heading when the source message carries an
 * orientation quaternion.
 */
export function TrajectoryPlot({ panelId, topicName, type }: TrajectoryPlotProps) {
  const bag = useBagStore((s) => s.bag);
  const playheadNs = usePlayheadStore((s) => s.timeNs);

  const {
    points,
    bounds,
    source,
    projected,
    loading,
    progress,
    error,
  } = useTrajectory(topicName, type);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  // Stash the auto-fit view so the reset button can snap back without re-deriving.
  const autoFitRef = useRef<View | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);

  // (Re)compute the auto-fit view whenever the data bounds change.
  const recomputeFit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bounds) return null;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const dx = Math.max(1e-6, bounds.maxX - bounds.minX);
    const dy = Math.max(1e-6, bounds.maxY - bounds.minY);
    const usableW = Math.max(1, cw - 2 * MARGIN);
    const usableH = Math.max(1, ch - 2 * MARGIN);
    const scale = Math.min(usableW / dx, usableH / dy);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const offsetX = cw / 2 - cx * scale;
    // Screen y is inverted vs world y (north should point up).
    const offsetY = ch / 2 + cy * scale;
    return { scale, offsetX, offsetY };
  }, [bounds]);

  useEffect(() => {
    const fit = recomputeFit();
    if (!fit) return;
    autoFitRef.current = fit;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView(fit);
  }, [recomputeFit]);

  // Keep the canvas backing store in sync with its CSS size and re-fit on
  // resize (only when the view is still on the auto-fit; manual zoom is left
  // alone so the user doesn't lose their position when the panel reflows).
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ro = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const fit = recomputeFit();
      if (fit) {
        autoFitRef.current = fit;
        setView((current) => {
          if (!current) return fit;
          // If the user hasn't panned/zoomed, keep snapping to the fit.
          const prevFit = autoFitRef.current;
          if (
            prevFit &&
            Math.abs(current.scale - prevFit.scale) < 1e-6 &&
            Math.abs(current.offsetX - prevFit.offsetX) < 1e-3 &&
            Math.abs(current.offsetY - prevFit.offsetY) < 1e-3
          ) {
            return fit;
          }
          return current;
        });
      }
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [recomputeFit]);

  // Hover-to-locate: figure out the nearest point under the cursor in world
  // coords so we can surface its (x, y) in the footer.
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!view) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const wx = (screenX - view.offsetX) / view.scale;
      const wy = -(screenY - view.offsetY) / view.scale;
      setHoverPoint({ x: wx, y: wy });
    },
    [view],
  );
  const handleMouseLeave = useCallback(() => setHoverPoint(null), []);

  // Wheel zoom centered on the cursor.
  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!view) return;
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const next: View = {
        scale: view.scale * factor,
        offsetX: sx - (sx - view.offsetX) * factor,
        offsetY: sy - (sy - view.offsetY) * factor,
      };
      setView(next);
    },
    [view],
  );

  // Click + drag to pan.
  const panStartRef = useRef<{ sx: number; sy: number; view: View } | null>(null);
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!view) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    panStartRef.current = {
      sx: e.clientX - rect.left,
      sy: e.clientY - rect.top,
      view,
    };
  };
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!panStartRef.current || !view) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const dx = sx - panStartRef.current.sx;
    const dy = sy - panStartRef.current.sy;
    setView({
      scale: panStartRef.current.view.scale,
      offsetX: panStartRef.current.view.offsetX + dx,
      offsetY: panStartRef.current.view.offsetY + dy,
    });
  };
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    panStartRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const resetView = () => {
    const fit = recomputeFit();
    if (fit) {
      autoFitRef.current = fit;
      setView(fit);
    }
  };

  // Render the trajectory + markers. Runs on every view / playhead / data
  // change; canvas redraws are cheap at trajectory sizes (< 10k points).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || points.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;
    ctx.clearRect(0, 0, cw, ch);

    drawGrid(ctx, cw, ch, view);

    // The blue→red gradient: split into short colored segments so we don't
    // need a per-vertex gradient (which Canvas2D doesn't natively support).
    const last = points.length - 1;
    for (let i = 1; i < points.length; i++) {
      const t = last > 0 ? (i - 1) / last : 0;
      const hue = 220 - 200 * t; // 220 (blue) → 20 (red)
      ctx.strokeStyle = `hsl(${hue}, 80%, 60%)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const a = points[i - 1];
      const b = points[i];
      ctx.moveTo(a.x * view.scale + view.offsetX, -a.y * view.scale + view.offsetY);
      ctx.lineTo(b.x * view.scale + view.offsetX, -b.y * view.scale + view.offsetY);
      ctx.stroke();
    }

    // Start / end disc markers.
    const start = points[0];
    const end = points[points.length - 1];
    drawMarker(
      ctx,
      start.x * view.scale + view.offsetX,
      -start.y * view.scale + view.offsetY,
      '#3b82f6',
      'S',
    );
    if (points.length > 1) {
      drawMarker(
        ctx,
        end.x * view.scale + view.offsetX,
        -end.y * view.scale + view.offsetY,
        '#f43f5e',
        'E',
      );
    }

    // Playhead marker on top, with a heading arrow if the source had quats.
    const idx = nearestPointIndex(points, playheadNs);
    if (idx >= 0) {
      const ph = points[idx];
      const px = ph.x * view.scale + view.offsetX;
      const py = -ph.y * view.scale + view.offsetY;
      if (ph.yaw !== undefined && Number.isFinite(ph.yaw)) {
        const len = 22;
        const ax = px + Math.cos(ph.yaw) * len;
        const ay = py - Math.sin(ph.yaw) * len;
        ctx.strokeStyle = '#f1f5f9';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        // Arrow head.
        const headSize = 6;
        const headAngle = Math.PI / 6;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(
          ax - Math.cos(ph.yaw - headAngle) * headSize,
          ay + Math.sin(ph.yaw - headAngle) * headSize,
        );
        ctx.moveTo(ax, ay);
        ctx.lineTo(
          ax - Math.cos(ph.yaw + headAngle) * headSize,
          ay + Math.sin(ph.yaw + headAngle) * headSize,
        );
        ctx.stroke();
      }
      ctx.fillStyle = '#f1f5f9';
      ctx.strokeStyle = '#0c1020';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    drawScaleBar(ctx, cw, ch, view);
  }, [points, view, playheadNs]);

  const accent = getTopicColor(topicName, type);
  const startNs = bag?.startTime ?? 0n;
  const playheadIdx = nearestPointIndex(points, playheadNs);
  const playhead = playheadIdx >= 0 ? points[playheadIdx] : null;
  const truncatedAt = points.length >= 50_000;

  return (
    <PanelShell
      panelId={panelId}
      kind="trajectory"
      topicName={topicName}
      type={type}
      accentColor={accent}
    >
      {loading && (
        <PanelLoadingState
          message={
            progress > 0
              ? `Decoded ${progress.toLocaleString()} messages…`
              : 'Loading trajectory…'
          }
        />
      )}
      {error && <PanelErrorState message={error} />}
      {!loading && !error && points.length === 0 && (
        <PanelEmptyState message="No usable pose data on this topic." />
      )}
      {points.length > 0 && (
        <div className="flex-1 flex flex-col min-h-0">
          <div
            ref={containerRef}
            className="flex-1 min-h-[240px] relative bg-bg-primary/60 overflow-hidden"
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0 cursor-grab active:cursor-grabbing"
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
            <div className="absolute top-2 right-2 flex gap-1">
              <button
                onClick={resetView}
                className="px-2 py-1 rounded-md text-xs mono bg-surface/80 border border-border hover:border-accent-blue/40 hover:text-accent-blue text-text-secondary transition-all"
                title="Reset view"
              >
                Fit
              </button>
            </div>
            <div className="absolute top-2 left-2 text-text-muted text-[10px] mono leading-tight bg-bg-primary/60 backdrop-blur px-2 py-1 rounded-md border border-border">
              <div>{source}</div>
              {projected && (
                <div className="text-accent-amber">x/y in metres from first GPS fix</div>
              )}
            </div>
          </div>
          <div className="px-4 py-1.5 border-t border-border flex items-center justify-between text-text-muted text-xs mono gap-3">
            <span>
              {points.length.toLocaleString()} samples
              {truncatedAt && (
                <span className="text-accent-amber ml-2">(capped at 50,000)</span>
              )}
            </span>
            {playhead ? (
              <span className="text-text-secondary">
                t = {nsToSeconds(playhead.t - startNs).toFixed(3)}s · x ={' '}
                {playhead.x.toFixed(2)}m · y = {playhead.y.toFixed(2)}m
              </span>
            ) : hoverPoint ? (
              <span>
                cursor: x = {hoverPoint.x.toFixed(2)}m · y = {hoverPoint.y.toFixed(2)}m
              </span>
            ) : (
              <span>drag to pan · scroll to zoom</span>
            )}
          </div>
        </div>
      )}
    </PanelShell>
  );
}

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number, view: View) {
  // Pick a grid step that fits nicely in the current zoom: ~80 px between lines.
  const targetPx = 80;
  const targetWorld = targetPx / view.scale;
  const step = niceStep(targetWorld);
  const stepPx = step * view.scale;
  if (!Number.isFinite(stepPx) || stepPx < 4) return;

  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();

  // The world-origin in screen space is (offsetX, offsetY). Walk outward
  // from there in both directions to fill the canvas.
  const startX = view.offsetX - Math.ceil(view.offsetX / stepPx) * stepPx;
  for (let x = startX; x < w; x += stepPx) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  const startY = view.offsetY - Math.ceil(view.offsetY / stepPx) * stepPx;
  for (let y = startY; y < h; y += stepPx) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  // Highlight the (0, 0) axes so the user has a frame of reference.
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.beginPath();
  ctx.moveTo(view.offsetX, 0);
  ctx.lineTo(view.offsetX, h);
  ctx.moveTo(0, view.offsetY);
  ctx.lineTo(w, view.offsetY);
  ctx.stroke();
}

/** Round to the nearest "nice" step (1, 2, 5, 10, 20, 50, 100, …). */
function niceStep(target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 1;
  const exp = Math.floor(Math.log10(target));
  const base = Math.pow(10, exp);
  const ratio = target / base;
  let nice: number;
  if (ratio < 1.5) nice = 1;
  else if (ratio < 3.5) nice = 2;
  else if (ratio < 7.5) nice = 5;
  else nice = 10;
  return nice * base;
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  color: string,
  label: string,
) {
  ctx.fillStyle = color;
  ctx.strokeStyle = '#0c1020';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f1f5f9';
  ctx.font = '600 10px JetBrains Mono';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 14);
}

function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  w: number,
  _h: number,
  view: View,
) {
  // Aim for a 100 px scale bar; snap to a nice round metres value.
  const targetPx = 100;
  const targetWorld = targetPx / view.scale;
  const step = niceStep(targetWorld);
  const px = step * view.scale;
  const x0 = w - 16 - px;
  const y0 = 16;
  ctx.strokeStyle = '#f1f5f9';
  ctx.fillStyle = '#f1f5f9';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + px, y0);
  ctx.moveTo(x0, y0 - 4);
  ctx.lineTo(x0, y0 + 4);
  ctx.moveTo(x0 + px, y0 - 4);
  ctx.lineTo(x0 + px, y0 + 4);
  ctx.stroke();
  ctx.font = '500 10px JetBrains Mono';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${formatDistance(step)}`, x0 + px / 2, y0 - 6);
}

function formatDistance(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(metres >= 10000 ? 0 : 1)} km`;
  if (metres >= 1) return `${metres < 10 ? metres.toFixed(1) : metres.toFixed(0)} m`;
  return `${(metres * 100).toFixed(0)} cm`;
}

function PanelLoadingState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
      <svg
        className="w-6 h-6 text-accent-blue animate-spin-slow"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="3"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <span className="text-text-secondary text-sm">{message}</span>
    </div>
  );
}

function PanelErrorState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="text-accent-rose text-sm font-medium">
        Failed to load trajectory
      </div>
      <div className="text-text-secondary text-xs max-w-md">{message}</div>
    </div>
  );
}

function PanelEmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-text-muted text-sm p-8">
      {message}
    </div>
  );
}
