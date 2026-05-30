import { useRef, useState } from 'react';
import { useBagStore, type TimeAlignment } from '../../store/bagStore';
import { useUiStore } from '../../store/uiStore';
import { formatFileSize } from '../../utils/bytes';
import { formatDuration } from '../../utils/time';
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
  const clearAll = useBagStore((s) => s.clearAll);
  const setModal = useUiStore((s) => s.setModal);

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
            return (
              <BagChip
                key={id}
                color={entry.color}
                name={entry.summary.fileName}
                format={entry.summary.format}
                focused={id === focusBagId}
                showFormat={!multi}
                onFocus={() => setFocusBag(id)}
                onRemove={() => removeBag(id)}
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

      {/* Right: alignment selector (multi-bag only) + Help + Close */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {multi && (
          <AlignmentSelector value={alignment} onChange={setAlignment} />
        )}
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
  onFocus: () => void;
  onRemove: () => void;
}
function BagChip({
  color,
  name,
  format,
  focused,
  showFormat,
  onFocus,
  onRemove,
}: BagChipProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border transition-all max-w-[180px] flex-shrink-0 ${
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
