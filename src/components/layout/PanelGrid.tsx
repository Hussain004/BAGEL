import { Fragment, Suspense, useState } from 'react';
import { useCompactLayout } from '../../hooks/useCompactLayout';
import { KIND_PALETTE_LABEL } from '../../utils/panelOptions';
import { PANEL_COMPONENTS } from '../panels/registry';
import { Group, Panel, Separator } from 'react-resizable-panels';
import {
  useLayoutStore,
  findPanel,
  getAllPanels,
  type DropEdge,
  type LayoutNode,
  type PanelLeaf,
  type SplitNode,
  type SplitOrientation,
} from '../../store/layoutStore';
import { useDragDockStore } from '../../store/dragDockStore';

/**
 * PanelGrid - Recursive renderer for the layout tree.
 *
 * Each `SplitNode` becomes a `<Group orientation>` with its children mapped
 * to `<Panel>` wrappers (separated by `<ResizeHandle>` between adjacent
 * siblings). Each `PanelLeaf` renders the relevant visualisation panel and
 * sits underneath a `<DropZoneOverlay>` that surfaces drop targets during a
 * drag-to-dock operation.
 *
 * Panel `id` props match the layout-node ids, so `react-resizable-panels`
 * can reconcile across tree edits without remounting unrelated subtrees.
 * (Pre-v0.7 this file forced a remount of the whole layout via a `key` on
 * the top-level `<Group>`; that broke any local component state in the
 * panels - see commit history for the 3D-display-state-reset fix.)
 */
export function PanelGrid() {
  const root = useLayoutStore((s) => s.root);
  const maximizedId = useLayoutStore((s) => s.maximizedId);
  const compact = useCompactLayout();
  if (!root) return null;
  if (compact) return <CompactStack root={root} />;
  // Maximized view: render just that one leaf full-grid. The split tree
  // underneath is untouched, so restoring goes straight back to it. Falls
  // through to the normal tree if the maximized id no longer exists (panel
  // closed while maximized).
  const maximizedLeaf = maximizedId ? findPanel(root, maximizedId) : null;
  return (
    <div className="flex-1 flex p-3 overflow-hidden min-w-0">
      <div className="flex-1 flex w-full h-full min-w-0">
        {maximizedLeaf ? <PanelLeafContent leaf={maximizedLeaf} /> : renderTree(root)}
      </div>
    </div>
  );
}

/**
 * Phone and upright-tablet layout: every open panel is a tab and exactly one
 * is shown, full size. The split tree is untouched underneath, so rotating to
 * landscape brings the arrangement straight back.
 *
 * A panel opened while in this view becomes the visible one (the count of
 * panels changing makes an earlier pick stale), which is what "tap a topic to
 * see it" should do. No swipe gesture on the content: it would fight the
 * pan and orbit gestures of the plot and 3D panels, so switching is by tab.
 */
function CompactStack({ root }: { root: LayoutNode }) {
  const leaves = getAllPanels(root);
  const [picked, setPicked] = useState<{ id: string; count: number } | null>(null);
  const valid = picked && picked.count === leaves.length ? leaves.find((l) => l.id === picked.id) : undefined;
  const active = valid ?? leaves[leaves.length - 1];
  if (!active) return null;
  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0 p-2 gap-2">
      <div role="tablist" aria-label="Open panels" className="flex gap-1.5 overflow-x-auto flex-shrink-0 pb-0.5" data-testid="compact-tabs">
        {leaves.map((leaf) => {
          const selected = leaf.id === active.id;
          const topic = leaf.topicName.split('/').filter(Boolean).pop() || leaf.topicName;
          return (
            <button
              key={leaf.id}
              type="button"
              ref={(el) => {
                // Keep the visible panel's tab in view when the strip is wider than the screen.
                if (selected) el?.scrollIntoView?.({ inline: 'center', block: 'nearest' });
              }}
              role="tab"
              aria-selected={selected}
              onClick={() => setPicked({ id: leaf.id, count: leaves.length })}
              className={`flex-shrink-0 min-h-11 px-3 rounded-md text-xs mono border whitespace-nowrap transition-colors ${
                selected
                  ? 'bg-accent-blue/15 border-accent-blue/50 text-accent-blue'
                  : 'bg-surface/80 border-border text-text-secondary'
              }`}
            >
              {KIND_PALETTE_LABEL[leaf.kind]}
              {topic ? ` · ${topic}` : ''}
            </button>
          );
        })}
      </div>
      <div className="flex-1 flex min-h-0 min-w-0" role="tabpanel">
        <PanelLeafContent key={active.id} leaf={active} />
      </div>
    </div>
  );
}

