import { Group, Panel, Separator } from 'react-resizable-panels';
import { useLayoutStore, type PanelInstance } from '../../store/layoutStore';
import { TimeSeriesPlot } from '../panels/TimeSeriesPlot';
import { ImageViewer } from '../panels/ImageViewer';
import { RawMessageInspector } from '../panels/RawMessageInspector';

/**
 * PanelGrid — Resizable layout for the open visualization panels.
 *
 * - 1 panel: fills the whole content area.
 * - 2+ panels: side-by-side in a horizontal Group with drag handles
 *   (Separator components) between each pair. Each panel can shrink to ~15%
 *   and grow to take the row. Layouts reset on close+reopen.
 */
export function PanelGrid() {
  const panels = useLayoutStore((s) => s.panels);

  if (panels.length === 0) return null;

  if (panels.length === 1) {
    return (
      <div className="flex-1 flex p-3 overflow-hidden bg-grid bg-gradient-radial min-w-0">
        <div className="flex-1 flex min-w-0 min-h-0">{renderPanel(panels[0])}</div>
      </div>
    );
  }

  // Equal initial sizes for the open panels — pass as a percent STRING since
  // bare numbers are treated as pixels in react-resizable-panels v4.
  const initialSize = `${100 / panels.length}%`;
  // Recompute layout key whenever the set of open panels changes so the
  // Group re-measures on every open/close.
  const groupKey = panels.map((p) => p.id).join('|');

  return (
    <div className="flex-1 flex p-3 overflow-hidden bg-grid bg-gradient-radial min-w-0">
      <Group key={groupKey} orientation="horizontal" className="flex-1 flex w-full h-full min-w-0">
        {panels.map((p, i) => (
          <PanelFragment
            key={p.id}
            panel={p}
            initialSize={initialSize}
            isLast={i === panels.length - 1}
          />
        ))}
      </Group>
    </div>
  );
}

function PanelFragment({
  panel,
  initialSize,
  isLast,
}: {
  panel: PanelInstance;
  initialSize: string;
  isLast: boolean;
}) {
  return (
    <>
      <Panel defaultSize={initialSize} minSize="15%" className="flex flex-col min-w-0 min-h-0">
        {renderPanel(panel)}
      </Panel>
      {!isLast && <ResizeHandle />}
    </>
  );
}

function ResizeHandle() {
  return (
    <Separator className="group relative w-1.5 mx-0.5 flex items-center justify-center cursor-col-resize">
      <div className="absolute inset-y-2 left-1/2 -translate-x-1/2 w-px bg-border group-hover:bg-accent-blue/60 transition-colors" />
      <div className="relative z-10 w-4 h-10 rounded-full bg-surface/0 group-hover:bg-surface/80 border border-transparent group-hover:border-border-hover flex items-center justify-center transition-all opacity-0 group-hover:opacity-100">
        <svg className="w-3 h-3 text-text-muted" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="7" r="1.4" />
          <circle cx="9" cy="12" r="1.4" />
          <circle cx="9" cy="17" r="1.4" />
          <circle cx="15" cy="7" r="1.4" />
          <circle cx="15" cy="12" r="1.4" />
          <circle cx="15" cy="17" r="1.4" />
        </svg>
      </div>
    </Separator>
  );
}

function renderPanel(p: PanelInstance) {
  switch (p.kind) {
    case 'plot':
      return <TimeSeriesPlot panelId={p.id} topicName={p.topicName} type={p.type} />;
    case 'image':
      return <ImageViewer panelId={p.id} topicName={p.topicName} type={p.type} />;
    case 'raw':
      return <RawMessageInspector panelId={p.id} topicName={p.topicName} type={p.type} />;
  }
}
