/**
 * What is different between two recordings?
 *
 * "This run worked, that run didn't": the first question is which topics are
 * missing, retyped, or publishing at a different rate. Everything needed is
 * already in the two `BagSummary` objects, so the diff costs no scan. Pure and
 * DOM-free so the comparison rules can be tested exactly.
 */

import type { BagSummary, TopicInfo } from '../types/bag';

export type DiffKind = 'only-a' | 'only-b' | 'type' | 'rate' | 'same';

export interface DiffRow {
  topic: string;
  kind: DiffKind;
  a: TopicInfo | null;
  b: TopicInfo | null;
  /** Human-readable one-liner, e.g. `10.0 Hz vs 5.0 Hz (50% lower)`. */
  detail: string;
}

export interface BagDiff {
  rows: DiffRow[];
  counts: Record<DiffKind, number>;
  durationA: number;
  durationB: number;
}

/** `sensor_msgs/msg/Image` (ROS 2) and `sensor_msgs/Image` (ROS 1) are the same type. */
export function normalizeType(type: string): string {
  return type.replace(/\/(msg|srv|action)\//, '/');
}

/** Messages per second, or null when it cannot be a rate (under two messages, or no duration). */
export function topicHz(t: TopicInfo, durationSec: number): number | null {
  if (t.messageCount < 2) return null;
  if (typeof t.frequency === 'number' && Number.isFinite(t.frequency) && t.frequency > 0) return t.frequency;
  return durationSec > 0 ? t.messageCount / durationSec : null;
}

function hz(n: number): string {
  return `${n >= 100 ? n.toFixed(0) : n.toFixed(1)} Hz`;
}

const ORDER: Record<DiffKind, number> = { 'only-a': 0, 'only-b': 1, type: 2, rate: 3, same: 4 };

export interface DiffOptions {
  /** Relative rate difference, against the larger rate, above which a topic is flagged. Default 0.1. */
  rateTolerance?: number;
}

export function diffBags(a: BagSummary, b: BagSummary, opts: DiffOptions = {}): BagDiff {
  const tol = opts.rateTolerance ?? 0.1;
  const byNameA = new Map(a.topics.map((t) => [t.name, t]));
  const byNameB = new Map(b.topics.map((t) => [t.name, t]));
  const names = new Set([...byNameA.keys(), ...byNameB.keys()]);
  const rows: DiffRow[] = [];

  for (const name of names) {
    const ta = byNameA.get(name) ?? null;
    const tb = byNameB.get(name) ?? null;
    if (ta && !tb) {
      rows.push({ topic: name, kind: 'only-a', a: ta, b: null, detail: `${ta.messageCount.toLocaleString()} messages, not in the other bag` });
      continue;
    }
    if (!ta && tb) {
      rows.push({ topic: name, kind: 'only-b', a: null, b: tb, detail: `${tb.messageCount.toLocaleString()} messages, not in the other bag` });
      continue;
    }
    if (!ta || !tb) continue;

    if (normalizeType(ta.type) !== normalizeType(tb.type)) {
      rows.push({ topic: name, kind: 'type', a: ta, b: tb, detail: `${ta.type} vs ${tb.type}` });
      continue;
    }
    const ha = topicHz(ta, a.duration);
    const hb = topicHz(tb, b.duration);
    if (ha !== null && hb !== null) {
      const rel = Math.abs(ha - hb) / Math.max(ha, hb);
      if (rel > tol) {
        const pct = Math.round(rel * 100);
        rows.push({
          topic: name,
          kind: 'rate',
          a: ta,
          b: tb,
          detail: `${hz(ha)} vs ${hz(hb)} (${pct}% ${hb < ha ? 'lower' : 'higher'} in B)`,
        });
        continue;
      }
    } else if ((ha === null) !== (hb === null)) {
      // One side has a rate and the other has under two messages: a topic that
      // all but stopped publishing is exactly the thing worth surfacing.
      rows.push({
        topic: name,
        kind: 'rate',
        a: ta,
        b: tb,
        detail: `${ta.messageCount.toLocaleString()} vs ${tb.messageCount.toLocaleString()} messages`,
      });
      continue;
    }
    rows.push({ topic: name, kind: 'same', a: ta, b: tb, detail: `${ta.messageCount.toLocaleString()} vs ${tb.messageCount.toLocaleString()} messages` });
  }

  rows.sort((x, y) => ORDER[x.kind] - ORDER[y.kind] || x.topic.localeCompare(y.topic));
  const counts: Record<DiffKind, number> = { 'only-a': 0, 'only-b': 0, type: 0, rate: 0, same: 0 };
  for (const r of rows) counts[r.kind]++;
  return { rows, counts, durationA: a.duration, durationB: b.duration };
}

const LABEL: Record<DiffKind, string> = {
  'only-a': 'Only in A',
  'only-b': 'Only in B',
  type: 'Type differs',
  rate: 'Rate differs',
  same: 'Same',
};

export function diffKindLabel(kind: DiffKind): string {
  return LABEL[kind];
}

/** A paste-into-an-issue report. Identical topics are summarised, not listed. */
export function diffToMarkdown(diff: BagDiff, nameA: string, nameB: string): string {
  const lines = [
    `# ${nameA} vs ${nameB}`,
    '',
    `Duration: ${diff.durationA.toFixed(1)} s (A) vs ${diff.durationB.toFixed(1)} s (B)`,
    '',
  ];
  const differing = diff.rows.filter((r) => r.kind !== 'same');
  if (differing.length === 0) {
    lines.push(`No differences across ${diff.counts.same} shared topics.`);
  } else {
    for (const kind of ['only-a', 'only-b', 'type', 'rate'] as const) {
      const rows = differing.filter((r) => r.kind === kind);
      if (rows.length === 0) continue;
      lines.push(`## ${LABEL[kind]} (${rows.length})`, '');
      for (const r of rows) lines.push(`- \`${r.topic}\`: ${r.detail}`);
      lines.push('');
    }
    lines.push(`${diff.counts.same} other topics match.`);
  }
  return `${lines.join('\n')}\n`;
}
