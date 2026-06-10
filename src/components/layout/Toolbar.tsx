import { useRef, useState } from 'react';
import {
  useBagStore,
  bagLocalTimeFor,
  type BagEntry,
  type TimeAlignment,
} from '../../store/bagStore';
import { usePlayheadStore } from '../../store/playheadStore';
import { useLayoutStore } from '../../store/layoutStore';
import { useThemeStore } from '../../store/themeStore';
import { useUiStore } from '../../store/uiStore';
import { useRobotModelStore } from '../../store/robotModelStore';
import { formatFileSize } from '../../utils/bytes';
import { formatDuration, nsToSeconds } from '../../utils/time';
import { APP_VERSION } from '../../utils/version';

/**
 * Toolbar — Top bar showing bag file info, stats, and controls.
 *
 * v0.9 multi-bag: shows one chip per loaded bag with a colour swatch, focus
 * indicator, close button. Adds an "Add bag" affordance (file picker) and a
 * time-alignment selector that's only visible when >1 bag is loaded — for
 * single-bag setups the chip + stats row stays simple.
 */
export function Toolbar() {
  const bag = useBagStore((s) => s.bag);
  const bags = useBagStore((s) => s.bags);
  const bagOrder = useBagStore((s) => s.bagOrder);
  const focusBagId = useBagStore((s) => s.focusBagId);
  const alignment = useBagStore((s) => s.alignment);
  const addBagFromFile = useBagStore((s) => s.addBagFromFile);
  const removeBag = useBagStore((s) => s.removeBag);
  const setFocusBag = useBagStore((s) => s.setFocusBag);
  const setAlignment = useBagStore((s) => s.setAlignment);
  const setAnchor = useBagStore((s) => s.setAnchor);
  const clearAll = useBagStore((s) => s.clearAll);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const openPanel = useLayoutStore((s) => s.openPanel);
  const setModal = useUiStore((s) => s.setModal);
  const robotModel = useRobotModelStore((s) => s.loaded);
  const clearRobotModel = useRobotModelStore((s) => s.clearLoaded);

  // Anchor placement: pick the focused bag's current bag-local time as the
  // anchor event, then snap aligned time to 0 so the user keeps seeing the
  // exact same content they just identified as the event. See the v1.0 plan
  // notes for the math — without the snap, the focused bag's view shifts
  // because the alignment offset just changed.
  const onSetAnchor = () => {
    if (!focusBagId) return;
    const entry = bags.get(focusBagId);
    if (!entry) return;
    const phState = usePlayheadStore.getState();
    const bagLocalNs = bagLocalTimeFor(entry, phState.timeNs, alignment);
    setAnchor(focusBagId, bagLocalNs);
    // syncPlayheadRange (inside setAnchor) recomputed the aligned window;
    // park the head at 0 so the focused bag stays on its event frame.
    usePlayheadStore.getState().seek(usePlayheadStore.getState().startNs);
  };

  const onClearAnchor = (id: string) => {
    setAnchor(id, undefined);
  };

  const addInputRef = useRef<HTMLInputElement>(null);
  const onAddClick = () => addInputRef.current?.click();
  const onAddInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    await addBagFromFile(file);
  };

  if (!bag) return null;
  const multi = bagOrder.length > 1;
  // v1.2: bag editing now covers every format BAGEL reads. Output is MCAP
  // regardless of the source - the format-specific edit pipelines hand off
  // to the same MCAP writer.
  const canEditFocusedBag =
    bag.format === 'mcap' || bag.format === 'bag' || bag.format === 'db3';

  return (
    <header className="glass-strong px-6 py-3 flex items-center justify-between animate-fade-in flex-shrink-0 z-50 gap-4">
      {/* Left: Logo + bag chips */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <button
          onClick={() => setModal('about')}
          className="flex items-center gap-2 rounded-md px-1 -mx-1 hover:bg-surface-hover transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60 flex-shrink-0"
          title={`BAGEL v${APP_VERSION} — About`}
          aria-label="About BAGEL"
        >
          <BagelIconSmall />
          <span className="text-lg font-bold text-gradient">BAGEL</span>
        </button>

        <div className="w-px h-6 bg-border flex-shrink-0" />

        <div className="flex items-center gap-1.5 min-w-0 overflow-x-auto">
          {bagOrder.map((id) => {
            const entry = bags.get(id);
            if (!entry) return null;
            // Only show the anchor pip when anchor mode is active — outside it
            // the per-bag anchor is dormant and showing it would be noise.
            const anchorBagLocalNs =
              alignment === 'anchor' && entry.anchorNs !== undefined
                ? entry.anchorNs - entry.summary.startTime
                : null;
            return (
              <BagChip
                key={id}
                color={entry.color}
                name={entry.summary.fileName}
                format={entry.summary.format}
                focused={id === focusBagId}
                showFormat={!multi}
                anchorBagLocalNs={anchorBagLocalNs}
                onFocus={() => setFocusBag(id)}
                onRemove={() => removeBag(id)}
                onClearAnchor={() => onClearAnchor(id)}
              />
            );
          })}
          <button
            onClick={onAddClick}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-surface-hover border border-dashed border-border hover:border-accent-blue/40 transition-all text-xs flex-shrink-0"
            title="Add another bag for overlay comparison"
            aria-label="Add another bag"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <span className="hidden lg:inline">Add bag</span>
          </button>
          <input
            ref={addInputRef}
            type="file"
            accept=".mcap,.db3,.bag"
            className="hidden"
            onChange={onAddInput}
          />
        </div>
      </div>

      {/* Center: Stats — focused bag (or aggregate when >1 loaded).
          Hidden on narrow viewports — the data is still available in the
          empty panel-grid summary card. */}
      <div className="hidden lg:flex items-center gap-6 flex-shrink-0">
        {multi ? (
          <MultiBagStats bags={bags} bagOrder={bagOrder} />
        ) : (
          <>
            <Stat label="Duration" value={formatDuration(bag.duration)} icon="clock" />
            <Stat label="Messages" value={formatNumber(bag.totalMessageCount)} icon="messages" />
            <Stat label="Topics" value={bag.topics.length.toString()} icon="topics" />
            <Stat label="Size" value={formatFileSize(bag.fileSize)} icon="size" />
          </>
        )}
      </div>
      <div className="hidden md:flex lg:hidden items-center gap-3 text-xs text-text-tertiary mono flex-shrink-0">
        <span>{formatDuration(bag.duration)}</span>
        <span className="text-text-muted">·</span>
        <span>{formatNumber(bag.totalMessageCount)} msgs</span>
        <span className="text-text-muted">·</span>
        <span>{bag.topics.length} topics</span>
      </div>

      {/* Right: alignment selector + anchor button (multi-bag anchor mode) +
          Help + Close */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {multi && (
          <AlignmentSelector value={alignment} onChange={setAlignment} />
        )}
        {multi && alignment === 'anchor' && focusBagId && bags.has(focusBagId) && (
          <SetAnchorButton
            entry={bags.get(focusBagId)!}
            onSetAnchor={onSetAnchor}
          />
        )}
        <button
          onClick={() =>
            openPanel({
              kind: 'health',
              topicName: '__health__',
              type: '',
              bagId: focusBagId ?? undefined,
            })
          }
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-border hover:border-accent-blue/40 transition-all"
          title="Open Bag Health dashboard - per-topic Hz, jitter, gaps, bandwidth"
          aria-label="Open bag health dashboard"
        >
          <HealthIcon />
          <span className="hidden xl:inline">Health</span>
        </button>
        {bag && (
          <button
            onClick={() => setModal('clip-export')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-border hover:border-accent-blue/40 transition-all"
            title="Export a panel as animated PNG zip or WebM video"
            aria-label="Export clip"
          >
            <ClipIcon />
            <span className="hidden xl:inline">Export</span>
          </button>
        )}
        {canEditFocusedBag && (
          <button
            onClick={() => setModal('bag-edit')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-border hover:border-accent-blue/40 transition-all"
            title="Trim time range and drop topics, then download as a new MCAP (v1.2: works for .mcap / .bag / .db3)"
            aria-label="Edit bag - trim and re-export"
          >
            <EditIcon />
            <span className="hidden xl:inline">Edit</span>
          </button>
        )}
        <button
          onClick={() => setModal('urdf-load')}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-all ${
            robotModel
              ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue hover:bg-accent-blue/15'
              : 'border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover hover:border-accent-blue/40'
          }`}
          title={
            robotModel
              ? `Robot model loaded: ${robotModel.sourceName} (${robotModel.model.links.size} links). Click to swap.`
              : 'Load a URDF to render a robot model in every 3D panel'
          }
          aria-label="Load robot model"
        >
          <RobotIcon />
          <span className="hidden xl:inline">{robotModel ? 'Robot' : 'Robot'}</span>
        </button>
        {robotModel && (
          <button
            onClick={clearRobotModel}
            className="w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:text-accent-rose hover:bg-accent-rose/10 transition-all"
            title={`Remove robot model "${robotModel.sourceName}"`}
            aria-label="Remove robot model"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        <button
          onClick={toggleTheme}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          {theme === 'dark' ? (
            // Sun icon — switches to light
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
              <circle cx="12" cy="12" r="4" />
              <path
                strokeLinecap="round"
                d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
              />
            </svg>
          ) : (
            // Moon icon — switches to dark
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
              />
            </svg>
          )}
        </button>
        <button
          onClick={() => setModal('shortcuts')}
          className="w-9 h-9 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.5M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
          </svg>
        </button>
        <button
          onClick={clearAll}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-all text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
          title={multi ? 'Close every bag' : 'Close bag file (O for open another)'}
          aria-label="Close bag file"
          id="close-bag-button"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="hidden lg:inline">Close</span>
        </button>
      </div>
    </header>
  );
}

interface BagChipProps {
  color: string;
  name: string;
  format: string;
  focused: boolean;
  /** Hide the format pill on the single-bag chip — it's still in the badge below. */
  showFormat: boolean;
  /** Bag-local time the anchor points to, in nanoseconds relative to bag start.
   *  `null` when no anchor is set or anchor alignment isn't active. */
  anchorBagLocalNs: bigint | null;
  onFocus: () => void;
  onRemove: () => void;
  onClearAnchor: () => void;
}
function BagChip({
  color,
  name,
  format,
  focused,
  showFormat,
  anchorBagLocalNs,
  onFocus,
  onRemove,
  onClearAnchor,
}: BagChipProps) {
  const [hover, setHover] = useState(false);
  const anchorSec = anchorBagLocalNs !== null ? nsToSeconds(anchorBagLocalNs) : null;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border transition-all max-w-[220px] flex-shrink-0 ${
        focused
          ? 'bg-surface border-border-hover text-text-primary'
          : 'bg-transparent border-border text-text-secondary hover:bg-surface-hover'
      }`}
    >
      <button
        onClick={onFocus}
        title={focused ? `${name} (focused — new panels open against this bag)` : `Focus ${name}`}
        className="flex items-center gap-1.5 min-w-0"
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="truncate mono">{name}</span>
        {showFormat && (
          <span
            className={`badge flex-shrink-0 ${
              format === 'mcap' ? 'badge-cyan' : format === 'bag' ? 'badge-amber' : 'badge-violet'
            }`}
          >
            {format.toUpperCase()}
          </span>
        )}
      </button>
      {anchorSec !== null && (
        <button
          onClick={onClearAnchor}
          title={`Anchored at bag-local t=${anchorSec.toFixed(2)}s. Click to clear.`}
          aria-label={`Clear anchor for ${name}`}
          className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] text-accent-blue hover:text-text-primary hover:bg-accent-blue/15 transition-colors mono flex-shrink-0"
        >
          <AnchorIcon />
          <span className="tabular-nums">{formatAnchorSec(anchorSec)}</span>
        </button>
      )}
      {(hover || focused) && (
        <button
          onClick={onRemove}
          title="Remove this bag"
          aria-label={`Remove ${name}`}
          className="w-4 h-4 rounded-full flex items-center justify-center text-text-tertiary hover:text-accent-rose hover:bg-accent-rose/10 transition-all flex-shrink-0"
        >
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

function AnchorIcon() {
  // Inline SVG anchor — avoids pulling in an icon dep and matches the
  // toolbar's other inline SVGs.
  return (
    <svg
      className="w-3 h-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.8}
      aria-hidden="true"
    >
      <circle cx="12" cy="5" r="2" />
      <path strokeLinecap="round" d="M12 7v14M5 12c0 4 3 7 7 7s7-3 7-7M3 12h4M17 12h4" />
    </svg>
  );
}

function RobotIcon() {
  // Simple stylised robot head: rounded square + two dot eyes + an antenna.
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
    >
      <rect x="5" y="8" width="14" height="11" rx="2" />
      <circle cx="9.5" cy="13" r="1" fill="currentColor" />
      <circle cx="14.5" cy="13" r="1" fill="currentColor" />
      <path strokeLinecap="round" d="M12 8V5M12 3v1" />
    </svg>
  );
}

function EditIcon() {
  // Scissors icon: universal "cut/trim" affordance.
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 6l12 12M9 18L21 6" />
    </svg>
  );
}

function HealthIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h3l3-9 4 18 3-9 3 0" />
    </svg>
  );
}

/** Format a sub-minute anchor time tightly so it fits in the chip. */
function formatAnchorSec(sec: number): string {
  if (sec < 60) return `${sec.toFixed(2)}s`;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}m${s.toFixed(1)}s`;
}

interface SetAnchorButtonProps {
  entry: BagEntry;
  onSetAnchor: () => void;
}
function SetAnchorButton({ entry, onSetAnchor }: SetAnchorButtonProps) {
  return (
    <button
      onClick={onSetAnchor}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-border hover:border-accent-blue/40 transition-all"
      title={`Set "${entry.summary.fileName}" anchor to the current playhead — every bag's aligned t=0 will line up at this event.`}
      aria-label={`Set anchor for ${entry.summary.fileName} at current playhead`}
    >
      <AnchorIcon />
      <span className="hidden xl:inline">Set anchor</span>
    </button>
  );
}

