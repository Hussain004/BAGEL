import { useBagStore } from '../../store/bagStore';
import { formatFileSize } from '../../utils/bytes';
import { formatDuration } from '../../utils/time';

/**
 * Toolbar — Top bar showing bag file info, stats, and controls.
 * Rendered when a bag file is loaded.
 */
export function Toolbar() {
  const { bag, clearBag } = useBagStore();

  if (!bag) return null;

  return (
    <header className="glass-strong px-6 py-3 flex items-center justify-between animate-fade-in flex-shrink-0 z-50">
      {/* Left: Logo + File Name */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <BagelIconSmall />
          <span className="text-lg font-bold text-gradient">BAGEL</span>
        </div>

        <div className="w-px h-6 bg-border" />

        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-text-tertiary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <span className="text-text-primary font-medium text-sm truncate max-w-60">
            {bag.fileName}
          </span>
          <span className={`badge ${bag.format === 'mcap' ? 'badge-cyan' : 'badge-violet'}`}>
            {bag.format.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Center: Stats */}
      <div className="hidden md:flex items-center gap-6">
        <Stat label="Duration" value={formatDuration(bag.duration)} icon="clock" />
        <Stat label="Messages" value={formatNumber(bag.totalMessageCount)} icon="messages" />
        <Stat label="Topics" value={bag.topics.length.toString()} icon="topics" />
        <Stat label="Size" value={formatFileSize(bag.fileSize)} icon="size" />
      </div>

      {/* Right: Close */}
      <button
        onClick={clearBag}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-all text-sm"
        title="Close bag file"
        id="close-bag-button"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
        <span className="hidden lg:inline">Close</span>
      </button>
    </header>
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
