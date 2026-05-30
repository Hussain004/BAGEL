import { useEffect, useRef } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useBagStore } from './store/bagStore';
import { useLayoutStore } from './store/layoutStore';
import { DropZone } from './components/layout/DropZone';
import { Toolbar } from './components/layout/Toolbar';
import { Timeline } from './components/layout/Timeline';
import { PanelGrid } from './components/layout/PanelGrid';
import { TopicInspector } from './components/panels/TopicInspector';
import { ModalHost } from './components/modals/ModalHost';
import { clearTopicMessageCache } from './hooks/useTopicMessages';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useUrlState } from './hooks/useUrlState';
import { useCustomSchemaSync } from './hooks/useCustomSchemaSync';
import { formatDuration } from './utils/time';
import type { BagSummary } from './types/bag';

/**
 * Root Application Component.
 *
 * - No bag → DropZone landing page.
 * - Bag loaded → Toolbar + Sidebar + PanelGrid + Timeline.
 *
 * Global cross-cutting hooks (keyboard shortcuts, URL hash sync) live here
 * so they survive bag changes and are torn down only when the app unmounts.
 */
export default function App() {
  const bag = useBagStore((s) => s.bag);
  const closeAllPanels = useLayoutStore((s) => s.closeAllPanels);

  // Global shortcuts (Space/Arrows/T/O/Esc/?/A) + URL hash sync + sync
  // user-supplied `.msg` schemas into the parser worker on boot and edits.
  useKeyboardShortcuts();
  useUrlState();
  useCustomSchemaSync();

  // v0.8: when a *different* bag was loaded (single-bag flow), drop any
  // panels + cached messages from the previous one. Multi-bag (v0.9) skips
  // this: adding a second bag must not wipe panels from the first one.
  // We continue to fire when the user goes back to zero bags (clearAll)
  // since at that point there's nothing meaningful to render.
  const lastBagKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = bag ? `${bag.fileName}::${bag.fileSize}` : null;
    if (lastBagKeyRef.current !== null && lastBagKeyRef.current !== key && !bag) {
      closeAllPanels();
      clearTopicMessageCache();
    }
    lastBagKeyRef.current = key;
  }, [bag?.fileName, bag?.fileSize, bag, closeAllPanels]);

  return (
    <>
      {!bag ? (
        <DropZone />
      ) : (
        <div className="h-screen flex flex-col overflow-hidden bg-bg-primary">
          <Toolbar />
          <MainView />
          <Timeline />
        </div>
      )}
      <ModalHost />
    </>
  );
}

function MainView() {
  const bag = useBagStore((s) => s.bag);
  const hasPanels = useLayoutStore((s) => s.root !== null);
  if (!bag) return null;

  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <Group orientation="horizontal" className="h-full w-full flex">
        <Panel
          defaultSize="28%"
          minSize="18%"
          maxSize="50%"
          className="border-r border-border bg-bg-secondary/50 flex flex-col min-h-0 min-w-0"
        >
          <TopicInspector />
        </Panel>
        <Separator className="group relative w-1.5 cursor-col-resize flex-shrink-0">
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover:bg-accent-blue/60 transition-colors" />
        </Separator>
        <Panel className="flex flex-col min-h-0 min-w-0">
          {hasPanels ? (
            <PanelGrid />
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 bg-grid bg-gradient-radial">
              <EmptyPanelState bag={bag} />
            </div>
          )}
        </Panel>
      </Group>
    </div>
  );
}

function EmptyPanelState({ bag }: { bag: BagSummary }) {
  const activeTopics = bag.topics.filter((t) => t.messageCount > 0);
  const typeCategories = new Set(activeTopics.map((t) => t.type.split('/')[0]));

  return (
    <div className="text-center max-w-md animate-fade-in-up">
      <div className="mx-auto w-16 h-16 rounded-2xl bg-accent-emerald/10 flex items-center justify-center mb-6">
        <svg
          className="w-9 h-9 text-accent-emerald"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            clipRule="evenodd"
            d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53-1.715-1.715a.75.75 0 10-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.84-5.16z"
          />
        </svg>
      </div>

      <h2 className="text-xl font-semibold text-text-primary mb-2">Bag file loaded</h2>
      <p className="text-text-secondary text-sm mb-6">{bag.fileName}</p>

      <div className="grid grid-cols-2 gap-3 mb-8">
        <SummaryCard label="Duration" value={formatDuration(bag.duration)} color="blue" />
        <SummaryCard
          label="Total Messages"
          value={bag.totalMessageCount.toLocaleString()}
          color="cyan"
        />
        <SummaryCard label="Active Topics" value={`${activeTopics.length}`} color="violet" />
        <SummaryCard label="Type Categories" value={`${typeCategories.size}`} color="emerald" />
      </div>

      <p className="text-text-muted text-sm">
        Click any topic on the left to open a visualization panel.
      </p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: 'blue' | 'cyan' | 'violet' | 'emerald';
}) {
  const colorClasses = {
    blue: 'border-accent-blue/20 bg-accent-blue/5',
    cyan: 'border-accent-cyan/20 bg-accent-cyan/5',
    violet: 'border-accent-violet/20 bg-accent-violet/5',
    emerald: 'border-accent-emerald/20 bg-accent-emerald/5',
  };

  return (
    <div className={`rounded-xl border p-4 ${colorClasses[color]} transition-all hover:scale-[1.02]`}>
      <p className="text-text-primary text-xl font-bold mono">{value}</p>
      <p className="text-text-muted text-xs mt-1">{label}</p>
    </div>
  );
}