const ALIGNMENT_LABELS: Record<TimeAlignment, string> = {
  'wall-clock': 'Wall clock',
  'bag-start': 'Bag start',
  anchor: 'Anchor',
};
const ALIGNMENT_HELP: Record<TimeAlignment, string> = {
  'wall-clock': 'Use header.stamp directly across bags. Right when bags share a synced clock.',
  'bag-start':
    "Subtract each bag's startTime so t=0 lines up. Right for offline replays where absolute time is meaningless.",
  anchor:
    "Subtract each bag's user-picked anchor time. Right when an event (race start, flag drop) physically aligns runs.",
};

function AlignmentSelector({
  value,
  onChange,
}: {
  value: TimeAlignment;
  onChange: (v: TimeAlignment) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-text-muted mono hidden xl:inline">align</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TimeAlignment)}
        title={ALIGNMENT_HELP[value]}
        aria-label="Time alignment between bags"
        className="bg-surface border border-border rounded-md px-2 py-1.5 mono text-text-primary text-xs focus:outline-none focus:border-accent-blue/50"
      >
        {(Object.keys(ALIGNMENT_LABELS) as TimeAlignment[]).map((mode) => (
          <option key={mode} value={mode}>
            {ALIGNMENT_LABELS[mode]}
          </option>
        ))}
      </select>
    </div>
  );
}

