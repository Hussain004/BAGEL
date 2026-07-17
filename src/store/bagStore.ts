/**
 * Zustand store for BAGEL bag-file state.
 *
 * v0.9 multi-bag: the store holds a map of `bagId` → BagEntry. The "focused"
 * bag drives the bag-summary toolbar stats and defaults for newly-opened
 * panels; non-focused bags are still loaded and rendered in any panels that
 * were opened against them.
 *
 * Back-compat: `bag` and `source` are kept as derived selectors pointing at
 * the focused bag, so single-bag consumers (the v0.5-v0.8 hooks) continue
 * to work unchanged. New multi-bag-aware consumers read from `bags` /
 * `bagOrder` directly and look up entries by `bagId`.
 *
 * Time alignment (v0.9): three modes — `wall-clock`, `bag-start`, `anchor`.
 * The playhead operates in **aligned time**, where:
 *   - aligned = bag-local under `wall-clock`,
 *   - aligned = bag-local - bag.startTime under `bag-start`,
 *   - aligned = bag-local - bag.anchorNs under `anchor` (falls back to
 *               bag-start if a bag has no anchor set yet).
 * Each bag's read path converts aligned → bag-local via `bagLocalTimeFor`.
 */

import { create } from 'zustand';
import type { BagSummary } from '../types/bag';
import {
  parseBag,
  setCustomSchemas,
  disposeParserCachesFor,
  createFileSource,
  createUrlSource,
  releaseBagWorker,
  type BagSource,
} from '../parsers';
import { LiveConnection } from '../live/liveConnection';
import { getTopicColor } from '../utils/color';
import { useLayoutStore } from './layoutStore';
import { usePinnedTopicsStore } from './pinnedTopicsStore';
import { usePlayheadStore } from './playheadStore';
import { useCustomSchemaStore } from './customSchemaStore';
import { classifyBagError, type ActionableError } from '../utils/actionableError';

export type TimeAlignment = 'wall-clock' | 'bag-start' | 'anchor';

export interface BagEntry {
  /** Synthetic id assigned at load time. Stable across the bag's lifetime. */
  id: string;
  /** Source kind: 'file' and 'url' use the parser worker; 'live' uses LiveConnection. */
  kind: 'file' | 'url' | 'live';
  summary: BagSummary;
  /** Null for live connections (no file/URL source). */
  source: BagSource | null;
  /** Non-null only for live connections. */
  liveConn: LiveConnection | null;
  /** Hex colour string used for per-bag overlay tinting (and the toolbar chip). */
  color: string;
  /**
   * Optional anchor time (bag-local ns) used under `anchor` alignment.
   * `undefined` means "no anchor picked yet" — the bag falls back to
   * bag-start alignment until the user picks one.
   */
  anchorNs?: bigint;
}

interface BagState {
  bags: Map<string, BagEntry>;
  /** Insertion order — drives sidebar grouping + colour stability. */
  bagOrder: string[];
  focusBagId: string | null;
  alignment: TimeAlignment;
  isLoading: boolean;
  error: ActionableError | null;
  loadProgress: number;

  addBagFromFile: (file: File) => Promise<string | null>;
  addBagFromUrl: (url: string) => Promise<string>;
  addBagLive: (wsUrl: string) => string;
  removeBag: (id: string) => void;
  setFocusBag: (id: string) => void;
  setAlignment: (mode: TimeAlignment) => void;
  setAnchor: (id: string, anchorNs: bigint | undefined) => void;
  clearAll: () => void;
  clearError: () => void;

  // ── Back-compat: single-bag selectors point at the focused bag. ────────
  /** @deprecated Pass an explicit bagId to multi-bag-aware hooks instead. */
  bag: BagSummary | null;
  /** @deprecated Pass an explicit bagId to multi-bag-aware hooks instead. */
  source: BagSource | null;

  // ── v0.8.x back-compat aliases (single-bag flow). ──────────────────────
  /** Loads a file and focuses it. Clears any other bags first. */
  loadBag: (file: File) => Promise<void>;
  /** Loads a URL and focuses it. Clears any other bags first. */
  loadBagFromUrl: (url: string) => Promise<void>;
  /** Clears every loaded bag and resets focus. */
  clearBag: () => void;
}

/**
 * Generate a unique bagId. We use a counter (rather than a uuid) so the id
 * is short enough to fit comfortably in a URL hash.
 */
let bagIdCounter = 0;
function nextBagId(): string {
  bagIdCounter++;
  return `b${bagIdCounter}`;
}