function renderTree(node: LayoutNode) {
  return node.node === 'panel' ? (
    <PanelLeafContent leaf={node} />
  ) : (
    <SplitGroup node={node} />
  );
}

function SplitGroup({ node }: { node: SplitNode }) {
  const orientation = node.orientation;
  // Equal split on creation; users can drag the handles to redistribute.
  // Sizes don't persist across docking - that would require encoding them
  // in the tree, which we skipped for v1.
  //
  // Percent-strings (not bare numbers) because react-resizable-panels v4
  // treats unitless numbers as pixels - see App.tsx where the sidebar
  // uses the same `defaultSize="28%"` form.
  const defaultSize = `${100 / node.children.length}%`;
  return (
    <Group
      orientation={orientation}
      className="flex-1 flex w-full h-full min-w-0"
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <ResizeHandle orientation={orientation} />}
          <Panel
            id={child.id}
            minSize="15%"
            defaultSize={defaultSize}
            className="flex flex-col min-w-0 min-h-0"
          >
            {renderTree(child)}
          </Panel>
        </Fragment>
      ))}
    </Group>
  );
}

function PanelLeafContent({ leaf }: { leaf: PanelLeaf }) {
  // min-w-0 is critical here: when there's only one panel open, the
  // root layout node IS this leaf (no SplitGroup wraps it, so there's
  // no react-resizable-panels <Panel> enforcing a width). Without
  // min-w-0 a canvas inside the panel (e.g. uPlot) sets the
  // min-content width of every flex ancestor - combined with uPlot's
  // ResizeObserver reading clientWidth and feeding it back into
  // setSize, the chart grows on every measurement and the plot
  // "keeps extending to the right" until a sibling is added (which
  // wraps both panels in width-bounded <Panel> nodes).
  // First-drag-ever dim: while the very first drag of the session is in
  // flight, every panel except the one being dragged fades slightly so the
  // drop-target edges (highlighted by DropZoneOverlay) read as "places you
  // can drop this", not just decoration. Only fires once per session -
  // once the user has done it, they know, and repeated dimming on every
  // subsequent drag would just be noise for someone rearranging a lot.
  const sourceId = useDragDockStore((s) => s.sourceId);
  const hasDraggedOnce = useDragDockStore((s) => s.hasDraggedOnce);
  const dimForFirstDrag = sourceId !== null && sourceId !== leaf.id && !hasDraggedOnce;
  return (
    <div
      className={`relative flex-1 flex flex-col min-h-0 min-w-0 transition-opacity ${dimForFirstDrag ? 'opacity-50' : ''}`}
    >
      <Visualisation leaf={leaf} />
      <DropZoneOverlay panelId={leaf.id} />
    </div>
  );
}

/** Dispatch from leaf.kind to the actual visualisation component. */
function Visualisation({ leaf }: { leaf: PanelLeaf }) {
  const props = {
    panelId: leaf.id,
    topicName: leaf.topicName,
    type: leaf.type,
    bagId: leaf.bagId,
  };
  const Component = PANEL_COMPONENTS[leaf.kind];
  return (
    <Suspense fallback={<div className="flex-1 flex items-center justify-center text-text-muted text-xs">Loading...</div>}>
      <Component {...props} />
    </Suspense>
  );
}