function MultiBagStats({
  bags,
  bagOrder,
}: {
  bags: Map<string, { summary: { totalMessageCount: number; topics: { name: string }[]; fileSize: number; duration: number } }>;
  bagOrder: string[];
}) {
  let totalMessages = 0;
  let totalSize = 0;
  let totalDuration = 0;
  const seenTopics = new Set<string>();
  for (const id of bagOrder) {
    const entry = bags.get(id);
    if (!entry) continue;
    totalMessages += entry.summary.totalMessageCount;
    totalSize += entry.summary.fileSize;
    totalDuration += entry.summary.duration;
    for (const t of entry.summary.topics) seenTopics.add(t.name);
  }
  return (
    <>
      <Stat
        label="Bags"
        value={`${bagOrder.length}`}
        icon="size"
      />
      <Stat
        label="Total duration"
        value={formatDuration(totalDuration)}
        icon="clock"
      />
      <Stat
        label="Messages"
        value={formatNumber(totalMessages)}
        icon="messages"
      />
      <Stat
        label="Unique topics"
        value={seenTopics.size.toString()}
        icon="topics"
      />
      <Stat label="Size" value={formatFileSize(totalSize)} icon="size" />
    </>
  );
}

/** Stat pill for the toolbar */
function Stat({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <StatIcon type={icon} />
      <div>
        <span className="text-text-primary font-medium">{value}</span>
        <span className="text-text-muted ml-1.5">{label}</span>
      </div>
    </div>
  );
}