/**
 * Picking a colour for a newly-loaded bag — uses the existing topic-colour
 * palette but seeded by the bag id so subsequent loads get distinct hues
 * without needing a global palette index.
 */
function pickBagColor(id: string, index: number): string {
  const palette = [
    '#3b82f6', // blue
    '#f97316', // orange
    '#10b981', // emerald
    '#a855f7', // violet
    '#ef4444', // red
    '#06b6d4', // cyan
    '#eab308', // amber
    '#ec4899', // pink
  ];
  if (index < palette.length) return palette[index];
  // Fall back to the same hash-based scheme used for topic colours so we never
  // run out of distinct hues.
  return getTopicColor(id, 'bag');
}

export const useBagStore = create<BagState>((set, get) => ({
  bags: new Map(),
  bagOrder: [],
  focusBagId: null,
  alignment: 'wall-clock',
  isLoading: false,
  error: null,
  loadProgress: 0,
  bag: null,
  source: null,

  addBagFromFile: async (file: File) => {
    set({ isLoading: true, error: null, loadProgress: 10 });
    try {
      const source = createFileSource(file);
      // Mint the bagId up front so parseBag's worker assignment matches the
      // id we'll register the entry under. Subsequent per-topic reads will
      // hit the same worker's reader cache and skip the re-parse.
      const id = nextBagId();
      set({ loadProgress: 30 });
      const summary = await parseBag(source, id);
      // Push the persisted custom-schema map to the freshly-spawned worker
      // so .db3 topics with user-pasted schemas decode on the first read.
      // Without this, the new worker only learns about the schemas on the
      // next paste/delete in the modal, leaving freshly-loaded bags broken.
      const currentSchemas = useCustomSchemaStore.getState().schemas;
      if (Object.keys(currentSchemas).length > 0) {
        await setCustomSchemas(currentSchemas);
      }
      const state = get();
      const color = pickBagColor(id, state.bagOrder.length);
      const entry: BagEntry = { id, kind: 'file', summary, source, liveConn: null, color };
      const newBags = new Map(state.bags);
      newBags.set(id, entry);
      const newOrder = [...state.bagOrder, id];
      // First bag becomes focused automatically; subsequent loads leave the
      // user's focus alone so adding a comparison bag doesn't move the
      // toolbar / sidebar focus out from under them.
      const newFocus = state.focusBagId ?? id;
      const focusEntry = newBags.get(newFocus) ?? entry;
      const wasFirstBag = state.bagOrder.length === 0;
      set({
        bags: newBags,
        bagOrder: newOrder,
        focusBagId: newFocus,
        bag: focusEntry.summary,
        source: focusEntry.source,
        isLoading: false,
        loadProgress: 100,
        error: null,
      });
      syncPlayheadRange(newBags, newOrder, state.alignment, wasFirstBag);
      return id;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'An unknown error occurred while parsing the bag file.';
      console.error('Failed to load bag file:', err);
      set({ isLoading: false, error: classifyBagError(message, 'file'), loadProgress: 0 });
      return null;
    }
  },

  addBagFromUrl: async (url: string) => {
    set({ isLoading: true, error: null, loadProgress: 5 });
    try {
      const source = await createUrlSource(url);
      const id = nextBagId();
      set({ loadProgress: 30 });
      const summary = await parseBag(source, id);
      const currentSchemas = useCustomSchemaStore.getState().schemas;
      if (Object.keys(currentSchemas).length > 0) {
        await setCustomSchemas(currentSchemas);
      }
      const state = get();
      const color = pickBagColor(id, state.bagOrder.length);
      const entry: BagEntry = { id, kind: 'url', summary, source, liveConn: null, color };
      const newBags = new Map(state.bags);
      newBags.set(id, entry);
      const newOrder = [...state.bagOrder, id];
      const newFocus = state.focusBagId ?? id;
      const focusEntry = newBags.get(newFocus) ?? entry;
      const wasFirstBag = state.bagOrder.length === 0;
      set({
        bags: newBags,
        bagOrder: newOrder,
        focusBagId: newFocus,
        bag: focusEntry.summary,
        source: focusEntry.source,
        isLoading: false,
        loadProgress: 100,
        error: null,
      });
      syncPlayheadRange(newBags, newOrder, state.alignment, wasFirstBag);
      return id;
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'An unknown error occurred while fetching the bag from the URL.';
      console.error('Failed to load bag from URL:', err);
      set({ isLoading: false, error: classifyBagError(message, 'url'), loadProgress: 0 });
      throw err;
    }
  },

  addBagLive: (wsUrl: string): string => {
    const state = get();
    const id = nextBagId();
    const color = pickBagColor(id, state.bagOrder.length);

    const initialSummary: BagSummary = {
      format: 'live',
      fileName: wsUrl,
      fileSize: 0,
      startTime: 0n,
      endTime: 0n,
      duration: 0,
      totalMessageCount: 0,
      topics: [],
    };

    // LiveConnection calls back here whenever the summary changes (new topics
    // advertised, or the 1 Hz stats flush). We update the map entry in-place
    // without touching unrelated bags.
    const onSummaryUpdate = (summary: BagSummary) => {
      const s = get();
      const existing = s.bags.get(id);
      if (!existing) return;
      const newBags = new Map(s.bags);
      newBags.set(id, { ...existing, summary });
      const isFocus = s.focusBagId === id;
      set({ bags: newBags, ...(isFocus && { bag: summary }) });
      if (summary.startTime > 0n) {
        syncPlayheadRange(newBags, s.bagOrder, s.alignment, false);
      }
    };

    const conn = new LiveConnection(id, wsUrl, onSummaryUpdate);
    const entry: BagEntry = {
      id,
      kind: 'live',
      summary: initialSummary,
      source: null,
      liveConn: conn,
      color,
    };

    const newBags = new Map(state.bags);
    newBags.set(id, entry);
    const newOrder = [...state.bagOrder, id];
    const wasFirstBag = state.bagOrder.length === 0;
    const newFocus = state.focusBagId ?? id;
    const focusEntry = newBags.get(newFocus) ?? entry;

    set({
      bags: newBags,
      bagOrder: newOrder,
      focusBagId: newFocus,
      bag: focusEntry.summary,
      source: focusEntry.source,
      error: null,
    });

    if (wasFirstBag) {
      usePlayheadStore.getState().initFromBag(0n, 0n);
    }

    return id;
  },

  removeBag: (id: string) => {
    const state = get();
    const entry = state.bags.get(id);
    if (!entry) return;
    if (entry.kind === 'live') {
      entry.liveConn?.disconnect();
    } else {
      // Drop parser caches + tear down the per-bag worker so memory is freed.
      disposeParserCachesFor(id);
      releaseBagWorker(id);
    }
    // Close every panel that was reading from this bag so no panel renders
    // against a vanished entry. The static import is one-way (layoutStore
    // doesn't depend on bagStore) so no cycle.
    useLayoutStore.getState().closePanelsForBag(id);
    usePinnedTopicsStore.getState().clearForBag(id);
    const newBags = new Map(state.bags);
    newBags.delete(id);
    const newOrder = state.bagOrder.filter((x) => x !== id);
    const newFocus =
      state.focusBagId === id ? (newOrder[0] ?? null) : state.focusBagId;
    const focusEntry = newFocus ? newBags.get(newFocus) : undefined;
    set({
      bags: newBags,
      bagOrder: newOrder,
      focusBagId: newFocus,
      bag: focusEntry?.summary ?? null,
      source: focusEntry?.source ?? null,
    });
    syncPlayheadRange(newBags, newOrder, state.alignment, false);
  },

  setFocusBag: (id: string) => {
    const state = get();
    const entry = state.bags.get(id);
    if (!entry) return;
    set({
      focusBagId: id,
      bag: entry.summary,
      source: entry.source,
    });
  },

  setAlignment: (mode: TimeAlignment) => {
    const state = get();
    set({ alignment: mode });
    syncPlayheadRange(state.bags, state.bagOrder, mode, false);
  },

  setAnchor: (id: string, anchorNs: bigint | undefined) => {
    const state = get();
    const entry = state.bags.get(id);
    if (!entry) return;
    const newBags = new Map(state.bags);
    newBags.set(id, { ...entry, anchorNs });
    set({ bags: newBags });
    if (state.alignment === 'anchor') {
      syncPlayheadRange(newBags, state.bagOrder, state.alignment, false);
    }
  },

  clearAll: () => {
    const state = get();
    for (const id of state.bagOrder) {
      const entry = state.bags.get(id);
      if (entry?.kind === 'live') {
        entry.liveConn?.disconnect();
      } else {
        disposeParserCachesFor(id);
        releaseBagWorker(id);
      }
    }
    set({
      bags: new Map(),
      bagOrder: [],
      focusBagId: null,
      bag: null,
      source: null,
      isLoading: false,
      error: null,
      loadProgress: 0,
    });
    // Reset playhead to a sentinel range so panels rendered against the
    // empty store don't try to clamp into a stale interval.
    usePlayheadStore.getState().initFromBag(0n, 0n);
  },

  clearError: () => {
    set({ error: null });
  },

  // v0.8.x back-compat — single-bag flow replaces any existing bags.
  loadBag: async (file: File) => {
    get().clearAll();
    await get().addBagFromFile(file);
  },

  loadBagFromUrl: async (url: string) => {
    get().clearAll();
    await get().addBagFromUrl(url);
  },

  clearBag: () => {
    get().clearAll();
  },
}));

