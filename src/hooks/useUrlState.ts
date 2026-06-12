/**
 * URL hash <-> app state sync.
 *
 * Serialises the open panels and the playhead time into `location.hash` so a
 * session is shareable: dragging the same bag again on a different machine
 * with the same URL gives you the same layout and playhead position.
 *
 * The hash schema is intentionally tiny — there's no router, just a flat
 * `key=value&...` form. Keys:
 *   - `t` — playhead time in seconds from bag start (3-digit precision)
 *   - `p` — the layout tree, encoded recursively:
 *           * `P<kind>:<URL-encoded topic>` for a single-bag panel (v0.7/v0.8)
 *           * `P<kind>:<bagId>:<URL-encoded topic>` for a multi-bag panel (v0.9)
 *           * `H(<child>,<child>,...)` for a horizontal split
 *           * `V(<child>,<child>,...)` for a vertical split
 *           e.g. `H(Pplot:%2Fodom,V(Pimage:%2Fcam,Pplot:b2:%2Fimu))`.
 *   - `b` — first bag URL (v0.9) — restored on page open if no bag is loaded yet.
 *   - `a` — per-bag anchor times under `anchor` alignment (v1.0). Comma-
 *           separated `bagId:bagLocalNs` pairs, e.g. `a=b1:5000000000,b2:8230000000`.
 *           Bags without explicit anchors are omitted; the parser ignores
 *           entries whose bagId isn't loaded so stale links degrade gracefully.
 *
 * Back-compat: v0.5 hashes used a flat `p=plot:topic1,image:topic2` form
 * without the `P/H/V` prefixes. We detect that shape (no leading `P/H/V`)
 * and lift it into a single horizontal split, matching the v0.5 layout
 * the user originally saw.
 *
 * The bag itself is never encoded — bag files don't live on a URL, and
 * even if they did the user has to drop them in again. Restore is keyed
 * on the bag's (name, size) — it only fires if the loaded bag plausibly
 * matches the saved layout. Leaves whose topics no longer exist are
 * silently dropped from the tree, and resulting empty splits collapse.
 */

import { useEffect, useRef } from 'react';
import { useBagStore } from '../store/bagStore';
import {
  useLayoutStore,
  type LayoutNode,
  type PanelKind,
  type PanelLeaf,
  type SplitNode,
  type SplitOrientation,
} from '../store/layoutStore';
import { usePlayheadStore } from '../store/playheadStore';
import { useAnnotationStore, type Annotation } from '../store/annotationStore';

const PANEL_KIND_VALUES: ReadonlySet<string> = new Set([
  'plot',
  'image',
  'raw',
  'trajectory',
  'tf',
  '3d',
  'diagnostic',
  'log',
  'health',
]);

interface ParsedHash {
  timeSec?: number;
  /** Layout tree where leaves carry placeholder `type: ''` — caller resolves. */
  root: LayoutNode | null;
  /** Optional remote bag URL to load on page open (v0.9). */
  bagUrl?: string;
  /** Per-bag anchor map: bagId → bag-local-ns. Applied after bag load (v1.0). */
  anchors?: Map<string, bigint>;
  /**
   * Timeline bookmarks from the `bm=` hash segment (v1.4.3).
   * timeNs is a placeholder (0n) here — it's resolved to aligned ns in the
   * restore effect once the bag's playhead range is known.
   */
  bookmarks?: { id: string; timeSec: number; label: string }[];
}

/**
 * Recursive-descent parser for the v0.7 tree encoding. Index-based; bumps
 * `pos` as it consumes characters. Returns null on malformed input rather
 * than throwing so a bad hash just falls back to "no restore."
 */