/** Stat icon component */
function StatIcon({ type }: { type: string }) {
  const className = "w-3.5 h-3.5 text-text-tertiary";

  switch (type) {
    case 'clock':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case 'messages':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
        </svg>
      );
    case 'topics':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
        </svg>
      );
    case 'size':
      return (
        <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375" />
        </svg>
      );
    default:
      return null;
  }
}

/** Format large numbers with commas */
function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

/** Small BAGEL icon for toolbar */
function ClipIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
    >
      {/* Film strip outline */}
      <rect x="2" y="6" width="20" height="12" rx="1.5" />
      {/* Perforations left */}
      <rect x="4" y="9" width="2" height="2" rx="0.5" />
      <rect x="4" y="13" width="2" height="2" rx="0.5" />
      {/* Perforations right */}
      <rect x="18" y="9" width="2" height="2" rx="0.5" />
      <rect x="18" y="13" width="2" height="2" rx="0.5" />
      {/* Play triangle */}
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 9.5l5 2.5-5 2.5V9.5z" />
    </svg>
  );
}

function BagelIconSmall() {
  return (
    <div className="relative w-7 h-7">
      <div className="absolute inset-0 rounded-full bg-gradient-to-br from-accent-blue via-accent-cyan to-accent-violet opacity-80" />
      <div className="absolute inset-[2px] rounded-full bg-bg-primary" />
      <div className="absolute inset-[4px] rounded-full bg-gradient-to-br from-accent-blue/20 to-accent-violet/20" />
      <div className="absolute inset-[7px] rounded-full bg-bg-primary" />
    </div>
  );
}
