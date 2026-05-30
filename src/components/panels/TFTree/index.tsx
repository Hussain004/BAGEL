import { useMemo, useState } from 'react';
import { useBagStore, resolveBagEntry } from '../../../store/bagStore';
import { useBagLocalPlayhead } from '../../../hooks/useBagLocalPlayhead';
import { PanelShell } from '../PanelShell';
import { getTopicColor } from '../../../utils/color';
import { nsToSeconds } from '../../../utils/time';
import {
  chainToRoot,
  lookupTransform,
  useTFGraph,
  type Quat,
  type TFGraph,
} from './useTFGraph';
import {
  DEFAULT_TFTREE_SETTINGS,
  useTFTreePanelStore,
} from '../../../store/panelUiStores';

interface TFTreeProps {
  panelId: string;
  topicName: string;
  type: string;
  bagId?: string;
}

interface LayoutNode {
  frame: string;
  depth: number;
  x: number; // column in node-units
  width: number; // subtree width in node-units
}

interface TreeLayout {
  nodes: Map<string, LayoutNode>;
  totalWidth: number;
  maxDepth: number;
}

const COLUMN_PX = 130;
const ROW_PX = 84;
const NODE_RADIUS = 22;
const LEFT_PAD = 40;
const TOP_PAD = 32;

/**
 * TFTree — Interactive view of the ROS2 transform graph.
 *
 * Pulls every /tf and /tf_static sample, builds the parent→child graph,
 * lays it out top-down with a subtree-width algorithm so siblings never
 * overlap, and renders it as an SVG. Selecting a frame surfaces its
 * current transform (translation + quaternion + Euler angles) at the
 * playhead time and highlights the chain from the root.
 */