function parseTreeEncoding(input: string): LayoutNode | null {
  let pos = 0;
  let splitCounter = 0;

  function parseNode(): LayoutNode | null {
    if (pos >= input.length) return null;
    const ch = input[pos];
    if (ch === 'P') return parsePanel();
    if (ch === 'H' || ch === 'V') {
      return parseSplit(ch === 'H' ? 'horizontal' : 'vertical');
    }
    return null;
  }

  function parsePanel(): PanelLeaf | null {
    pos++; // 'P'
    // Panel body runs until the next ',' or ')' at this depth — neither
    // appears in a URL-encoded topic name, so a flat scan is safe.
    let end = pos;
    while (end < input.length && input[end] !== ',' && input[end] !== ')') end++;
    const raw = input.slice(pos, end);
    pos = end;
    // Split on `:` — two parts means single-bag (kind:topic), three+ parts
    // means multi-bag (kind:bagId:topic). URL-decoded topic names don't
    // contain literal colons; any colon in the original would be `%3A` in
    // the encoded form, so this split is unambiguous.
    const parts = raw.split(':');
    if (parts.length < 2) return null;
    const kind = parts[0];
    if (!PANEL_KIND_VALUES.has(kind)) return null;
    let bagId: string | undefined;
    let encodedTopic: string;
    if (parts.length === 2) {
      encodedTopic = parts[1];
    } else {
      bagId = parts[1] || undefined;
      // Re-join in case a topic ever contains a literal `:` (it shouldn't,
      // but encoding handles it via `%3A` so the parts.length check stays valid).
      encodedTopic = parts.slice(2).join(':');
    }
    let topicName: string;
    try {
      topicName = decodeURIComponent(encodedTopic);
    } catch {
      return null;
    }
    if (!topicName) return null;
    return {
      node: 'panel',
      id: bagId ? `${kind}:${bagId}:${topicName}` : `${kind}:${topicName}`,
      kind: kind as PanelKind,
      topicName,
      // Real ROS type filled in during restore from the bag's topic table.
      type: '',
      bagId,
    };
  }

  function parseSplit(orientation: SplitOrientation): LayoutNode | null {
    pos++; // 'H' or 'V'
    if (input[pos] !== '(') return null;
    pos++; // '('
    const children: LayoutNode[] = [];
    while (pos < input.length && input[pos] !== ')') {
      const child = parseNode();
      if (!child) return null;
      children.push(child);
      if (input[pos] === ',') pos++;
    }
    if (input[pos] !== ')') return null;
    pos++; // ')'
    if (children.length === 0) return null;
    if (children.length === 1) return children[0];
    return {
      node: 'split',
      // Synthetic ids — splits don't need stable ids across reloads since
      // there's no per-split state we'd want to persist.
      id: `split:r${++splitCounter}`,
      orientation,
      children,
    } satisfies SplitNode;
  }

  const tree = parseNode();
  // If we didn't consume the whole input, treat as malformed.
  if (pos !== input.length) return null;
  return tree;
}

/**
 * Back-compat parser for the v0.5 flat encoding (`kind:topic,kind:topic`).
 * The result is always a flat horizontal split so the layout looks the same
 * as it did before v0.7.
 */
function parseFlatEncoding(input: string): LayoutNode | null {
  const leaves: PanelLeaf[] = [];
  for (const raw of input.split(',')) {
    const colon = raw.indexOf(':');
    if (colon < 1) continue;
    const kind = raw.slice(0, colon);
    if (!PANEL_KIND_VALUES.has(kind)) continue;
    let topicName: string;
    try {
      topicName = decodeURIComponent(raw.slice(colon + 1));
    } catch {
      continue;
    }
    if (!topicName) continue;
    leaves.push({
      node: 'panel',
      id: `${kind}:${topicName}`,
      kind: kind as PanelKind,
      topicName,
      type: '',
      // No bagId in v0.5 flat encoding — resolves to the focused bag at load time.
    });
  }
  if (leaves.length === 0) return null;
  if (leaves.length === 1) return leaves[0];
  return {
    node: 'split',
    id: `split:r0`,
    orientation: 'horizontal',
    children: leaves,
  };
}

