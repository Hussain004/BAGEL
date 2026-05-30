import { Fragment, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import {
  useLayoutStore,
  type DropEdge,
  type LayoutNode,
  type PanelLeaf,
  type SplitNode,
  type SplitOrientation,
} from '../../store/layoutStore';
import { useDragDockStore } from '../../store/dragDockStore';
import { TimeSeriesPlot } from '../panels/TimeSeriesPlot';
import { ImageViewer } from '../panels/ImageViewer';
import { RawMessageInspector } from '../panels/RawMessageInspector';
import { TrajectoryPlot } from '../panels/TrajectoryPlot';
import { TFTree } from '../panels/TFTree';
import { ThreeDScene } from '../panels/ThreeDScene';

/**
 * PanelGrid — Recursive renderer for the layout tree.
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
 * panels — see commit history for the 3D-display-state-reset fix.)
 */
export function PanelGrid() {
  const root = useLayoutStore((s) => s.root);
  if (!root) return null;
  return (
    <div className="flex-1 flex p-3 overflow-hidden bg-grid bg-gradient-radial min-w-0">
      <div className="flex-1 flex w-full h-full min-w-0">{renderTree(root)}</div>
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
  // Sizes don't persist across docking — that would require encoding them
  // in the tree, which we skipped for v1.
  //
  // Percent-strings (not bare numbers) because react-resizable-panels v4
  // treats unitless numbers as pixels — see App.tsx where the sidebar
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
  // min-content width of every flex ancestor — combined with uPlot's
  // ResizeObserver reading clientWidth and feeding it back into
  // setSize, the chart grows on every measurement and the plot
  // "keeps extending to the right" until a sibling is added (which
  // wraps both panels in width-bounded <Panel> nodes).
  return (
    <div className="relative flex-1 flex flex-col min-h-0 min-w-0">
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
  switch (leaf.kind) {
    case 'plot':
      return <TimeSeriesPlot {...props} />;
    case 'image':
      return <ImageViewer {...props} />;
    case 'raw':
      return <RawMessageInspector {...props} />;
    case 'trajectory':
      return <TrajectoryPlot {...props} />;
    case 'tf':
      return <TFTree {...props} />;
    case '3d':
      return <ThreeDScene {...props} />;
  }
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
        className={`relative z-10 rounded-full bg-surface/0 group-hover:bg-surface/80 border border-transparent group-hover:border-border-hover flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 ${
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
 * × middle 50% height). The centre ~50% is unhandled — a release there
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
  const [hovered, setHovered] = useState<DropEdge | null>(null);

  if (sourceId === null || sourceId === panelId) return null;

  const drop = (edge: DropEdge) => {
    dockPanel(sourceId, panelId, edge);
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
      className={`absolute ${INDICATOR_CLASSES[edge]} bg-accent-blue/25 border-2 border-accent-blue/80 rounded-md pointer-events-none transition-all`}
    />
  );
}
