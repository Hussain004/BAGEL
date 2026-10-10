import { useEffect, useRef, useState, Component, type ReactNode } from 'react';
import { Group, Panel, Separator, type PanelImperativeHandle } from 'react-resizable-panels';
import { useBagStore } from './store/bagStore';
import { useLayoutStore } from './store/layoutStore';
import { useThemeStore, applyTheme } from './store/themeStore';
import { LandingPage } from './components/landing/LandingPage';
import { Toolbar } from './components/layout/Toolbar';
import { Timeline } from './components/layout/Timeline';
import { UndoToast } from './components/layout/UndoToast';
import { TourCard } from './components/layout/TourCard';
import { ControlCard } from './components/live/ControlCard';
import { startTourFromUrl } from './utils/tourRunner';
import { PanelGrid } from './components/layout/PanelGrid';
import { TopicInspector } from './components/panels/TopicInspector';
import { ModalHost } from './components/modals/ModalHost';
import { clearTopicMessageCache } from './hooks/useTopicMessages';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useUrlState } from './hooks/useUrlState';
import { useCompactLayout } from './hooks/useCompactLayout';
import { useCustomSchemaSync } from './hooks/useCustomSchemaSync';
import { useLivePlayhead } from './hooks/useLivePlayhead';
import { formatDuration } from './utils/time';
import { fullAppHash, pageEmbedConfig } from './utils/embedConfig';
import { usePlayheadStore } from './store/playheadStore';
import type { BagSummary } from './types/bag';

