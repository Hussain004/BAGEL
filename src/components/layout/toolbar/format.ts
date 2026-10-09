/** Format a sub-minute anchor time tightly so it fits in the chip. */
export function formatAnchorSec(sec: number): string {
  if (sec < 60) return `${sec.toFixed(2)}s`;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}m${s.toFixed(1)}s`;
}

/** Format large numbers with commas */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}