// ─── Time-alignment helpers ────────────────────────────────────────────────

/** Aligned-time offset for `entry` under the current alignment mode. */
export function alignmentOffsetFor(entry: BagEntry, mode: TimeAlignment): bigint {
  // Live bags use wall-clock time natively (messages arrive at epoch ns).
  // Always return 0 so the playhead and ring-buffer searches stay in the same
  // coordinate space regardless of which alignment mode the user has chosen.
  if (entry.kind === 'live') return 0n;
  switch (mode) {
    case 'wall-clock':
      return 0n;
    case 'bag-start':
      return entry.summary.startTime;
    case 'anchor':
      // Fall back to bag-start when no anchor is set yet — the user hasn't
      // picked a sync point so we just align the bag starts.
      return entry.anchorNs ?? entry.summary.startTime;
  }
}

/** Convert an aligned-time playhead ns into the equivalent bag-local ns. */
export function bagLocalTimeFor(entry: BagEntry, alignedNs: bigint, mode: TimeAlignment): bigint {
  return alignedNs + alignmentOffsetFor(entry, mode);
}

/** Convert a bag-local ns into the equivalent aligned-time ns. */
export function alignedTimeFor(entry: BagEntry, bagLocalNs: bigint, mode: TimeAlignment): bigint {
  return bagLocalNs - alignmentOffsetFor(entry, mode);
}

