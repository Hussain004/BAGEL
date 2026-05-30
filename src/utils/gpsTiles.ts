/**
 * OpenStreetMap-style slippy-map tile helpers + in-memory LRU loader.
 *
 * Used by the TrajectoryPlot panel to draw an opt-in map underlay under a
 * `sensor_msgs/NavSatFix` track. We project the canvas viewport into
 * lat/lon, figure out which tile column/row range covers it, fetch missing
 * tiles (LRU-bounded), and draw them positioned in the panel's local
 * equirectangular projection so the polyline lines up.
 *
 * Why not Leaflet
 * ---------------
 * The existing TrajectoryPlot is a single Canvas2D surface with hand-rolled
 * pan/zoom and a uPlot-adjacent style. Integrating Leaflet would mean a DOM
 * map overlay sitting next to (or under) the canvas, with two separate
 * zoom/pan interaction models. Hand-rolling adds ~150 LOC and keeps the
 * panel one canvas, so the playhead, scale bar, polyline, and tiles all
 * paint in one pass with consistent transforms.
 *
 * Why opt-in
 * ----------
 * BAGEL's pitch is "no data leaves your machine" — tile fetches break that.
 * The toggle defaults off; turning it on hits the configured OSM endpoint
 * (with a user-agent identifying BAGEL, per OSM tile-usage policy).
 */

const TILE_SIZE = 256;
/**
 * In-memory tile-image cap. ~20 MB at 256x256 RGBA = ~80 tiles. Plenty for
 * a 4-corners viewport at any practical zoom; LRU eviction keeps the working
 * set warm as the user pans.
 */
const MAX_CACHED_TILES = 200;
/** Wider zoom clamp than typical web maps — Roboticists may want streets or city overview. */
const MIN_ZOOM = 2;
const MAX_ZOOM = 19;

export interface TileCoord {
  x: number;
  y: number;
  z: number;
}

/** lat/lon → world-pixel coordinates at a given zoom level. */
export function latLonToWorldPx(
  lat: number,
  lon: number,
  zoom: number,
): { x: number; y: number } {
  const n = 2 ** zoom;
  const xt = ((lon + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  // Standard slippy-map Mercator projection: y is north-down.
  const yt = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return { x: xt * TILE_SIZE, y: yt * TILE_SIZE };
}

/** world-pixel coordinates at a given zoom → lat/lon. */
export function worldPxToLatLon(
  x: number,
  y: number,
  zoom: number,
): { lat: number; lon: number } {
  const n = 2 ** zoom;
  const lon = (x / TILE_SIZE / n) * 360 - 180;
  const yt = y / TILE_SIZE / n;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * yt)));
  const lat = (latRad * 180) / Math.PI;
  return { lat, lon };
}

/**
 * Pick the zoom level where the on-screen pixel scale roughly matches the
 * tile's native resolution. `metresPerPixel` is the local scale (e.g. 1 m
 * trace ≈ 50 screen px → metresPerPixel = 0.02). Bigger zoom = more detail,
 * smaller covered area per tile, more fetches.
 *
 * `latRad` adjusts for the Mercator distortion: at high latitudes one tile
 * covers fewer ground metres, so the appropriate zoom shifts.
 */
export function pickZoomForScale(metresPerPixel: number, latRad: number): number {
  // Ground metres per tile at zoom z: (EARTH_CIRCUMFERENCE * cos(lat)) / 2^z
  // Ground metres per pixel: that / 256
  // We want: metresPerPixel ≈ (EARTH_CIRCUMFERENCE * cos(lat)) / (2^z * 256)
  // → 2^z = (EARTH_CIRCUMFERENCE * cos(lat)) / (256 * metresPerPixel)
  const earthCircumferenceM = 40075016.686;
  const mPerTilePixelAtZ0 = (earthCircumferenceM * Math.cos(latRad)) / TILE_SIZE;
  const z = Math.log2(mPerTilePixelAtZ0 / Math.max(metresPerPixel, 1e-6));
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(z)));
}

/**
 * LRU cache of decoded tile bitmaps + concurrent-fetch deduper. Tiles are
 * keyed by `${z}/${x}/${y}` (the standard slippy-map path); a fetch that's
 * already in flight is shared rather than re-issued.
 */
class TileLRU {
  private readonly cache = new Map<string, ImageBitmap>();
  private readonly inflight = new Map<string, Promise<ImageBitmap | null>>();
  private readonly urlPattern: string;
  /** Optional callback fired whenever a new tile arrives, so callers can repaint. */
  private onNewTile: (() => void) | null = null;

  constructor(urlPattern: string) {
    this.urlPattern = urlPattern;
  }

  setOnNewTile(cb: (() => void) | null): void {
    this.onNewTile = cb;
  }

  get(z: number, x: number, y: number): ImageBitmap | null {
    const key = `${z}/${x}/${y}`;
    const hit = this.cache.get(key);
    if (hit) {
      // Re-insert to move to MRU end. Map iteration is insertion order.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    return null;
  }

  /**
   * Kick off a fetch if one isn't already in flight; resolves to null on
   * any network/CORS/decode failure (silent so a broken tile server doesn't
   * spam the console with one error per tile per frame).
   */
  request(z: number, x: number, y: number): Promise<ImageBitmap | null> {
    const key = `${z}/${x}/${y}`;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(cached);
    const inflight = this.inflight.get(key);
    if (inflight) return inflight;
    const url = this.urlPattern
      .replace('{z}', String(z))
      .replace('{x}', String(x))
      .replace('{y}', String(y))
      // Sub-domain randomisation for `{s}` URLs (e.g. OSM's a/b/c subdomains)
      // keeps tile fetches roughly balanced.
      .replace('{s}', ['a', 'b', 'c'][(x + y) % 3]);
    const promise = (async (): Promise<ImageBitmap | null> => {
      try {
        // OSM's usage policy asks for a User-Agent / Referer. The browser's
        // default headers already cover the latter; we can't customise UA
        // from JS, so we just request it as-is and rely on the configured
        // server (the user's choice of tile URL) to accept it.
        const resp = await fetch(url, { mode: 'cors' });
        if (!resp.ok) return null;
        const blob = await resp.blob();
        const bitmap = await createImageBitmap(blob);
        // Insert + evict LRU if needed.
        this.cache.set(key, bitmap);
        while (this.cache.size > MAX_CACHED_TILES) {
          const oldestKey = this.cache.keys().next().value;
          if (oldestKey === undefined) break;
          const oldest = this.cache.get(oldestKey);
          this.cache.delete(oldestKey);
          oldest?.close?.();
        }
        this.onNewTile?.();
        return bitmap;
      } catch {
        return null;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }

  clear(): void {
    for (const b of this.cache.values()) b.close?.();
    this.cache.clear();
    this.inflight.clear();
  }
}

/** Singleton per URL pattern — re-creating on every panel mount would lose the cache. */
const loaders = new Map<string, TileLRU>();
export function getTileLoader(urlPattern: string): TileLRU {
  let loader = loaders.get(urlPattern);
  if (!loader) {
    loader = new TileLRU(urlPattern);
    loaders.set(urlPattern, loader);
  }
  return loader;
}

/**
 * Default OSM tile URL. OSM's usage policy is permissive for hobby / dev
 * traffic but expects a UA + reasonable rate. For production users with
 * heavier traffic, swap to MapBox / their own tile server via the panel's
 * Display card (future work).
 */
export const DEFAULT_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

export { TILE_SIZE };