function ResizeHandle({ orientation }: { orientation: SplitOrientation }) {
  const isH = orientation === 'horizontal';
  return (
    <Separator
      className={`group relative flex items-center justify-center flex-shrink-0 ${
        isH ? 'w-1.5 mx-0.5 cursor-col-resize' : 'h-1.5 my-0.5 cursor-row-resize'
      }`}
    >
      <div
        className={`absolute bg-border group-hover:bg-accent-blue/60 transition-colors ${
          isH
            ? 'inset-y-2 left-1/2 -translate-x-1/2 w-px'
            : 'inset-x-2 top-1/2 -translate-y-1/2 h-px'
        }`}
      />
      <div
        className={`relative z-10 rounded-full bg-surface/0 group-hover:bg-surface/80 border border-transparent group-hover:border-border-hover flex items-center justify-center transition-[background-color,border-color,opacity] opacity-0 group-hover:opacity-100 ${
          isH ? 'w-4 h-10' : 'h-4 w-10'
        }`}
      >
        <svg className="w-3 h-3 text-text-muted" viewBox="0 0 24 24" fill="currentColor">
          {isH ? (
            <>
              <circle cx="9" cy="7" r="1.4" />
              <circle cx="9" cy="12" r="1.4" />
              <circle cx="9" cy="17" r="1.4" />
              <circle cx="15" cy="7" r="1.4" />
              <circle cx="15" cy="12" r="1.4" />
              <circle cx="15" cy="17" r="1.4" />
            </>
          ) : (
            <>
              <circle cx="7" cy="9" r="1.4" />
              <circle cx="12" cy="9" r="1.4" />
              <circle cx="17" cy="9" r="1.4" />
              <circle cx="7" cy="15" r="1.4" />
              <circle cx="12" cy="15" r="1.4" />
              <circle cx="17" cy="15" r="1.4" />
            </>
          )}
        </svg>
      </div>
    </Separator>
  );
}

/**
 * Pointer-event overlay that turns each leaf panel into a drop target while
 * a drag is in flight.
 *
 * Layout: four edge strips (top / bottom 25% × full width; left / right 25%
 * × middle 50% height). The centre ~50% is unhandled - a release there
 * falls through to the global `pointerup` handler in `PanelShell` and
 * cancels the drag, matching the Foxglove / VSCode convention that
 * dropping on the panel body itself does nothing.
 *
 * On hover, we overlay a half-panel highlight showing where the source
 * will land after `dockPanel(...)`. The overlay is unmounted entirely when
 * no drag is active or when the overlay sits on the drag's own source
 * panel (you can't dock a panel onto itself).
 */
function DropZoneOverlay({ panelId }: { panelId: string }) {
  const sourceId = useDragDockStore((s) => s.sourceId);
  const dockPanel = useLayoutStore((s) => s.dockPanel);
  const endDrag = useDragDockStore((s) => s.endDrag);
  const markDropped = useDragDockStore((s) => s.markDropped);
  const [hovered, setHovered] = useState<DropEdge | null>(null);

  if (sourceId === null || sourceId === panelId) return null;

  const drop = (edge: DropEdge) => {
    dockPanel(sourceId, panelId, edge);
    // Confirmation pulse on the panel that just landed - distinct from a
    // cancelled drag (released over the centre), which calls endDrag()
    // directly from PanelShell without ever reaching here.
    markDropped(sourceId);
    endDrag();
    setHovered(null);
  };

  return (
    <div className="absolute inset-0 z-30 pointer-events-none">
      {hovered && <DropIndicator edge={hovered} />}
      {(['top', 'bottom', 'left', 'right'] as const).map((edge) => (
        <DropZone
          key={edge}
          edge={edge}
          onEnter={() => setHovered(edge)}
          onLeave={() => setHovered((h) => (h === edge ? null : h))}
          onUp={() => drop(edge)}
        />
      ))}
    </div>
  );
}

const ZONE_CLASSES: Record<DropEdge, string> = {
  top: 'top-0 left-0 right-0 h-1/4',
  bottom: 'bottom-0 left-0 right-0 h-1/4',
  left: 'top-1/4 bottom-1/4 left-0 w-1/4',
  right: 'top-1/4 bottom-1/4 right-0 w-1/4',
};

const INDICATOR_CLASSES: Record<DropEdge, string> = {
  top: 'top-0 left-0 right-0 h-1/2',
  bottom: 'bottom-0 left-0 right-0 h-1/2',
  left: 'top-0 bottom-0 left-0 w-1/2',
  right: 'top-0 bottom-0 right-0 w-1/2',
};

function DropZone({
  edge,
  onEnter,
  onLeave,
  onUp,
}: {
  edge: DropEdge;
  onEnter: () => void;
  onLeave: () => void;
  onUp: () => void;
}) {
  return (
    <div
      className={`absolute ${ZONE_CLASSES[edge]} pointer-events-auto`}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onPointerUp={onUp}
    />
  );
}

function DropIndicator({ edge }: { edge: DropEdge }) {
  return (
    <div
      className={`absolute ${INDICATOR_CLASSES[edge]} bg-accent-blue/25 border-2 border-accent-blue/80 rounded-md pointer-events-none transition-colors`}
    />
  );
}
