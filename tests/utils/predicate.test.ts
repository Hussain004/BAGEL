import { describe, expect, it } from 'vitest';
import {
  PredicateScanner,
  evalPredicate,
  parsePredicateValue,
  type Predicate,
} from '../../src/utils/predicate';
import type { Scalar } from '../../src/utils/stateSegments';

const scan = (p: Predicate, values: Array<Scalar | null>, opts?: ConstructorParameters<typeof PredicateScanner>[1]) => {
  const s = new PredicateScanner(p, opts);
  values.forEach((v, i) => s.push(i, v));
  return s;
};
const times = (s: PredicateScanner) => s.hits.map((h) => h.timeSec);

describe('parsePredicateValue', () => {
  it('reads numbers, booleans and quoted or bare text', () => {
    expect(parsePredicateValue('5')).toBe(5);
    expect(parsePredicateValue(' -0.25 ')).toBe(-0.25);
    expect(parsePredicateValue('1e3')).toBe(1000);
    expect(parsePredicateValue('true')).toBe(true);
    expect(parsePredicateValue('false')).toBe(false);
    expect(parsePredicateValue('"AUTO"')).toBe('AUTO');
    expect(parsePredicateValue("'two words'")).toBe('two words');
    expect(parsePredicateValue('ERROR')).toBe('ERROR');
    expect(parsePredicateValue('')).toBe('');
  });
});

describe('evalPredicate', () => {
  it('compares numbers on the threshold operators and never matches a non-number', () => {
    expect(evalPredicate({ op: '<', value: 20 }, 10, undefined)).toBe(true);
    expect(evalPredicate({ op: '<', value: 20 }, 20, undefined)).toBe(false);
    expect(evalPredicate({ op: '<=', value: 20 }, 20, undefined)).toBe(true);
    expect(evalPredicate({ op: '>', value: 0 }, 'x', undefined)).toBe(false);
    expect(evalPredicate({ op: '>=', value: 'a' }, 5, undefined)).toBe(false);
    expect(evalPredicate({ op: '>', value: 1 }, null, undefined)).toBe(false);
  });
  it('matches equality across a number and its text form', () => {
    expect(evalPredicate({ op: '==', value: 5 }, '5', undefined)).toBe(true);
    expect(evalPredicate({ op: '==', value: true }, true, undefined)).toBe(true);
    expect(evalPredicate({ op: '==', value: 'AUTO' }, 'AUTO', undefined)).toBe(true);
    expect(evalPredicate({ op: '!=', value: 'AUTO' }, 'MANUAL', undefined)).toBe(true);
    expect(evalPredicate({ op: '!=', value: 'AUTO' }, 'AUTO', undefined)).toBe(false);
    expect(evalPredicate({ op: '==', value: 1 }, null, undefined)).toBe(false);
  });
  it('contains is case-insensitive and works on numbers as text', () => {
    expect(evalPredicate({ op: 'contains', value: 'err' }, 'Fatal ERROR', undefined)).toBe(true);
    expect(evalPredicate({ op: 'contains', value: '12' }, 3120, undefined)).toBe(true);
    expect(evalPredicate({ op: 'contains', value: 'x' }, 'abc', undefined)).toBe(false);
  });
  it('changes needs a previous value and ignores a missing one', () => {
    expect(evalPredicate({ op: 'changes', value: null }, 'b', 'a')).toBe(true);
    expect(evalPredicate({ op: 'changes', value: null }, 'a', 'a')).toBe(false);
    expect(evalPredicate({ op: 'changes', value: null }, 'a', undefined)).toBe(false);
    expect(evalPredicate({ op: 'changes', value: null }, 'a', null)).toBe(false);
  });
});

describe('PredicateScanner', () => {
  it('reports only the rising edge of a threshold by default', () => {
    const s = scan({ op: '<', value: 20 }, [50, 30, 19, 18, 17, 25, 15, 14]);
    expect(times(s)).toEqual([2, 6]);
  });

  it('a noisy signal around the threshold gives one hit per crossing, not thousands', () => {
    const values = Array.from({ length: 10_000 }, (_, i) => (i < 5000 ? 10 + (i % 3) : 90));
    expect(times(scan({ op: '<', value: 20 }, values))).toEqual([0]);
  });

  it('can report every matching sample when edges are off', () => {
    const s = scan({ op: '<', value: 20 }, [50, 19, 18, 25], { edge: false });
    expect(times(s)).toEqual([1, 2]);
  });

  it('finds each state change', () => {
    const s = scan({ op: 'changes', value: null }, ['A', 'A', 'B', 'B', 'A', 'A', 'C']);
    expect(times(s)).toEqual([2, 4, 6]);
    expect(s.hits.map((h) => h.value)).toEqual(['B', 'A', 'C']);
  });

  it('does not treat a message missing the field as a change', () => {
    const s = scan({ op: 'changes', value: null }, ['A', null, 'A', null, 'B']);
    expect(times(s)).toEqual([4]);
  });

  it('a gap does not re-arm the edge', () => {
    const s = scan({ op: '<', value: 20 }, [10, null, 10, 50, 10]);
    expect(times(s)).toEqual([0, 4]);
  });

  it('finds a text value and a boolean', () => {
    expect(times(scan({ op: '==', value: 'ERROR' }, ['OK', 'OK', 'ERROR', 'ERROR', 'OK', 'ERROR']))).toEqual([2, 5]);
    expect(times(scan({ op: '==', value: true }, [false, true, true, false, true]))).toEqual([1, 4]);
  });

  it('caps the hits, flags truncation, and keeps counting samples', () => {
    const s = scan({ op: 'changes', value: null }, Array.from({ length: 100 }, (_, i) => i), { maxHits: 10 });
    expect(s.hits).toHaveLength(10);
    expect(s.truncated).toBe(true);
    expect(s.scanned).toBe(100);
  });

  it('is empty and not truncated when nothing matches', () => {
    const s = scan({ op: '>', value: 1000 }, [1, 2, 3]);
    expect(s.hits).toEqual([]);
    expect(s.truncated).toBe(false);
  });

  it('survives a million samples quickly', () => {
    const s = new PredicateScanner({ op: '<', value: 0 });
    for (let i = 0; i < 1_000_000; i++) s.push(i, Math.sin(i / 1000));
    expect(s.scanned).toBe(1_000_000);
    expect(s.hits.length).toBeGreaterThan(100);
  });
});
