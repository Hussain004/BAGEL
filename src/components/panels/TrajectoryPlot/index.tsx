import { useCallback, useEffect, useRef, useState } from 'react';
import { useBagStore, resolveBagEntry } from '../../../store/bagStore';
import { useBagLocalPlayhead } from '../../../hooks/useBagLocalPlayhead';
import { PanelShell } from '../PanelShell';
import { PanelLoadingState, PanelErrorState, PanelEmptyState } from '../shared/PanelStates';
import { getTopicColor } from '../../../utils/color';
import { useThemeStore } from '../../../store/themeStore';
import { chartTheme, type ChartTheme } from '../../../utils/chartTheme';
import { nsToSeconds } from '../../../utils/time';
import { nearestPointIndex } from '../../../utils/trajectory';
import { useTrajectory } from './useTrajectory';
import {
  DEFAULT_TRAJECTORY_SETTINGS,
  useTrajectoryPanelStore,
} from '../../../store/panelUiStores';
import {
  DEFAULT_TILE_URL,
  TILE_SIZE,
  getTileLoader,
  latLonToWorldPx,
  pickZoomForScale,
} from '../../../utils/gpsTiles';
import { registerCapture } from '../../../utils/captureRegistry';

interface TrajectoryPlotProps {
  panelId: string;
  topicName: string;
  type: string;
  bagId?: string;
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
export function TrajectoryPlot({ panelId, topicName, type, bagId }: TrajectoryPlotProps) {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const bag = entry?.summary ?? null;
  const bagCount = useBagStore((s) => s.bagOrder.length);
  const bagColor = entry?.color ?? null;
  const playheadNs = useBagLocalPlayhead(bagId);
  // Canvas ink follows the app theme (CSS variables can't reach into 2D
  // canvas draws); the render effect below re-runs on toggle.
  const themeColors = chartTheme(useThemeStore((s) => s.theme));

  const {
    points,
    bounds,
    source,
    projected,
    navSatRef,
    loading,
    progress,
    error,
  } = useTrajectory(topicName, type, bagId);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => registerCapture(panelId, () => canvasRef.current), [panelId]);

