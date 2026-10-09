import { useState } from 'react';
import { type LiveStatus } from '../../../store/liveStore';
import { nsToSeconds } from '../../../utils/time';
import { formatAnchorSec } from './format';

interface BagChipProps {
  color: string;
  name: string;
  format: string;
  focused: boolean;
  /** Hide the format pill on the single-bag chip - it's still in the badge below. */
  showFormat: boolean;
  /** Bag-local time the anchor points to, in nanoseconds relative to bag start.
   *  `null` when no anchor is set or anchor alignment isn't active. */
  anchorBagLocalNs: bigint | null;
  liveStatus?: LiveStatus;
  liveStatusMessage?: string;
  /** True when /clock sim time is active for this live bag. */
  isSimTime?: boolean;
  onFocus: () => void;
  onRemove: () => void;
  onClearAnchor: () => void;
}

export function BagChip({
  color,
  name,
  format,
  focused,
  showFormat,
  anchorBagLocalNs,
  liveStatus,
  liveStatusMessage,
  isSimTime,
  onFocus,
  onRemove,
  onClearAnchor,
}: BagChipProps) {
  const [hover, setHover] = useState(false);
  const anchorSec = anchorBagLocalNs !== null ? nsToSeconds(anchorBagLocalNs) : null;
  // For live bags show the chip name as just the ws host, not the full URL.
  const displayName = format === 'live' ? name.replace(/^wss?:\/\//, '') : name;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border transition-colors max-w-[220px] flex-shrink-0 ${
        focused
          ? 'bg-surface border-border-hover text-text-primary'
          : 'bg-transparent border-border text-text-secondary hover:bg-surface-hover'
      }`}
    >
      <button
        onClick={onFocus}
        title={focused ? `${name} (focused - new panels open against this bag)` : `Focus ${name}`}
        className="flex items-center gap-1.5 min-w-0"
      >
        {liveStatus ? (
          <LiveStatusDot status={liveStatus} message={liveStatusMessage} />
        ) : (
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: color }}
          />
        )}
        <span className="truncate mono">{displayName}</span>
        {showFormat && (
          <span
            className={`badge flex-shrink-0 ${
              format === 'mcap'
                ? 'badge-cyan'
                : format === 'bag'
                ? 'badge-amber'
                : format === 'live'
                ? 'badge-emerald'
                : 'badge-violet'
            }`}
          >
            {format === 'live' ? 'LIVE' : format.toUpperCase()}
          </span>
        )}
        {isSimTime && (
          <span
            className="badge badge-violet flex-shrink-0"
            title="Sim time active - timestamps from /clock topic"
          >
            SIM
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
          className="w-4 h-4 rounded-full flex items-center justify-center text-text-tertiary hover:text-accent-rose hover:bg-accent-rose/10 transition-colors flex-shrink-0"
        >
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function AnchorIcon() {
  // Inline SVG anchor - avoids pulling in an icon dep and matches the
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

/**
 * LiveStatusDot - solid fill = connected, hollow ring = anything else. Color
 * alone (emerald/amber/rose/gray) fails for colorblind users trying to tell
 * "connecting" from "error" at a glance; the shape difference doesn't.
 */
function LiveStatusDot({ status, message }: { status: LiveStatus; message?: string }) {
  const { colorClass, pulse, title } = (() => {
    switch (status) {
      case 'connected':
        return { colorClass: 'border-accent-emerald bg-accent-emerald', pulse: true, title: message ? `Connected to ${message}` : 'Connected' };
      case 'connecting':
        return { colorClass: 'border-accent-amber bg-transparent', pulse: true, title: 'Connecting…' };
      case 'reconnecting':
        return { colorClass: 'border-accent-amber bg-transparent', pulse: true, title: message ?? 'Reconnecting…' };
      case 'error':
        return { colorClass: 'border-accent-rose bg-transparent', pulse: false, title: message ?? 'Connection error' };
      case 'disconnected':
        return { colorClass: 'border-text-muted bg-transparent', pulse: false, title: 'Disconnected' };
    }
  })();
  return (
    <span
      className={`w-2 h-2 rounded-full flex-shrink-0 border-[1.5px] ${colorClass} ${pulse ? 'animate-pulse' : ''}`}
      title={title}
      aria-label={title}
    />
  );
}