function parseHash(hash: string): ParsedHash {
  const trimmed = hash.replace(/^#/, '');
  if (!trimmed) return { root: null };
  const params = new URLSearchParams(trimmed);
  const out: ParsedHash = { root: null };
  const t = params.get('t');
  if (t != null) {
    const n = Number(t);
    if (Number.isFinite(n) && n >= 0) out.timeSec = n;
  }
  const p = params.get('p');
  if (p) {
    const first = p[0];
    // Trees start with one of the node tags; older flat encodings start
    // with the kind directly (`plot:`, `image:`, …).
    if (first === 'P' || first === 'H' || first === 'V') {
      out.root = parseTreeEncoding(p);
    } else {
      out.root = parseFlatEncoding(p);
    }
  }
  const b = params.get('b');
  if (b) {
    // Sanity-check that it parses as a URL — anything else (typo, partial
    // hash, leftover state) just gets ignored.
    try {
      const u = new URL(b);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.bagUrl = b;
    } catch {
      // discard
    }
  }
  const a = params.get('a');
  if (a) {
    const anchors = new Map<string, bigint>();
    for (const pair of a.split(',')) {
      const colon = pair.indexOf(':');
      if (colon < 1) continue;
      const bagId = pair.slice(0, colon);
      const nsRaw = pair.slice(colon + 1);
      // BigInt() throws on a malformed string — guard so a bad pair doesn't
      // kill the whole hash restore.
      try {
        anchors.set(bagId, BigInt(nsRaw));
      } catch {
        // discard this pair, keep the others
      }
    }
    if (anchors.size > 0) out.anchors = anchors;
  }

  // `bm=` encodes timeline bookmarks (v1.4.3).
  // Format: pipe-separated `timeSec.3f,label` tuples with label URL-encoded.
  // e.g. `bm=1.500,Mark+1|12.300,TF%20jump`
  const bm = params.get('bm');
  if (bm) {
    const bookmarks: { id: string; timeSec: number; label: string }[] = [];
    for (const seg of bm.split('|')) {
      const comma = seg.indexOf(',');
      if (comma < 1) continue;
      const timeSec = parseFloat(seg.slice(0, comma));
      if (!Number.isFinite(timeSec) || timeSec < 0) continue;
      let label: string;
      try {
        label = decodeURIComponent(seg.slice(comma + 1));
      } catch {
        continue;
      }
      if (!label) continue;
      bookmarks.push({
        id: `bm-${Math.random().toString(36).slice(2, 8)}`,
        timeSec,
        label,
      });
    }
    if (bookmarks.length > 0) out.bookmarks = bookmarks;
  }

  return out;
}

/** Serialise a layout tree back to the compact `P/H/V` form. */
function encodeNode(node: LayoutNode): string {
  if (node.node === 'panel') {
    // Single-bag shape stays as `Pkind:topic` so v0.7 / v0.8 shared links
    // keep producing the exact same hash they did before.
    if (!node.bagId) {
      return `P${node.kind}:${encodeURIComponent(node.topicName)}`;
    }
    return `P${node.kind}:${node.bagId}:${encodeURIComponent(node.topicName)}`;
  }
  const tag = node.orientation === 'horizontal' ? 'H' : 'V';
  return `${tag}(${node.children.map(encodeNode).join(',')})`;
}

function encodeHash(
  timeSec: number,
  root: LayoutNode | null,
  bagUrl: string | null,
  anchors: Map<string, bigint> | null,
  bookmarks: { timeSec: number; label: string }[] | null,
): string {
  const params = new URLSearchParams();
  // 3 decimal places ≈ 1 ms — fine for human scrubbing, keeps the URL short.
  params.set('t', timeSec.toFixed(3));
  if (root) params.set('p', encodeNode(root));
  // `b=` carries the bag's source URL when the bag was loaded from a remote
  // URL (v0.9). File-loaded bags omit it — there's no way to encode a local
  // File handle. Refreshing or sharing the link re-fetches the bag and
  // restores the same layout + playhead position.
  if (bagUrl) params.set('b', bagUrl);
  // `a=` encodes per-bag anchors. Only emitted for bags that have an explicit
  // anchor — bags using the startTime fallback omit themselves so the param
  // stays absent on the default single-bag flow.
  if (anchors && anchors.size > 0) {
    const pairs: string[] = [];
    for (const [bagId, ns] of anchors) {
      pairs.push(`${bagId}:${ns.toString()}`);
    }
    params.set('a', pairs.join(','));
  }
  // `bm=` encodes timeline bookmarks (v1.4.3). Omitted when empty so single-bag
  // hashes without bookmarks stay identical to their pre-v1.4.3 form.
  if (bookmarks && bookmarks.length > 0) {
    params.set(
      'bm',
      bookmarks
        .map((b) => `${b.timeSec.toFixed(3)},${encodeURIComponent(b.label)}`)
        .join('|'),
    );
  }
  return params.toString();
}

/**
 * Walk the parsed tree, attaching real ROS types from the bag and dropping
 * leaves whose topics aren't in this bag. Returns null if nothing survives.
 *
 * Multi-bag-aware: a leaf with a `bagId` looks up its type in that bag if
 * loaded, otherwise falls through to the focused bag's table. Saved hashes
 * with stale bagIds (from a prior page session) thus degrade gracefully
 * rather than dropping every leaf.
 */
function attachTypesAndPrune(
  node: LayoutNode | null,
  bagTopicTypes: Map<string, Map<string, string>>,
  focusBagId: string | null,
): LayoutNode | null {
  if (!node) return null;
  if (node.node === 'panel') {
    let type: string | undefined;
    let resolvedBagId: string | undefined = node.bagId;
    if (node.bagId && bagTopicTypes.has(node.bagId)) {
      type = bagTopicTypes.get(node.bagId)!.get(node.topicName);
    }
    if (!type && focusBagId && bagTopicTypes.has(focusBagId)) {
      type = bagTopicTypes.get(focusBagId)!.get(node.topicName);
      // Stale bagId → adopt focused bag so subsequent reads route correctly.
      if (type) resolvedBagId = focusBagId;
    }
    if (!type) return null;
    return { ...node, type, bagId: resolvedBagId };
  }
  const survivors: LayoutNode[] = [];
  for (const c of node.children) {
    const after = attachTypesAndPrune(c, bagTopicTypes, focusBagId);
    if (after) survivors.push(after);
  }
  if (survivors.length === 0) return null;
  if (survivors.length === 1) return survivors[0];
  return { ...node, children: survivors };
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
  const source = useBagStore((s) => s.source);
  const loadBagFromUrl = useBagStore((s) => s.loadBagFromUrl);
  const isLoading = useBagStore((s) => s.isLoading);
  const error = useBagStore((s) => s.error);

  // Track which (name, size) we've already restored against so we don't
  // re-apply on every render or fight the user as they close panels.
  const restoredKeyRef = useRef<string | null>(null);
  /** Tracks whether we've already kicked off the page-load URL fetch — set
   *  on first attempt so a fetch failure doesn't loop. */
  const urlAutoLoadStartedRef = useRef(false);

  // ── Auto-load a bag from the URL hash on first page visit ──────────────
  //
  // A `#b=<url>` parameter in the hash is the v0.9 "share a pre-loaded
  // session" affordance — refreshing or sharing a link with a bag URL
  // re-fetches the bag so the recipient sees the same data. Fires once
  // per page load; user-driven loads after that are not auto-overridden.
  useEffect(() => {
    if (urlAutoLoadStartedRef.current) return;
    if (bag || isLoading || error) return;
    const parsed = parseHash(window.location.hash);
    if (!parsed.bagUrl) return;
    urlAutoLoadStartedRef.current = true;
    void loadBagFromUrl(parsed.bagUrl);
  }, [bag, isLoading, error, loadBagFromUrl]);

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
    // the restored time immediately. The hash encodes seconds from the
    // playhead range start (aligned time under multi-bag); under v0.7/v0.8
    // single-bag wall-clock alignment this is identical to seconds from
    // bag.startTime, so existing share links round-trip exactly.
    const phState = usePlayheadStore.getState();
    const { startNs: phStart, endNs: phEnd } = phState;

    if (parsed.timeSec !== undefined) {
      const targetNs = phStart + BigInt(Math.round(parsed.timeSec * 1e9));
      const clamped =
        targetNs < phStart ? phStart : targetNs > phEnd ? phEnd : targetNs;
      phState.seek(clamped);
    }

    // Apply saved per-bag anchors (v1.0). Only sets anchors for bags that
    // are actually loaded; stale bagIds from a prior session are dropped.
    if (parsed.anchors) {
      const bagState = useBagStore.getState();
      for (const [bagId, anchorNs] of parsed.anchors) {
        if (bagState.bags.has(bagId)) {
          bagState.setAnchor(bagId, anchorNs);
        }
      }
    }

    // Load bookmarks for this bag (v1.4.3). URL-hash bookmarks take priority
    // over localStorage so a shared link restores the sender's annotations.
    {
      const bagEntry = useBagStore.getState().bags.get(useBagStore.getState().focusBagId ?? '');
      const bagKey =
        bagEntry?.source?.kind === 'url'
          ? bagEntry.source.url
          : `${bag.fileName}:${bag.fileSize}`;

      if (parsed.bookmarks) {
        const hydrated: Annotation[] = parsed.bookmarks.map((b) => {
          const ns = phStart + BigInt(Math.round(b.timeSec * 1e9));
          const clamped = ns < phStart ? phStart : ns > phEnd ? phEnd : ns;
          return { id: b.id, timeNs: clamped, label: b.label };
        });
        useAnnotationStore.getState().loadForBag(bagKey, hydrated);
      } else {
        useAnnotationStore.getState().loadForBag(bagKey);
      }
    }

    if (!parsed.root) return;

    const bagState = useBagStore.getState();
    const bagTopicTypes = new Map<string, Map<string, string>>();
    for (const [id, entry] of bagState.bags) {
      bagTopicTypes.set(id, new Map(entry.summary.topics.map((t) => [t.name, t.type])));
    }
    const restoredTree = attachTypesAndPrune(parsed.root, bagTopicTypes, bagState.focusBagId);
    if (!restoredTree) return;

    useLayoutStore.getState().restoreLayout(restoredTree);
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

    // Only URL-loaded bags persist their source in the hash — there's no way
    // to encode a local File handle. The source ref is captured here and used
    // on every write below; it changes infrequently (only on load/clear).
    const bagUrl = source?.kind === 'url' ? source.url : null;

    let last = '';
    let pendingFrame: number | null = null;

    const computeAndWrite = (): void => {
      pendingFrame = null;
      const playhead = usePlayheadStore.getState();
      const root = useLayoutStore.getState().root;
      // Encode time relative to the playhead range start (the multi-bag
      // aligned window). Under single-bag wall-clock this still equals
      // `timeNs - bag.startTime` so v0.7/v0.8 share links round-trip.
      const timeSec = Math.max(0, Number(playhead.timeNs - playhead.startNs) / 1e9);
      // Collect anchors from bagStore; only bags with an explicit anchor end
      // up in the hash so single-bag (and default-anchor multi-bag) links
      // round-trip identically to v0.9.
      const anchorMap = new Map<string, bigint>();
      const bagState = useBagStore.getState();
      for (const [id, entry] of bagState.bags) {
        if (entry.anchorNs !== undefined) anchorMap.set(id, entry.anchorNs);
      }
      // Encode bookmarks (v1.4.3). Only emit when non-empty so single-bag
      // hashes without bookmarks stay identical to their pre-v1.4.3 form.
      const { annotations } = useAnnotationStore.getState();
      const bookmarks =
        annotations.length > 0
          ? annotations
              .map((a) => ({
                timeSec: Math.max(0, Number(a.timeNs - playhead.startNs) / 1e9),
                label: a.label,
              }))
              .filter((b) => b.timeSec >= 0)
          : null;
      const next = encodeHash(
        timeSec,
        root,
        bagUrl,
        anchorMap.size > 0 ? anchorMap : null,
        bookmarks,
      );
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
    // Subscribe to bagStore too so anchor + alignment changes flush to the
    // hash immediately — without this, setting an anchor wouldn't show up
    // in the URL until the next playhead tick.
    const unsubBag = useBagStore.subscribe(schedule);
    // Subscribe to annotationStore so bookmark changes flush to the hash.
    const unsubAnnotations = useAnnotationStore.subscribe(schedule);

    // Initial write so an opened bag without a hash gets one.
    computeAndWrite();

    return () => {
      unsubPlayhead();
      unsubLayout();
      unsubBag();
      unsubAnnotations();
      if (pendingFrame !== null) cancelAnimationFrame(pendingFrame);
    };
  }, [bag, source]);
}
