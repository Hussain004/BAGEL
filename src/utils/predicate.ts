/**
 * "Find when ...": a predicate over one scalar field of a message stream.
 *
 * Scrubbing a recording by eye to find the moment `battery < 20%` or `mode`
 * changed is the slowest part of debugging a bag. A predicate is plain data
 * (`{ path, op, value }`), evaluated incrementally by `PredicateScanner` as
 * decoded batches arrive, so the same code serves a streaming scan and tests.
 *
 * Pure and DOM-free.
 */

import type { Scalar } from './stateSegments';

export type PredicateOp = '<' | '<=' | '>' | '>=' | '==' | '!=' | 'contains' | 'changes';

export const PREDICATE_OPS: ReadonlyArray<{ op: PredicateOp; label: string; needsValue: boolean }> = [
  { op: '<', label: 'is below', needsValue: true },
  { op: '<=', label: 'is at most', needsValue: true },
  { op: '>', label: 'is above', needsValue: true },
  { op: '>=', label: 'is at least', needsValue: true },
  { op: '==', label: 'equals', needsValue: true },
  { op: '!=', label: 'does not equal', needsValue: true },
  { op: 'contains', label: 'contains text', needsValue: true },
  { op: 'changes', label: 'changes', needsValue: false },
];

export interface Predicate {
  op: PredicateOp;
  value: Scalar | null;
}

export interface Hit {
  /** Seconds on the caller's axis (the panel uses seconds from bag start). */
  timeSec: number;
  value: Scalar | null;
}

/**
 * Turn what the user typed into a value of the right type: a number if it
 * reads as one, a boolean for true/false, otherwise the text (surrounding
 * quotes stripped). Typing `5` must compare numerically and `true` must match
 * a boolean field, or `==` would silently never match.
 */
export function parsePredicateValue(text: string): Scalar {
  const t = text.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t !== '' && Number.isFinite(Number(t))) return Number(t);
  const quoted = /^(["'])(.*)\1$/.exec(t);
  return quoted ? quoted[2]! : t;
}

/** Whether `current` satisfies the predicate. Type mismatches simply do not match. */
export function evalPredicate(p: Predicate, current: Scalar | null, previous: Scalar | null | undefined): boolean {
  if (current === null) return false;
  switch (p.op) {
    case 'changes':
      // The first sample has nothing to differ from.
      return previous !== undefined && previous !== null && previous !== current;
    case 'contains':
      return p.value !== null && String(current).toLowerCase().includes(String(p.value).toLowerCase());
    case '==':
      return p.value !== null && (current === p.value || String(current) === String(p.value));
    case '!=':
      return p.value !== null && !(current === p.value || String(current) === String(p.value));
    default: {
      if (typeof current !== 'number' || typeof p.value !== 'number') return false;
      if (p.op === '<') return current < p.value;
      if (p.op === '<=') return current <= p.value;
      if (p.op === '>') return current > p.value;
      return current >= p.value;
    }
  }
}

export interface ScannerOptions {
  /**
   * Report only the samples where the predicate BECOMES true (default). A noisy
   * signal hovering around a threshold otherwise yields thousands of hits for
   * one real event. `changes` is inherently an edge, so it ignores this.
   */
  edge?: boolean;
  /** Stop recording after this many hits (the scan still counts samples). */
  maxHits?: number;
}

export const DEFAULT_MAX_HITS = 10_000;

export class PredicateScanner {
  readonly hits: Hit[] = [];
  /** True once `maxHits` was reached and later matches were dropped. */
  truncated = false;
  scanned = 0;
  private prev: Scalar | null | undefined = undefined;
  private wasTrue = false;
  private readonly predicate: Predicate;
  private readonly edge: boolean;
  private readonly maxHits: number;

  constructor(predicate: Predicate, opts: ScannerOptions = {}) {
    this.predicate = predicate;
    this.edge = opts.edge ?? true;
    this.maxHits = opts.maxHits ?? DEFAULT_MAX_HITS;
  }

  /** Feed the next sample, in time order. Returns whether it was recorded as a hit. */
  push(timeSec: number, value: Scalar | null): boolean {
    this.scanned++;
    const match = evalPredicate(this.predicate, value, this.prev);
    const fire = this.predicate.op === 'changes' ? match : this.edge ? match && !this.wasTrue : match;
    // A missing value leaves the held state alone: a message that merely lacks
    // the field must neither look like a change away from the real value nor
    // re-arm the edge so the same crossing reports twice.
    if (value !== null) {
      this.wasTrue = match;
      this.prev = value;
    }
    if (!fire) return false;
    if (this.hits.length >= this.maxHits) {
      this.truncated = true;
      return false;
    }
    this.hits.push({ timeSec, value });
    return true;
  }
}