interface ErrorBoundaryState { error: Error | null }
class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): ErrorBoundaryState { return { error }; }
  render() {
    if (this.state.error) {
      // Theme utility classes (not hardcoded hex) so the crash screen stays
      // readable in both themes, matching every other full-page state.
      return (
        <div className="min-h-screen bg-bg-primary p-8 text-accent-rose mono">
          <h1 className="text-accent-amber text-lg font-semibold mb-4">BAGEL crashed - please report this</h1>
          <pre className="whitespace-pre-wrap break-all text-sm">
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Root Application Component.
 *
 * - No bag → landing page.
 * - Bag loaded → Toolbar + Sidebar + PanelGrid + Timeline.
 *
 * Global cross-cutting hooks (keyboard shortcuts, URL hash sync) live here
 * so they survive bag changes and are torn down only when the app unmounts.
 */
/**
 * A `#tour=<id or url>` link starts a guided tour. Read once at load: the hash is
 * rewritten as soon as a bag opens, so waiting for an effect would find it gone.
 */
const tourFromLink = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('tour');
let tourFromLinkStarted = false;

function AppInner() {
  const bag = useBagStore((s) => s.bag);
  const bagCount = useBagStore((s) => s.bags.size);
  const closeAllPanels = useLayoutStore((s) => s.closeAllPanels);

  // Global shortcuts (Space/Arrows/T/O/Esc/?/A) + URL hash sync + sync
  // user-supplied `.msg` schemas into the parser worker on boot and edits.
  useKeyboardShortcuts();
  useUrlState();
  useCustomSchemaSync();
  useEffect(() => {
    if (!tourFromLink || tourFromLinkStarted) return;
    tourFromLinkStarted = true;
    void startTourFromUrl(tourFromLink);
  }, []);
  // Keep the playhead range / cursor in sync with the live ring buffer.
  useLivePlayhead();

  // Apply the persisted (or system-preferred) theme to <html data-theme=…>
  // before the first paint, then keep it in sync as the user toggles.
  const theme = useThemeStore((s) => s.theme);
  const embedConfig = pageEmbedConfig();
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  // A host page can pin the theme to match itself. Set on the store (so the
  // charts and 3D clear colour follow) but NOT persisted: the iframe shares
  // localStorage with the viewer's own BAGEL, and a host's choice must not
  // overwrite the viewer's saved preference.
  useEffect(() => {
    if (embedConfig.embed && embedConfig.theme) useThemeStore.setState({ theme: embedConfig.theme });
  }, [embedConfig]);

  // Drop panels + cached messages that belonged to a bag that is no longer
  // part of the picture. The key change alone is not enough to decide:
  //   - going back to zero bags (clearAll) always cleans up, since there is
  //     nothing meaningful left to render;
  //   - a direct single-bag replace (one bag swapped for a different one
  //     with no zero-bag frame in between) cleans up the old bag's panels;
  //   - adding a second bag (v0.9 multi-bag), switching focus between bags,
  //     or removing one of several bags must NOT wipe the survivors' panels,
  //     so those are guarded by the previous bag count.
  const lastBagKeyRef = useRef<string | null>(null);
  const lastBagCountRef = useRef<number | null>(null);
  useEffect(() => {
    const key = bag ? `${bag.fileName}::${bag.fileSize}` : null;
    const prevKey = lastBagKeyRef.current;
    const prevCount = lastBagCountRef.current;
    const changed = prevKey !== null && prevKey !== key;
    const wentEmpty = key === null;
    const replacedSingle = key !== null && prevCount === 1 && bagCount <= 1;
    if (changed && (wentEmpty || replacedSingle)) {
      closeAllPanels();
      clearTopicMessageCache();
    }
    lastBagKeyRef.current = key;
    lastBagCountRef.current = bagCount;
  }, [bag, bagCount, closeAllPanels]);

  if (embedConfig.embed) return <EmbedApp />;

  return (
    <>
      {!bag ? (
        <LandingPage />
      ) : (
        <div className="h-screen flex flex-col overflow-hidden bg-bg-primary">
          <Toolbar />
          <MainView />
          <Timeline />
          <UndoToast />
        </div>
      )}
      <ModalHost />
      <TourCard />
      <ControlCard />
    </>
  );
}

/**
 * Embed mode (`#embed=1`): just the panels and a timeline, for an iframe on a
 * paper, dataset page or course. No toolbar, sidebar, modals or landing page,
 * and nothing that could leave a viewer stuck (panels cannot be closed, files
 * cannot be swapped). A corner link opens the same view in the full app.
 */
function EmbedApp() {
  const bag = useBagStore((s) => s.bag);
  const isLoading = useBagStore((s) => s.isLoading);
  const loadProgress = useBagStore((s) => s.loadProgress);
  const error = useBagStore((s) => s.error);
  const hasPanels = useLayoutStore((s) => s.root !== null);
  const config = pageEmbedConfig();

  // Autoplay / loop once the bag is ready. Keyed on the bag so a reload of the
  // same view does not restart a viewer who has paused.
  const startedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!bag) return;
    const key = `${bag.fileName}::${bag.fileSize}`;
    if (startedForRef.current === key) return;
    startedForRef.current = key;
    const playhead = usePlayheadStore.getState();
    if (config.loop) playhead.setLoop(true);
    if (config.autoplay) playhead.setPlaying(true);
  }, [bag, config.loop, config.autoplay]);

  const fullAppHref = `${window.location.origin}${window.location.pathname}#${fullAppHash(window.location.hash)}`;

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-bg-primary" data-testid="embed-root">
      {bag ? (
        <>
          <div className="flex-1 min-h-0 flex flex-col relative">
            {hasPanels ? (
              <PanelGrid />
            ) : (
              <div className="flex-1 flex items-center justify-center p-6 text-text-muted text-sm text-center">
                This link has no panels. Add a layout (p=) to the URL, or open it in BAGEL to explore {bag.fileName}.
              </div>
            )}
            <a
              href={fullAppHref}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-2 right-3 z-30 px-2 py-1 rounded-md text-[11px] mono border border-border bg-bg-primary/90 text-text-secondary hover:text-accent-blue hover:border-accent-blue/50 transition-colors shadow-panel"
              title="Open this view in the full BAGEL app"
            >
              Open in BAGEL
            </a>
          </div>
          <Timeline />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center p-6 text-center text-sm" role="status" aria-live="polite">
          {error ? (
            <div className="max-w-md">
              <div className="text-accent-rose font-medium mb-1">{error.title}</div>
              <div className="text-text-secondary">{error.detail}</div>
            </div>
          ) : isLoading ? (
            <div className="text-text-secondary">Loading recording… {Math.round(loadProgress)}%</div>
          ) : (
            <div className="text-text-muted max-w-sm">
              This embed has no recording to show. The link needs a bag URL (<span className="mono">b=</span>).
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

function MainView() {
  const bag = useBagStore((s) => s.bag);
  const hasPanels = useLayoutStore((s) => s.root !== null);
  const sidebarRef = useRef<PanelImperativeHandle>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const compact = useCompactLayout();
  // On a narrow screen the topic list and a panel cannot share the width: when
  // the first panel opens, give it the screen. The arrow brings the list back.
  useEffect(() => {
    if (compact && hasPanels) sidebarRef.current?.collapse();
  }, [compact, hasPanels]);
  if (!bag) return null;

  const toggleSidebar = () => {
    if (sidebarRef.current?.isCollapsed()) {
      sidebarRef.current.expand();
      setSidebarCollapsed(false);
    } else {
      sidebarRef.current?.collapse();
      setSidebarCollapsed(true);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      <Group orientation="horizontal" className="h-full w-full flex">
        <Panel
          panelRef={sidebarRef}
          collapsible
          collapsedSize="0%"
          onResize={() => setSidebarCollapsed(sidebarRef.current?.isCollapsed() ?? false)}
          defaultSize="28%"
          minSize="18%"
          maxSize="50%"
          className="border-r border-border bg-bg-secondary/50 flex flex-col min-h-0 min-w-0"
        >
          <TopicInspector />
        </Panel>
        <Separator className="group relative w-1.5 cursor-col-resize flex-shrink-0">
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-border group-hover:bg-accent-blue/60 transition-colors" />
          <button
            type="button"
            onClick={toggleSidebar}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={sidebarCollapsed ? 'Show topics panel' : 'Hide topics panel'}
            title={sidebarCollapsed ? 'Show topics panel' : 'Hide topics panel'}
            className="absolute top-1/2 -translate-y-1/2 -left-2.5 z-10 w-5 h-9 rounded-md border border-border bg-surface flex items-center justify-center text-text-tertiary hover:text-accent-blue hover:border-accent-blue/40 transition-colors"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path
                d={sidebarCollapsed ? 'M2 1l4 3-4 3' : 'M6 1L2 4l4 3'}
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </Separator>
        <Panel className="flex flex-col min-h-0 min-w-0">
          {hasPanels ? (
            <PanelGrid />
          ) : (
            <div className="flex-1 flex items-center justify-center p-8">
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
    <div className={`rounded-xl border p-4 ${colorClasses[color]} transition-transform hover:scale-[1.02]`}>
      <p className="text-text-primary text-xl font-bold mono">{value}</p>
      <p className="text-text-muted text-xs mt-1">{label}</p>
    </div>
  );
}
