import { describe, expect, it } from 'vitest';
import {
  buildSegments,
  defaultStateFields,
  isStateScalarType,
  readScalar,
  scalarFieldPaths,
  segmentIndexAt,
  stateColor,
  stateLabel,
  transitionCount,
} from '../../src/utils/stateSegments';

describe('buildSegments', () => {
  it('merges runs and ends each segment where the next state begins', () => {
    const segs = buildSegments([0, 1, 2, 3, 4], ['a', 'a', 'b', 'b', 'a'], 6);
    expect(segs).toEqual([
      { start: 0, end: 2, value: 'a', count: 2 },
      { start: 2, end: 4, value: 'b', count: 2 },
      { start: 4, end: 6, value: 'a', count: 1 },
    ]);
    expect(transitionCount(segs)).toBe(2);
  });

  it('tiles the axis with no gaps', () => {
    const segs = buildSegments([0, 1, 5, 9], [1, 2, 3, 4], 12);
    for (let i = 1; i < segs.length; i++) expect(segs[i]!.start).toBe(segs[i - 1]!.end);
  });

  it('handles one message, a constant stream, and no messages', () => {
    expect(buildSegments([3], ['x'], 10)).toEqual([{ start: 3, end: 10, value: 'x', count: 1 }]);
    expect(buildSegments([0, 1, 2], [true, true, true], 3)).toHaveLength(1);
    expect(buildSegments([], [], 5)).toEqual([]);
  });

  it('keeps flapping values distinct, one segment per change', () => {
    const times = Array.from({ length: 1000 }, (_, i) => i);
    const values = times.map((i) => i % 2 === 0);
    expect(buildSegments(times, values, 1000)).toHaveLength(1000);
  });

  it('compares by value and type: 1, "1" and true are different states', () => {
    const segs = buildSegments([0, 1, 2], [1, '1', true], 3);
    expect(segs.map((s) => s.value)).toEqual([1, '1', true]);
  });

  it('orders non-monotonic stamps first', () => {
    const segs = buildSegments([2, 0, 1], ['c', 'a', 'b'], 3);
    expect(segs.map((s) => s.value)).toEqual(['a', 'b', 'c']);
  });

  it('keeps missing values as their own null state and ignores non-finite times', () => {
    const segs = buildSegments([0, 1, NaN, 2], ['a', null, 'z', 'a'], 3);
    expect(segs.map((s) => s.value)).toEqual(['a', null, 'a']);
  });

  it('never ends a segment before it starts when endTime is early', () => {
    expect(buildSegments([5], ['x'], 1)[0]).toMatchObject({ start: 5, end: 5 });
  });
});

describe('segmentIndexAt', () => {
  const segs = buildSegments([0, 2, 4], ['a', 'b', 'c'], 6);
  it('finds the containing segment, taking the later one at a boundary', () => {
    expect(segmentIndexAt(segs, 1)).toBe(0);
    expect(segmentIndexAt(segs, 2)).toBe(1);
    expect(segmentIndexAt(segs, 5.9)).toBe(2);
    expect(segmentIndexAt(segs, 6)).toBe(2);
  });
  it('returns -1 outside the data', () => {
    expect(segmentIndexAt(segs, -1)).toBe(-1);
    expect(segmentIndexAt(segs, 7)).toBe(-1);
    expect(segmentIndexAt([], 0)).toBe(-1);
  });
});

describe('field discovery', () => {
  it('lists scalar leaves, including strings and booleans that plots skip', () => {
    const msg = {
      header: { stamp: { sec: 1, nanosec: 2 }, frame_id: 'map' },
      mode: 'AUTO',
      armed: true,
      count: 7n,
      ranges: [1, 2, 3],
      nested: { level: 2, tags: ['a', 'b'] },
    };
    expect(scalarFieldPaths(msg)).toEqual([
      'header.stamp.sec', 'header.stamp.nanosec', 'header.frame_id', 'mode', 'armed', 'count', 'nested.level',
    ]);
  });
  it('ignores arrays, typed arrays, nulls, and caps a wide message', () => {
    expect(scalarFieldPaths({ a: new Float64Array(3), b: null, c: [] })).toEqual([]);
    const wide = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`f${i}`, i]));
    expect(scalarFieldPaths(wide).length).toBe(64);
  });
  it('handles a bare scalar message (no prefix)', () => {
    expect(scalarFieldPaths('x')).toEqual([]);
  });
  it('readScalar reads strings, bools, numbers and bigints, and nothing else', () => {
    const m = { s: 'hi', b: false, n: 3, big: 9n, nan: NaN, o: { x: 1 }, arr: [1] };
    expect(readScalar(m, 's')).toBe('hi');
    expect(readScalar(m, 'b')).toBe(false);
    expect(readScalar(m, 'n')).toBe(3);
    expect(readScalar(m, 'big')).toBe(9);
    expect(readScalar(m, 'nan')).toBeNull();
    expect(readScalar(m, 'o')).toBeNull();
    expect(readScalar(m, 'missing.deep')).toBeNull();
    expect(readScalar(m, 'arr[0]')).toBe(1);
    expect(readScalar(null, 'x')).toBeNull();
  });
  it('defaults to a state-like field, skips headers, and shows few lanes', () => {
    expect(defaultStateFields(['data'])).toEqual(['data']);
    expect(defaultStateFields(['header.frame_id', 'status', 'x', 'y', 'z'])).toEqual(['status']);
    expect(defaultStateFields(['header.frame_id', 'a', 'b'])).toEqual(['a', 'b']);
    expect(defaultStateFields(['header.frame_id'])).toEqual(['header.frame_id']);
    expect(defaultStateFields(['p', 'q', 'r', 's'])).toEqual(['p']);
  });
});

describe('type and presentation', () => {
  it('recognises std_msgs scalar carriers in both spellings, not floats', () => {
    for (const t of ['std_msgs/Bool', 'std_msgs/msg/String', 'std_msgs/msg/UInt8', 'std_msgs/Int64', 'std_msgs/msg/Char']) {
      expect(isStateScalarType(t)).toBe(true);
    }
    for (const t of ['std_msgs/msg/Float64', 'std_msgs/msg/Header', 'my_msgs/msg/Bool', 'std_msgs/msg/Int8MultiArray']) {
      expect(isStateScalarType(t)).toBe(false);
    }
  });
  it('colours booleans fixedly and hashes the rest stably', () => {
    expect(stateColor(true)).not.toBe(stateColor(false));
    expect(stateColor('IDLE')).toBe(stateColor('IDLE'));
    expect(stateColor(null)).toBe('#64748b');
    expect(new Set(Array.from({ length: 30 }, (_, i) => stateColor(`s${i}`))).size).toBeGreaterThan(4);
  });
  it('labels every kind of value', () => {
    expect(stateLabel(true)).toBe('true');
    expect(stateLabel(3)).toBe('3');
    expect(stateLabel(null)).toBe('-');
    expect(stateLabel('NAV')).toBe('NAV');
  });
});
