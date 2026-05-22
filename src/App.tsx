import { useBagStore } from './store/bagStore';
import { DropZone } from './components/layout/DropZone';
import { Toolbar } from './components/layout/Toolbar';
import { TopicInspector } from './components/panels/TopicInspector';
import { formatDuration } from './utils/time';
import { formatFileSize } from './utils/bytes';
import type { BagSummary } from './types/bag';

/**
 * Root Application Component
 *
 * Conditionally renders the DropZone (no bag loaded) or the
 * main exploration view (bag loaded).
 */
export default function App() {
  const { bag } = useBagStore();

  if (!bag) {
    return <DropZone />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg-primary">
      <Toolbar />
      <MainView />
    </div>
  );
}

/**
 * Main exploration view after a bag is loaded.
 * Currently shows the TopicInspector with bag summary stats.
 */
function MainView() {
  const { bag } = useBagStore();
  if (!bag) return null;

  return (
    <div className="flex-1 flex min-h-0">
      {/* Sidebar */}
      <aside className="w-[420px] border-r border-border flex flex-col min-h-0 bg-bg-secondary/50">
        <TopicInspector />
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center p-8 bg-grid bg-gradient-radial">
        <EmptyPanelState bag={bag} />
      </main>
    </div>
  );
}

/**
 * Placeholder for when no panel is selected.
 * Shows bag summary info and a hint to select a topic.
 */
function EmptyPanelState({ bag }: { bag: BagSummary }) {
  const activeTopics = bag.topics.filter((t) => t.messageCount > 0);
  const typeCategories = new Set(activeTopics.map((t) => t.type.split('/')[0]));

  return (
    <div className="text-center max-w-md animate-fade-in-up">
      {/* Success checkmark */}
      <div className="mx-auto w-16 h-16 rounded-2xl bg-accent-emerald/10 flex items-center justify-center mb-6">
        <svg className="w-8 h-8 text-accent-emerald" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>

      <h2 className="text-xl font-semibold text-text-primary mb-2">
        Bag file loaded successfully
      </h2>
      <p className="text-text-secondary text-sm mb-6">
        {bag.fileName}
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-8">
        <SummaryCard
          label="Duration"
          value={formatDuration(bag.duration)}
          color="blue"
        />
        <SummaryCard
          label="Total Messages"
          value={bag.totalMessageCount.toLocaleString()}
          color="cyan"
        />
        <SummaryCard
          label="Active Topics"
          value={`${activeTopics.length}`}
          color="violet"
        />
        <SummaryCard
          label="Type Categories"
          value={`${typeCategories.size}`}
          color="emerald"
        />
      </div>

      {/* Hint */}
      <div className="flex items-center justify-center gap-2 text-text-muted text-sm">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
        <span>Visualization panels coming in v0.2</span>
      </div>
    </div>
  );
}

/** Summary stat card */
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
