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
