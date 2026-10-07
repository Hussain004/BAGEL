import type { AllTopicStats } from '../types/bag';

export interface Anomaly {
  topic: string;
  kind: 'non-monotonic-stamp';
  atNs: number;
  detail: string;
}

export function detectNonMonotonicStamps(stats: AllTopicStats): Anomaly[] {
  const anomalies: Anomaly[] = [];
  for (const [topic, { times }] of Object.entries(stats)) {
    for (let i = 1; i < times.length; i++) {
      if (times[i] <= times[i - 1]) {
        anomalies.push({
          topic,
          kind: 'non-monotonic-stamp',
          atNs: times[i],
          detail: `msg[${i}] t=${times[i].toFixed(0)} ns <= msg[${i - 1}] t=${times[i - 1].toFixed(0)} ns`,
        });
      }
    }
  }
  return anomalies;
}

export interface AutoMark {
  id: string;
  /** Bag-local time (ns, same coordinate space as BagSummary.startTime). Alignment is applied at render. */
  localNs: bigint;
  label: string;
  kind: 'gap' | 'non-monotonic-stamp';
  /** Larger is more severe; used to pick survivors when capping. */
  weight: number;
}

export const MAX_AUTO_MARKS = 200;
/** Marks closer together than this merge into one, so a burst reads as a single tick. */
export const AUTO_MARK_MERGE_NS = 250_000_000;

/**
 * Turn health gaps and non-monotonic stamps into timeline marks.
 *
 * `stats` times are ns since bag start, so `bagStartNs` rebases them to
 * bag-local absolute time. Bursts are merged and the total is capped
 * (keeping the most severe) because a corrupt bag can have one anomaly per
 * message and thousands of ticks would be unreadable and slow to render.
 */
export function buildAutoMarks(
  bagId: string,
  bagStartNs: bigint,
  gaps: Array<{ topic: string; atNs: number; gapSec: number }>,
  nonMonotonic: Anomaly[],
  max = MAX_AUTO_MARKS,
): AutoMark[] {
  const raw: Array<Omit<AutoMark, 'id'>> = [];
  for (const g of gaps) {
    raw.push({
      localNs: bagStartNs + BigInt(Math.round(g.atNs)),
      label: `Gap ${g.gapSec.toFixed(2)} s on ${g.topic}`,
      kind: 'gap',
      weight: g.gapSec,
    });
  }
  for (const a of nonMonotonic) {
    raw.push({
      localNs: bagStartNs + BigInt(Math.round(a.atNs)),
      label: `Out-of-order stamp on ${a.topic}`,
      kind: 'non-monotonic-stamp',
      weight: 0.001,
    });
  }
  raw.sort((a, b) => (a.localNs < b.localNs ? -1 : a.localNs > b.localNs ? 1 : 0));

  const merged: Array<Omit<AutoMark, 'id'> & { count: number }> = [];
  for (const m of raw) {
    const last = merged[merged.length - 1];
    if (last && m.localNs - last.localNs < BigInt(AUTO_MARK_MERGE_NS)) {
      last.count += 1;
      // Keep the most severe event's label and weight.
      if (m.weight > last.weight) {
        last.label = m.label;
        last.kind = m.kind;
        last.weight = m.weight;
      }
    } else {
      merged.push({ ...m, count: 1 });
    }
  }

  const kept = merged.length > max ? [...merged].sort((a, b) => b.weight - a.weight).slice(0, max) : merged;
  kept.sort((a, b) => (a.localNs < b.localNs ? -1 : a.localNs > b.localNs ? 1 : 0));
  return kept.map((m, i) => ({
    id: `auto-${bagId}-${i}`,
    localNs: m.localNs,
    label: m.count > 1 ? `${m.label} (+${m.count - 1} nearby)` : m.label,
    kind: m.kind,
    weight: m.weight,
  }));
}