  // Pan/zoom view persisted per panelId so a dock-induced remount doesn't
  // throw away the user's current viewport. Reading the slice with a
  // fallback to the module-level DEFAULT keeps the reference stable on
  // first-paint (avoids a tear-down loop).
  const settings = useTrajectoryPanelStore(
    (s) => s.byId[panelId] ?? DEFAULT_TRAJECTORY_SETTINGS,
  );
  const updateSettings = useTrajectoryPanelStore((s) => s.update);
  const view = settings.view;
  const showMapTiles = settings.showMapTiles;
  const setShowMapTiles = (v: boolean) => updateSettings(panelId, { showMapTiles: v });
  const setView = useCallback(
    (next: View | null | ((current: View | null) => View | null)) => {
      if (typeof next === 'function') {
        // Functional setter compat for the resize-observer effect below.
        const current = useTrajectoryPanelStore.getState().byId[panelId]?.view ?? null;
        const computed = next(current);
        updateSettings(panelId, { view: computed });
      } else {
        updateSettings(panelId, { view: next });
      }
    },
    [panelId, updateSettings],
  );
  // Stash the auto-fit view so the reset button can snap back without re-deriving.
  const autoFitRef = useRef<View | null>(null);
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  // Bumped whenever a newly-fetched tile arrives so the render effect re-runs
  // and paints it into the canvas. Counters compose cleanly with the existing
  // [points, view, playheadNs] dependency list without needing an imperative
  // mid-async repaint path.
  const [tileGeneration, setTileGeneration] = useState(0);

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
    // Only snap to the new fit if the user has not customised the view.
    // A saved view in the store means we're rehydrating after a remount
    // (dock, close+reopen, hash restore) — preserve what the user had.
    setView((current) => (current == null ? fit : current));
  }, [recomputeFit, setView]);

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

  // Wire the tile loader's "new tile" callback to our render trigger. The
  // loader is a singleton keyed by URL pattern; we install our callback on
  // mount and clear it on unmount so a closed panel doesn't keep ticking
  // the now-defunct component's setState.
  useEffect(() => {
    if (!projected || !showMapTiles) return;
    const loader = getTileLoader(DEFAULT_TILE_URL);
    loader.setOnNewTile(() => setTileGeneration((g) => g + 1));
    return () => loader.setOnNewTile(null);
  }, [projected, showMapTiles]);

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

    // Tile underlay (NavSatFix + user opt-in only). Draws first so the
    // polyline / playhead always sit on top.
    if (projected && showMapTiles && navSatRef) {
      drawTileUnderlay(ctx, cw, ch, view, navSatRef);
    }

    drawGrid(ctx, cw, ch, view, themeColors);

    // Polyline tinting:
    //   - Single bag: the v0.3 blue→red gradient (recognisable; direction
    //     of travel reads at a glance).
    //   - Multi-bag: tint by the bag's assigned color so two overlapping
    //     trajectories stay visually distinguishable. We modulate the
    //     color's lightness along the path so direction of travel is still
    //     readable (start dim, end bright).
    const last = points.length - 1;
    const useBagTint = bagCount > 1 && bagColor !== null;
    const tintRgb = useBagTint ? hexToRgb(bagColor!) : null;
    for (let i = 1; i < points.length; i++) {
      const t = last > 0 ? (i - 1) / last : 0;
      if (useBagTint && tintRgb) {
        // Lerp from a darker variant (start) toward the bag's full color (end).
        const k = 0.4 + 0.6 * t;
        const r = Math.round(tintRgb.r * k);
        const g = Math.round(tintRgb.g * k);
        const b = Math.round(tintRgb.b * k);
        ctx.strokeStyle = `rgb(${r},${g},${b})`;
      } else {
        const hue = 220 - 200 * t; // 220 (blue) → 20 (red)
        ctx.strokeStyle = `hsl(${hue}, 80%, 60%)`;
      }
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
      themeColors,
    );
    if (points.length > 1) {
      drawMarker(
        ctx,
        end.x * view.scale + view.offsetX,
        -end.y * view.scale + view.offsetY,
        '#f43f5e',
        'E',
        themeColors,
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
        ctx.strokeStyle = themeColors.fg;
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
      ctx.fillStyle = themeColors.fg;
      ctx.strokeStyle = themeColors.fgOutline;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    drawScaleBar(ctx, cw, ch, view, themeColors);
  }, [points, view, playheadNs, projected, showMapTiles, navSatRef, tileGeneration, bagColor, bagCount, themeColors]);

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
      bagId={bagId}
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
      {error && <PanelErrorState title="Failed to load trajectory" message={error} />}
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
            <div className="absolute top-2 right-2 flex flex-col items-end gap-1.5">
              <div className="flex gap-1">
                <button
                  onClick={resetView}
                  className="px-2 py-1 rounded-md text-xs mono bg-surface/80 border border-border hover:border-accent-blue/40 hover:text-accent-blue text-text-secondary transition-colors"
                  title="Reset view"
                >
                  Fit
                </button>
              </div>
              {projected && navSatRef && (
                <label
                  className="flex items-center gap-1.5 text-text-secondary text-xs mono bg-bg-primary/85 backdrop-blur px-2 py-1 rounded-md border border-border cursor-pointer hover:border-accent-blue/40"
                  title="Toggle an OpenStreetMap tile underlay (fetches tiles from osm.org)"
                >
                  <input
                    type="checkbox"
                    checked={showMapTiles}
                    onChange={(e) => setShowMapTiles(e.target.checked)}
                    className="accent-accent-blue"
                  />
                  map tiles
                </label>
              )}
            </div>
            <div className="absolute top-2 left-2 text-text-muted text-[10px] mono leading-tight bg-bg-primary/60 backdrop-blur px-2 py-1 rounded-md border border-border">
              <div>{source}</div>
              {projected && (
                <div className="text-accent-amber">x/y in metres from first GPS fix</div>
              )}
              {projected && showMapTiles && (
                <div className="text-text-tertiary">
                  © OpenStreetMap contributors
                </div>
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

/**
 * OSM tile underlay for a NavSatFix trajectory.
 *
 * Strategy:
 *   1. The panel's view.scale is in "screen px per metre". Convert that to a
 *      slippy-map zoom level by way of metres-per-pixel — bigger zoom = more
 *      detail, smaller covered area per tile.
 *   2. Project the canvas corners back to lat/lon (via the local
 *      equirectangular projection around `navSatRef`), then world-pixel.
 *   3. Iterate the covered tile range, draw each cached tile, fire missing
 *      tiles into the loader (the panel will re-render when they arrive).
 *
 * Tiles drawn at the chosen zoom's *native* pixel scale, then translated +
 * scaled to fit the canvas — this avoids re-sampling when the view scale
 * happens to match an integer zoom level, which is the common case.
 */
function drawTileUnderlay(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  view: View,
  ref: { lat: number; lon: number },
): void {
  const EARTH_RADIUS_M = 6378137;
  const refLatRad = (ref.lat * Math.PI) / 180;
  // Pick zoom from the local screen scale. Match the equirectangular
  // projection's metres-per-degree at the anchor latitude.
  const metresPerPx = 1 / view.scale;
  const zoom = pickZoomForScale(metresPerPx, refLatRad);

  // Convert canvas corner → world coords (metres east/north of ref) → lat/lon
  // → world tile pixels at the chosen zoom. We do all four corners and take
  // the bounding box so a rotated polyline doesn't drop tiles near the edges.
  const corners = [
    { sx: 0, sy: 0 },
    { sx: cw, sy: 0 },
    { sx: 0, sy: ch },
    { sx: cw, sy: ch },
  ];
  let minTileX = Infinity;
  let maxTileX = -Infinity;
  let minTileY = Infinity;
  let maxTileY = -Infinity;
  // Anchor's world-pixel position at the chosen zoom — needed to translate
  // from "world pixels relative to anchor" back to absolute world pixels.
  const anchorWorld = latLonToWorldPx(ref.lat, ref.lon, zoom);
  for (const c of corners) {
    const wx = (c.sx - view.offsetX) / view.scale; // east metres from anchor
    const wy = -(c.sy - view.offsetY) / view.scale; // north metres from anchor
    const dLat = (wy / EARTH_RADIUS_M) * (180 / Math.PI);
    const dLon =
      ((wx / (EARTH_RADIUS_M * Math.cos(refLatRad))) * 180) / Math.PI;
    const corner = latLonToWorldPx(ref.lat + dLat, ref.lon + dLon, zoom);
    if (corner.x < minTileX) minTileX = corner.x;
    if (corner.x > maxTileX) maxTileX = corner.x;
    if (corner.y < minTileY) minTileY = corner.y;
    if (corner.y > maxTileY) maxTileY = corner.y;
  }

  // Convert tile-pixel bounds → tile-index bounds.
  const tileXStart = Math.max(0, Math.floor(minTileX / TILE_SIZE));
  const tileXEnd = Math.min(2 ** zoom - 1, Math.floor(maxTileX / TILE_SIZE));
  const tileYStart = Math.max(0, Math.floor(minTileY / TILE_SIZE));
  const tileYEnd = Math.min(2 ** zoom - 1, Math.floor(maxTileY / TILE_SIZE));

  // Hard cap the tile count so a wild zoom-out doesn't fan out into thousands
  // of fetches. 200 tiles covers a typical 4K viewport comfortably.
  const tileCount = (tileXEnd - tileXStart + 1) * (tileYEnd - tileYStart + 1);
  if (tileCount > 200) return;

  const loader = getTileLoader(DEFAULT_TILE_URL);
  // Tile world-pixel size (always 256 px at native zoom) translated into
  // canvas pixels using the local screen scale. One world-tile-px ≈ one
  // metre-per-pixel-at-this-zoom in screen space, which we already have via
  // the corner projection ratio. Just compute the per-tile size by sampling
  // two adjacent world points.
  const sampleA = anchorWorld;
  // 1 tile east of the anchor, same y. Convert back via inverse equirect.
  const oneTileEastWorldX = anchorWorld.x + TILE_SIZE;
  // Equivalent dLon = ((oneTileEastWorldX / 2^zoom / TILE_SIZE) * 360) - 180 - ref.lon
  const n = 2 ** zoom;
  const newLon = (oneTileEastWorldX / TILE_SIZE / n) * 360 - 180;
  const dLonDeg = newLon - ref.lon;
  const tileEastMetres =
    ((dLonDeg * Math.PI) / 180) * EARTH_RADIUS_M * Math.cos(refLatRad);
  // Screen px per tile (east direction). Symmetric for the y direction at
  // the same zoom because slippy-map tiles are square in world space.
  const tilePxX = tileEastMetres * view.scale;

  for (let tx = tileXStart; tx <= tileXEnd; tx++) {
    for (let ty = tileYStart; ty <= tileYEnd; ty++) {
      const bitmap = loader.get(zoom, tx, ty);
      if (!bitmap) {
        // Fire and forget — re-render fires when the tile lands.
        void loader.request(zoom, tx, ty);
        continue;
      }
      // Project the tile's NW corner (tile world pixels → lat/lon → canvas).
      const tileNWWorldX = tx * TILE_SIZE;
      const tileNWWorldY = ty * TILE_SIZE;
      const dxWorld = tileNWWorldX - sampleA.x;
      const dyWorld = tileNWWorldY - sampleA.y;
      // dxWorld worldPx east of anchor = dxWorld * (tileEastMetres / TILE_SIZE) metres east
      const dxMetres = dxWorld * (tileEastMetres / TILE_SIZE);
      const dyMetres = -dyWorld * (tileEastMetres / TILE_SIZE);
      const sx = dxMetres * view.scale + view.offsetX;
      const sy = -dyMetres * view.scale + view.offsetY;
      // Round to nearest pixel to avoid sub-pixel rendering blur between
      // adjacent tiles.
      ctx.drawImage(
        bitmap,
        Math.round(sx),
        Math.round(sy),
        Math.ceil(tilePxX),
        Math.ceil(tilePxX),
      );
    }
  }
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: View,
  t: ChartTheme,
) {
  // Pick a grid step that fits nicely in the current zoom: ~80 px between lines.
  const targetPx = 80;
  const targetWorld = targetPx / view.scale;
  const step = niceStep(targetWorld);
  const stepPx = step * view.scale;
  if (!Number.isFinite(stepPx) || stepPx < 4) return;

  ctx.strokeStyle = t.grid;
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
  ctx.strokeStyle = t.origin;
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
  t: ChartTheme,
) {
  ctx.fillStyle = color;
  ctx.strokeStyle = t.fgOutline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = t.fg;
  ctx.font = "600 10px 'JetBrains Mono Variable', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 14);
}

function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  view: View,
  t: ChartTheme,
) {
  // Aim for a 100 px scale bar; snap to a nice round metres value. Anchored
  // bottom-right so the canvas overlay buttons (Fit, source label) stay
  // clear of the top edge.
  const targetPx = 100;
  const targetWorld = targetPx / view.scale;
  const step = niceStep(targetWorld);
  const px = step * view.scale;
  const x0 = w - 16 - px;
  const y0 = h - 16;
  ctx.strokeStyle = t.fg;
  ctx.fillStyle = t.fg;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x0 + px, y0);
  ctx.moveTo(x0, y0 - 4);
  ctx.lineTo(x0, y0 + 4);
  ctx.moveTo(x0 + px, y0 - 4);
  ctx.lineTo(x0 + px, y0 + 4);
  ctx.stroke();
  ctx.font = "500 10px 'JetBrains Mono Variable', monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${formatDistance(step)}`, x0 + px / 2, y0 - 6);
}

/**
 * Parse a `#rrggbb` colour into an {r,g,b} 0-255 tuple. Returns black on a
 * malformed input — the multi-bag path is the only caller and it always
 * passes a palette colour, so the fallback is a defence-in-depth only.
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

function formatDistance(metres: number): string {
  if (metres >= 1000) return `${(metres / 1000).toFixed(metres >= 10000 ? 0 : 1)} km`;
  if (metres >= 1) return `${metres < 10 ? metres.toFixed(1) : metres.toFixed(0)} m`;
  return `${(metres * 100).toFixed(0)} cm`;
}