export function TFTree({ panelId, topicName, type, bagId }: TFTreeProps) {
  const bag = useBagStore((s) => resolveBagEntry(s, bagId))?.summary ?? null;
  const playheadNs = useBagLocalPlayhead(bagId);
  const { graph, loading, error, missing, progress } = useTFGraph(bagId);

  const layout = useMemo(() => (graph ? layoutTree(graph) : null), [graph]);
  // Selected frame persisted per panelId so a dock-induced remount or a
  // close + reopen keeps the user's chosen frame highlighted.
  const settings = useTFTreePanelStore(
    (s) => s.byId[panelId] ?? DEFAULT_TFTREE_SETTINGS,
  );
  const updateSettings = useTFTreePanelStore((s) => s.update);
  const selected = settings.selected;
  const setSelected = (next: string | null) =>
    updateSettings(panelId, { selected: next });

  // When the graph loads, default the selected frame to the first leaf so
  // the right panel isn't empty.
  const defaultSelected = useMemo(() => {
    if (!graph) return null;
    // Prefer common "interesting" frames (base_link, base_footprint), otherwise pick a leaf.
    const preferred = ['base_link', 'base_footprint', 'odom'];
    for (const p of preferred) {
      if (graph.frames.has(p)) return p;
    }
    for (const frame of graph.frames) {
      const children = graph.children.get(frame) ?? [];
      if (children.length === 0) return frame;
    }
    return graph.roots[0] ?? null;
  }, [graph]);

  const effectiveSelected = selected ?? defaultSelected;
  const accent = getTopicColor(topicName, type);
  const startNs = bag?.startTime ?? 0n;

  // Highlight the root→selected chain so the user can trace ancestry visually.
  const highlightedChain = useMemo(() => {
    if (!graph || !effectiveSelected) return new Set<string>();
    return new Set(chainToRoot(graph, effectiveSelected));
  }, [graph, effectiveSelected]);

  // Look up the active transform of the selected frame at the playhead.
  const selectedTransform = useMemo(() => {
    if (!graph || !effectiveSelected) return null;
    const parent = graph.parentOf.get(effectiveSelected);
    if (!parent) return null;
    const edge = graph.edges.get(`${parent}>${effectiveSelected}`);
    if (!edge) return null;
    const sample = lookupTransform(edge, playheadNs);
    return sample ? { parent, child: effectiveSelected, sample, isStatic: edge.isStatic } : null;
  }, [graph, effectiveSelected, playheadNs]);

  return (
    <PanelShell
      panelId={panelId}
      kind="tf"
      topicName={topicName}
      type={type}
      accentColor={accent}
      bagId={bagId}
    >
      {loading && <Loading progress={progress} />}
      {error && <ErrorState message={error} />}
      {!loading && !error && missing && (
        <EmptyState message="No /tf or /tf_static topic in this bag." />
      )}
      {!loading && !error && graph && graph.frames.size === 0 && (
        <EmptyState message="The /tf topic contains no transforms." />
      )}
      {graph && layout && graph.frames.size > 0 && (
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 min-w-0 min-h-0 overflow-auto bg-bg-primary/40 relative">
            <svg
              width={Math.max(layout.totalWidth * COLUMN_PX + 2 * LEFT_PAD, 320)}
              height={Math.max((layout.maxDepth + 1) * ROW_PX + 2 * TOP_PAD, 200)}
              className="block"
            >
              {/* Edges first, so node circles sit on top. */}
              {Array.from(graph.edges.values()).map((edge) => {
                const parent = layout.nodes.get(edge.parent);
                const child = layout.nodes.get(edge.child);
                if (!parent || !child) return null;
                const x1 = LEFT_PAD + parent.x * COLUMN_PX;
                const y1 = TOP_PAD + parent.depth * ROW_PX + NODE_RADIUS;
                const x2 = LEFT_PAD + child.x * COLUMN_PX;
                const y2 = TOP_PAD + child.depth * ROW_PX - NODE_RADIUS;
                const isOnChain =
                  highlightedChain.has(edge.parent) && highlightedChain.has(edge.child);
                const stroke = isOnChain
                  ? '#3b82f6'
                  : edge.isStatic
                    ? 'rgba(148, 163, 184, 0.55)'
                    : 'rgba(255,255,255,0.18)';
                return (
                  <g key={`${edge.parent}>${edge.child}`}>
                    <path
                      d={curvedPath(x1, y1, x2, y2)}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={isOnChain ? 2 : 1.25}
                      strokeDasharray={edge.isStatic ? '4,4' : undefined}
                    />
                  </g>
                );
              })}

              {/* Nodes. */}
              {Array.from(layout.nodes.values()).map((node) => {
                const cx = LEFT_PAD + node.x * COLUMN_PX;
                const cy = TOP_PAD + node.depth * ROW_PX;
                const isSelected = node.frame === effectiveSelected;
                const isOnChain = highlightedChain.has(node.frame);
                return (
                  <g
                    key={node.frame}
                    onClick={() => setSelected(node.frame)}
                    className="cursor-pointer"
                  >
                    <circle
                      cx={cx}
                      cy={cy}
                      r={NODE_RADIUS}
                      fill={isSelected ? '#3b82f6' : '#111827'}
                      stroke={isSelected ? '#bfdbfe' : isOnChain ? '#3b82f6' : 'rgba(255,255,255,0.18)'}
                      strokeWidth={isSelected ? 2 : 1.5}
                    />
                    {/* Frame label below the node. */}
                    <text
                      x={cx}
                      y={cy + NODE_RADIUS + 14}
                      textAnchor="middle"
                      fontSize={11}
                      fill={isSelected ? '#f1f5f9' : '#cbd5e1'}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {truncate(node.frame, 18)}
                    </text>
                    {/* Tiny depth indicator inside the node. */}
                    <text
                      x={cx}
                      y={cy + 4}
                      textAnchor="middle"
                      fontSize={11}
                      fontWeight={600}
                      fill={isSelected ? '#0c1020' : '#94a3b8'}
                      fontFamily="JetBrains Mono, monospace"
                    >
                      {node.depth === 0 ? 'root' : `L${node.depth}`}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <FrameSidebar
            graph={graph}
            selected={effectiveSelected}
            onSelect={setSelected}
            transform={selectedTransform}
            startNs={startNs}
            playheadNs={playheadNs}
          />
        </div>
      )}
    </PanelShell>
  );
}

interface FrameSidebarProps {
  graph: TFGraph;
  selected: string | null;
  onSelect: (frame: string) => void;
  transform: {
    parent: string;
    child: string;
    sample: { t: bigint; translation: { x: number; y: number; z: number }; rotation: Quat };
    isStatic: boolean;
  } | null;
  startNs: bigint;
  playheadNs: bigint;
}

function FrameSidebar({
  graph,
  selected,
  onSelect,
  transform,
  startNs,
  playheadNs,
}: FrameSidebarProps) {
  const allFrames = useMemo(() => Array.from(graph.frames).sort(), [graph]);
  const [filter, setFilter] = useState('');
  const filteredFrames = useMemo(() => {
    if (!filter.trim()) return allFrames;
    const q = filter.toLowerCase();
    return allFrames.filter((f) => f.toLowerCase().includes(q));
  }, [allFrames, filter]);

  return (
    <aside className="w-72 flex-shrink-0 border-l border-border bg-bg-secondary/60 flex flex-col min-h-0">
      <div className="px-3 pt-3 pb-2 border-b border-border">
        <div className="text-text-tertiary text-[10px] mono uppercase tracking-wider mb-1">
          {graph.frames.size} frame{graph.frames.size === 1 ? '' : 's'} · {graph.roots.length}{' '}
          root{graph.roots.length === 1 ? '' : 's'}
        </div>
        <input
          type="text"
          placeholder="Filter frames…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full px-2.5 py-1.5 rounded-md bg-surface border border-border text-text-primary placeholder:text-text-muted text-xs mono focus:outline-none focus:border-accent-blue/50 focus:ring-1 focus:ring-accent-blue/20 transition-all"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-1 py-1 min-h-0">
        {filteredFrames.map((frame) => {
          const isSel = frame === selected;
          const childCount = (graph.children.get(frame) ?? []).length;
          return (
            <button
              key={frame}
              onClick={() => onSelect(frame)}
              className={`w-full text-left px-3 py-1.5 mono text-xs rounded-md transition-colors flex items-center justify-between gap-2 ${
                isSel
                  ? 'bg-accent-blue/15 text-accent-blue'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }`}
              title={frame}
            >
              <span className="truncate">{frame}</span>
              {childCount > 0 && (
                <span className="text-text-tertiary text-[10px] flex-shrink-0">
                  {childCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="border-t border-border p-3 text-xs space-y-2 mono">
          <div className="text-text-primary font-medium">{selected}</div>
          {transform ? (
            <>
              <div className="text-text-tertiary">
                from <span className="text-text-secondary">{transform.parent}</span>
                {transform.isStatic && (
                  <span className="badge badge-slate ml-2">static</span>
                )}
              </div>
              <div>
                <div className="text-text-tertiary text-[10px]">translation</div>
                <Vec3Row label="x" value={transform.sample.translation.x} />
                <Vec3Row label="y" value={transform.sample.translation.y} />
                <Vec3Row label="z" value={transform.sample.translation.z} />
              </div>
              <div>
                <div className="text-text-tertiary text-[10px]">rotation (quat)</div>
                <Vec3Row label="x" value={transform.sample.rotation.x} />
                <Vec3Row label="y" value={transform.sample.rotation.y} />
                <Vec3Row label="z" value={transform.sample.rotation.z} />
                <Vec3Row label="w" value={transform.sample.rotation.w} />
              </div>
              <div>
                <div className="text-text-tertiary text-[10px]">rotation (euler °)</div>
                {(() => {
                  const e = quatToEuler(transform.sample.rotation);
                  return (
                    <>
                      <Vec3Row label="roll" value={(e.roll * 180) / Math.PI} />
                      <Vec3Row label="pitch" value={(e.pitch * 180) / Math.PI} />
                      <Vec3Row label="yaw" value={(e.yaw * 180) / Math.PI} />
                    </>
                  );
                })()}
              </div>
              <div className="text-text-tertiary text-[10px] pt-1 border-t border-border">
                sample t = {nsToSeconds(transform.sample.t - startNs).toFixed(3)}s
                {transform.sample.t !== playheadNs && (
                  <span className="text-text-muted ml-2">(nearest to playhead)</span>
                )}
              </div>
            </>
          ) : (
            <div className="text-text-muted">
              No transform recorded for this frame — it's a root in the graph.
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

function Vec3Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-text-tertiary w-12">{label}</span>
      <span className="text-text-primary tabular-nums">
        {Number.isFinite(value) ? value.toFixed(4) : '—'}
      </span>
    </div>
  );
}

/** Tree layout: subtree-width recursive packing, top-down by depth. */
function layoutTree(graph: TFGraph): TreeLayout {
  const nodes = new Map<string, LayoutNode>();
  let maxDepth = 0;
  let cursor = 0;

  function visit(frame: string, depth: number, leftEdge: number, seen: Set<string>): number {
    if (seen.has(frame)) {
      // Cycle guard (shouldn't happen in a valid TF graph but defend anyway).
      nodes.set(frame, { frame, depth, x: leftEdge, width: 1 });
      return 1;
    }
    seen.add(frame);
    if (depth > maxDepth) maxDepth = depth;
    const children = graph.children.get(frame) ?? [];
    if (children.length === 0) {
      nodes.set(frame, { frame, depth, x: leftEdge, width: 1 });
      return 1;
    }
    let totalWidth = 0;
    let childLeft = leftEdge;
    for (const child of children) {
      const w = visit(child, depth + 1, childLeft, seen);
      childLeft += w;
      totalWidth += w;
    }
    const x = leftEdge + (totalWidth - 1) / 2;
    nodes.set(frame, { frame, depth, x, width: totalWidth });
    return totalWidth;
  }

  // Lay each root tree out left-to-right.
  for (const root of graph.roots) {
    const w = visit(root, 0, cursor, new Set());
    cursor += w + 0.5; // small gap between root subtrees
  }

  // Place any orphaned frames (parents that never appeared as a child but
  // also weren't seen via visit because they share a chain) just in case.
  for (const frame of graph.frames) {
    if (!nodes.has(frame)) {
      nodes.set(frame, { frame, depth: 0, x: cursor, width: 1 });
      cursor += 1;
    }
  }

  return { nodes, totalWidth: cursor, maxDepth };
}

function curvedPath(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function quatToEuler(q: Quat): { roll: number; pitch: number; yaw: number } {
  const sinr_cosp = 2 * (q.w * q.x + q.y * q.z);
  const cosr_cosp = 1 - 2 * (q.x * q.x + q.y * q.y);
  const roll = Math.atan2(sinr_cosp, cosr_cosp);

  const sinp = 2 * (q.w * q.y - q.z * q.x);
  const pitch =
    Math.abs(sinp) >= 1 ? (Math.sign(sinp) * Math.PI) / 2 : Math.asin(sinp);

  const siny_cosp = 2 * (q.w * q.z + q.x * q.y);
  const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
  const yaw = Math.atan2(siny_cosp, cosy_cosp);

  return { roll, pitch, yaw };
}

function Loading({ progress }: { progress: { tf: number; tf_static: number } }) {
  const total = progress.tf + progress.tf_static;
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
      <span className="text-text-secondary text-sm">
        {total > 0 ? `Decoded ${total.toLocaleString()} TF messages…` : 'Loading TF data…'}
      </span>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="text-accent-rose text-sm font-medium">Failed to load TF data</div>
      <div className="text-text-secondary text-xs max-w-md">{message}</div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-text-muted text-sm p-8">
      {message}
    </div>
  );
}