/**
 * Resolve a bagId — empty string / undefined / unknown ids all fall back to
 * the focused bag. Returns null when no bag at all is loaded.
 *
 * The fallback path is what lets v0.7 / v0.8 panel ids (no embedded bagId)
 * continue to work after the multi-bag refactor: a panel without an explicit
 * bagId always renders the focused bag.
 */
export function resolveBagEntry(
  state: BagState,
  bagId: string | null | undefined,
): BagEntry | null {
  if (bagId) {
    const explicit = state.bags.get(bagId);
    if (explicit) return explicit;
  }
  if (state.focusBagId) {
    const focused = state.bags.get(state.focusBagId);
    if (focused) return focused;
  }
  return null;
}

/**
 * Compute the union of every loaded bag's aligned [start, end] range. Returns
 * null when no bags are loaded — callers can use that as a "no playable
 * timeline" sentinel.
 */
export function alignedTimelineRange(
  bags: Map<string, BagEntry>,
  bagOrder: string[],
  mode: TimeAlignment,
): { startNs: bigint; endNs: bigint } | null {
  if (bagOrder.length === 0) return null;
  let start: bigint | null = null;
  let end: bigint | null = null;
  for (const id of bagOrder) {
    const entry = bags.get(id);
    if (!entry) continue;
    const s = alignedTimeFor(entry, entry.summary.startTime, mode);
    const e = alignedTimeFor(entry, entry.summary.endTime, mode);
    if (start === null || s < start) start = s;
    if (end === null || e > end) end = e;
  }
  if (start === null || end === null) return null;
  return { startNs: start, endNs: end };
}

/**
 * Push the current aligned [start, end] window into `playheadStore` so the
 * Timeline scrubber and `seek` clamp boundaries cover the whole multi-bag
 * range. When the first bag is loaded we also park the head at the new
 * start; for subsequent loads we re-clamp the existing position into the
 * new range so adding bag B doesn't yank the user off the spot they're
 * already paused at in bag A.
 */
function syncPlayheadRange(
  bags: Map<string, BagEntry>,
  bagOrder: string[],
  mode: TimeAlignment,
  wasFirstBag: boolean,
): void {
  const range = alignedTimelineRange(bags, bagOrder, mode);
  const ph = usePlayheadStore.getState();
  if (!range) {
    ph.initFromBag(0n, 0n);
    return;
  }
  if (wasFirstBag) {
    ph.initFromBag(range.startNs, range.endNs);
    return;
  }
  // For non-first bag operations, preserve current playhead position but
  // clamp it into the new (potentially wider/narrower) range. seek() does
  // the clamping for us once we've updated startNs/endNs.
  usePlayheadStore.setState({
    startNs: range.startNs,
    endNs: range.endNs,
  });
  ph.seek(usePlayheadStore.getState().timeNs);
}
