import { nsToSeconds } from '../../../utils/time';

/**
 * Format a nanosecond offset (usually "time since bag start") as a compact
 * relative duration: seconds with up to `digits` decimals below a minute,
 * minutes beyond it ("12m 3.5s", one decimal so it still fits narrow
 * columns). Shared by the Log row, Log footer, and Timeline so the same
 * quantity never renders with two different precisions.
 */
export function formatRelativeTime(ns: bigint, digits = 3): string {
  const sec = nsToSeconds(ns);
  if (sec < 60) return `${sec.toFixed(digits)}s`;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}m ${s.toFixed(1)}s`;
}
