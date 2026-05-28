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
 *           * `P<kind>:<URL-encoded topic>` for a panel leaf
 *           * `H(<child>,<child>,...)` for a horizontal split
 *           * `V(<child>,<child>,...)` for a vertical split
 *           e.g. `H(Pplot:%2Fodom,V(Pimage:%2Fcam,Pplot:%2Fimu))`.
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
  /** Layout tree where leaves carry placeholder `type: ''` — caller resolves. */
  root: LayoutNode | null;
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
    const colon = raw.indexOf(':');
    if (colon < 1) return null;
    const kind = raw.slice(0, colon);
    if (!PANEL_KIND_VALUES.has(kind)) return null;
    let topicName: string;
    try {
      topicName = decodeURIComponent(raw.slice(colon + 1));
    } catch {
      return null;
    }
    if (!topicName) return null;
    return {
      node: 'panel',
      id: `${kind}:${topicName}`,
      kind: kind as PanelKind,
      topicName,
      // Real ROS type filled in during restore from the bag's topic table.
      type: '',
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
  return out;
}

/** Serialise a layout tree back to the compact `P/H/V` form. */
function encodeNode(node: LayoutNode): string {
  if (node.node === 'panel') {
    return `P${node.kind}:${encodeURIComponent(node.topicName)}`;
  }
  const tag = node.orientation === 'horizontal' ? 'H' : 'V';
  return `${tag}(${node.children.map(encodeNode).join(',')})`;
}

function encodeHash(timeSec: number, root: LayoutNode | null): string {
  const params = new URLSearchParams();
  // 3 decimal places ≈ 1 ms — fine for human scrubbing, keeps the URL short.
  params.set('t', timeSec.toFixed(3));
  if (root) params.set('p', encodeNode(root));
  return params.toString();
}

/**
 * Walk the parsed tree, attaching real ROS types from the bag and dropping
 * leaves whose topics aren't in this bag. Returns null if nothing survives.
 */
function attachTypesAndPrune(
  node: LayoutNode | null,
  topicTypes: Map<string, string>,
): LayoutNode | null {
  if (!node) return null;
  if (node.node === 'panel') {
    const type = topicTypes.get(node.topicName);
    if (!type) return null;
    return { ...node, type };
  }
  const survivors: LayoutNode[] = [];
  for (const c of node.children) {
    const after = attachTypesAndPrune(c, topicTypes);
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

    if (!parsed.root) return;

    const topicTypes = new Map(bag.topics.map((t) => [t.name, t.type]));
    const restoredTree = attachTypesAndPrune(parsed.root, topicTypes);
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

    const startNs = bag.startTime;

    let last = '';
    let pendingFrame: number | null = null;

    const computeAndWrite = (): void => {
      pendingFrame = null;
      const playhead = usePlayheadStore.getState();
      const root = useLayoutStore.getState().root;
      const timeSec = Math.max(0, Number(playhead.timeNs - startNs) / 1e9);
      const next = encodeHash(timeSec, root);
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
