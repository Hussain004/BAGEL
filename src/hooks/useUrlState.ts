/**
 * URL hash <-> app state sync.
 *
 * We serialize the open panels and the playhead time into `location.hash` so
 * a session is shareable: dragging the same bag again on a different machine
 * + the same URL gives you the same layout.
 *
 * The hash schema is intentionally tiny — there's no router, just a flat
 * `key=value&...` form. Keys:
 *   - `t`   playhead time in seconds from bag start (3-digit precision)
 *   - `p`   comma-separated list of `${kind}:${topicName}` panel ids
 *
 * The bag itself is never encoded — bag files don't live on a URL, and even
 * if they did the user has to drop them in again.
 *
 * Restore is keyed on the bag's (name, size, duration) — it only fires if
 * the loaded bag plausibly matches the saved layout. Topics that no longer
 * exist are silently dropped from the panel list.
 */

import { useEffect, useRef } from 'react';
import { useBagStore } from '../store/bagStore';
import { useLayoutStore, type PanelKind } from '../store/layoutStore';
import { usePlayheadStore } from '../store/playheadStore';

const PANEL_KIND_VALUES: ReadonlySet<string> = new Set([
  'plot',
  'image',
  'raw',
  'trajectory',
  'tf',
  '3d',
]);

interface ParsedHash {
  timeSec?: number;
  panels: { kind: PanelKind; topicName: string }[];
}

function parseHash(hash: string): ParsedHash {
  const trimmed = hash.replace(/^#/, '');
  if (!trimmed) return { panels: [] };
  const params = new URLSearchParams(trimmed);
  const out: ParsedHash = { panels: [] };
  const t = params.get('t');
  if (t != null) {
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0) out.timeSec = n;
  }
  const p = params.get('p');
  if (p) {
    for (const raw of p.split(',')) {
      const idx = raw.indexOf(':');
      if (idx < 1) continue;
      const kind = raw.slice(0, idx);
      const topicName = decodeURIComponent(raw.slice(idx + 1));
      if (!PANEL_KIND_VALUES.has(kind) || !topicName) continue;
      out.panels.push({ kind: kind as PanelKind, topicName });
    }
  }
  return out;
}

function encodeHash(timeSec: number, panelIds: string[]): string {
  const params = new URLSearchParams();
  // 3 decimal places ≈ 1 ms resolution, plenty for human scrubbing without
  // bloating the URL on every playhead tick.
  params.set('t', timeSec.toFixed(3));
  if (panelIds.length > 0) {
    // We can't blindly trust `id` shape ("kind:topicName") because topic
    // names contain `/`. URLSearchParams already encodes `/` and `:` so the
    // result round-trips cleanly through parseHash.
    const encoded = panelIds
      .map((id) => {
        const idx = id.indexOf(':');
        if (idx < 0) return null;
        const kind = id.slice(0, idx);
        const topic = id.slice(idx + 1);
        return `${kind}:${encodeURIComponent(topic)}`;
      })
      .filter((s): s is string => !!s);
    if (encoded.length > 0) params.set('p', encoded.join(','));
  }
  return params.toString();
}

/**
 * useUrlState — Restore layout + playhead from the URL hash on bag load, and
 * write changes back to the hash as the user interacts.
 *
 * Restore fires once per `(fileName, fileSize)` pair so re-opening the same
 * file (or coming back to the page) re-applies the saved session.
 */
export function useUrlState(): void {
  const bag = useBagStore((s) => s.bag);

  // Track which (name, size) we've already restored against so we don't
  // re-apply on every render or fight the user as they close panels.
  const restoredKeyRef = useRef<string | null>(null);

  // ── Restore on bag load ────────────────────────────────────────────────
  useEffect(() => {
    if (!bag) {
      restoredKeyRef.current = null;
      return;
    }
    const key = `${bag.fileName}::${bag.fileSize}`;
    if (restoredKeyRef.current === key) return;
    restoredKeyRef.current = key;

    const parsed = parseHash(window.location.hash);

    // Apply playhead first so any panels that mount with the playhead read
    // the restored time immediately.
    if (parsed.timeSec !== undefined) {
      const startNs = bag.startTime;
      const endNs = bag.endTime;
      const targetNs = startNs + BigInt(Math.round(parsed.timeSec * 1e9));
      const clamped =
        targetNs < startNs ? startNs : targetNs > endNs ? endNs : targetNs;
      usePlayheadStore.getState().seek(clamped);
    }

    // Filter panel restores against the loaded bag's topic set so we don't
    // open panels for topics that don't exist (the panel itself would just
    // sit in an empty/error state).
    const topicTypes = new Map(bag.topics.map((t) => [t.name, t.type]));
    const restorePanels = parsed.panels
      .filter((p) => topicTypes.has(p.topicName))
      .map((p) => ({
        kind: p.kind,
        topicName: p.topicName,
        type: topicTypes.get(p.topicName)!,
      }));
    if (restorePanels.length === 0) return;

    const layout = useLayoutStore.getState();
    layout.closeAllPanels();
    for (const p of restorePanels) layout.openPanel(p);
  }, [bag]);

  // ── Write hash on change ───────────────────────────────────────────────
  useEffect(() => {
    if (!bag) {
      // No bag → no hash. Avoid leaving stale state in the URL.
      if (window.location.hash) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
      return;
    }

    const startNs = bag.startTime;

    let last = '';
    let pendingFrame: number | null = null;

    const computeAndWrite = (): void => {
      pendingFrame = null;
      const playhead = usePlayheadStore.getState();
      const panels = useLayoutStore.getState().panels;
      const timeSec = Math.max(0, Number(playhead.timeNs - startNs) / 1e9);
      const next = encodeHash(timeSec, panels.map((p) => p.id));
      if (next === last) return;
      last = next;
      // replaceState rather than pushState — the hash represents the current
      // view, not a navigable history.
      window.history.replaceState(null, '', `#${next}`);
    };

    // Coalesce rapid updates into one rAF — playback ticks at 60 Hz and
    // calling replaceState on every tick is wasteful.
    const schedule = () => {
      if (pendingFrame !== null) return;
      pendingFrame = requestAnimationFrame(computeAndWrite);
    };

    const unsubPlayhead = usePlayheadStore.subscribe(schedule);
    const unsubLayout = useLayoutStore.subscribe(schedule);

    // Initial write so an opened bag without a hash gets one.
    computeAndWrite();

    return () => {
      unsubPlayhead();
      unsubLayout();
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    };
  }, [bag]);
}
