/**
 * The "issue report" bundle: one zip to attach to a GitHub or Jira ticket,
 * holding a clip of the bag around what you are looking at, the link that
 * restores the layout, and a Health summary of the whole bag.
 */

import { zipSync, strToU8 } from 'fflate';
import type { TopicHealth } from './topicStats';
import type { TimelineView } from './timelineView';
import { isFullView } from './timelineView';

/** Seconds of bag on each side of the playhead when the timeline is not zoomed. */
export const REPORT_HALF_WINDOW_SEC = 5;

/**
 * The clip's time range: the zoomed timeline window when there is one (that is
 * what the reporter chose to look at), otherwise a few seconds either side of
 * the playhead, kept inside the bag.
 */
export function reportWindow(
  bagStart: bigint,
  bagEnd: bigint,
  view: TimelineView,
  playhead: bigint,
): { startNs: bigint; endNs: bigint } {
  const span = bagEnd - bagStart;
  if (span <= 0n) return { startNs: bagStart, endNs: bagEnd };
  if (!isFullView(view)) {
    const at = (f: number) => bagStart + BigInt(Math.round(Number(span) * Math.min(1, Math.max(0, f))));
    return { startNs: at(view.lo), endNs: at(view.hi) };
  }
  const half = BigInt(REPORT_HALF_WINDOW_SEC * 1e9);
  const p = playhead < bagStart ? bagStart : playhead > bagEnd ? bagEnd : playhead;
  let startNs = p - half;
  let endNs = p + half;
  // Keep the full width where the bag allows: shift rather than clip at either end.
  if (startNs < bagStart) [startNs, endNs] = [bagStart, bagStart + 2n * half];
  if (endNs > bagEnd) [startNs, endNs] = [bagEnd - 2n * half, bagEnd];
  return { startNs: startNs < bagStart ? bagStart : startNs, endNs: endNs > bagEnd ? bagEnd : endNs };
}

const hz = (v: number) => (v >= 1 ? v.toFixed(1) : v.toFixed(3));
const cell = (s: string) => s.replace(/\|/g, '\\|');

/** Health as a Markdown table, gaps first so the likely culprit is at the top. */
export function healthMarkdown(healths: TopicHealth[]): string {
  const rows = [...healths].sort((a, b) => b.gapCount - a.gapCount || a.topic.localeCompare(b.topic));
  const lines = [
    '| Topic | Msgs | Hz | Jitter | Gaps | Bandwidth |',
    '|---|---:|---:|---:|---:|---:|',
    ...rows.map((h) =>
      `| \`${cell(h.topic)}\` | ${h.count} | ${hz(h.meanHz)} | ${(h.jitterSec * 1000).toFixed(2)} ms | ${h.gapCount || '-'} | ${(h.bandwidthBytesPerSec / 1024).toFixed(1)} KB/s |`,
    ),
  ];
  const gaps = rows.flatMap((h) => h.gaps.map((g) => ({ topic: h.topic, ...g }))).sort((a, b) => b.gapSec - a.gapSec).slice(0, 20);
  if (gaps.length > 0) {
    lines.push('', 'Longest gaps (seconds from bag start):', '');
    for (const g of gaps) lines.push(`- \`${g.topic}\`: ${g.gapSec.toFixed(2)} s at ${(g.atNs / 1e9).toFixed(2)} s`);
  }
  return lines.join('\n') + '\n';
}

export interface ReportInfo {
  appVersion: string;
  bagName: string;
  format: string;
  bagStartNs: bigint;
  clip: { startNs: bigint; endNs: bigint; messageCount: number } | null;
  playheadNs: bigint;
  link: string;
  /** True when the link names the bag (a URL), false for a local file the recipient must open. */
  linkCarriesBag: boolean;
  createdAt: Date;
}

const rel = (ns: bigint, base: bigint) => `${(Number(ns - base) / 1e9).toFixed(3)} s`;

export function reportReadme(info: ReportInfo, healthMd: string): string {
  const clip = info.clip
    ? `- \`clip.mcap\`: ${info.clip.messageCount} messages from ${rel(info.clip.startNs, info.bagStartNs)} to ${rel(info.clip.endNs, info.bagStartNs)} (times from bag start).`
    : '- No clip: the bag could not be trimmed (see `errors.txt`).';
  const open = info.linkCarriesBag
    ? 'Open the link in `link.txt` to see the same bag, layout and playhead.'
    : 'Open `clip.mcap` in BAGEL, then open the link in `link.txt` to restore the layout and playhead.';
  return [
    `# BAGEL issue report`,
    '',
    `- Bag: \`${info.bagName}\` (${info.format})`,
    `- Playhead: ${rel(info.playheadNs, info.bagStartNs)} from bag start`,
    `- Made with BAGEL v${info.appVersion} on ${info.createdAt.toISOString()}`,
    '',
    '## What is in here',
    '',
    clip,
    '- `link.txt`: the BAGEL link for this view.',
    '- `health.md`: per-topic rate, jitter and gaps over the whole bag.',
    '',
    open,
    '',
    '## Health',
    '',
    healthMd,
  ].join('\n');
}

/** The zip. The clip is stored as is (MCAP chunks are already compressed); text is deflated. */
export function buildReportZip(files: { clip?: Uint8Array; link: string; health: string; readme: string; errors?: string }): Uint8Array {
  const entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    'README.md': strToU8(files.readme),
    'link.txt': strToU8(files.link + '\n'),
    'health.md': strToU8(files.health),
  };
  if (files.clip) entries['clip.mcap'] = [files.clip, { level: 0 }];
  if (files.errors) entries['errors.txt'] = strToU8(files.errors);
  return zipSync(entries, { level: 6 });
}
