import { useLayoutStore } from '../../store/layoutStore';
import { TimeSeriesPlot } from '../panels/TimeSeriesPlot';
import { ImageViewer } from '../panels/ImageViewer';
import { RawMessageInspector } from '../panels/RawMessageInspector';

/**
 * PanelGrid — Tiles every open panel in the main view.
 *
 * Layout strategy: single column up to 2 panels, then a 2-column grid that
 * scrolls vertically. Resizable/dockable panels are deferred to v0.3.
 */
export function PanelGrid() {
  const panels = useLayoutStore((s) => s.panels);

  if (panels.length === 0) return null;

  return (
    <div
      className={`flex-1 grid gap-3 p-3 overflow-auto bg-grid bg-gradient-radial ${
        panels.length === 1
          ? 'grid-cols-1'
          : 'grid-cols-1 lg:grid-cols-2 auto-rows-[minmax(360px,1fr)]'
      }`}
    >
      {panels.map((p) => (
        <div key={p.id} className="min-h-[360px] flex flex-col">
          {p.kind === 'plot' && (
            <TimeSeriesPlot panelId={p.id} topicName={p.topicName} type={p.type} />
          )}
          {p.kind === 'image' && (
            <ImageViewer panelId={p.id} topicName={p.topicName} type={p.type} />
          )}
          {p.kind === 'raw' && (
            <RawMessageInspector panelId={p.id} topicName={p.topicName} type={p.type} />
          )}
        </div>
      ))}
    </div>
  );
}
