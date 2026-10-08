import { describe, expect, it } from 'vitest';
import { distanceReadout, formatLength, readoutText } from '../../src/components/panels/ThreeDScene/measureTool';

describe('distanceReadout', () => {
  it('measures a 3-4-5 triangle and splits horizontal from vertical', () => {
    const r = distanceReadout({ x: 1, y: 1, z: 0 }, { x: 4, y: 5, z: 12 });
    expect(r.dx).toBe(3);
    expect(r.dy).toBe(4);
    expect(r.dz).toBe(12);
    expect(r.horizontal).toBe(5);
    expect(r.distance).toBe(13);
  });
  it('is symmetric in length and antisymmetric in deltas', () => {
    const a = { x: -2, y: 7, z: 1 };
    const b = { x: 5, y: -1, z: 3 };
    const ab = distanceReadout(a, b);
    const ba = distanceReadout(b, a);
    expect(ab.distance).toBeCloseTo(ba.distance, 12);
    expect(ab.dx).toBe(-ba.dx);
  });
  it('is exactly zero for the same point', () => {
    expect(distanceReadout({ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }).distance).toBe(0);
  });
});

describe('formatLength', () => {
  it('picks a unit that keeps the number readable', () => {
    expect(formatLength(12.345)).toBe('12.35 m');
    expect(formatLength(123.456)).toBe('123.5 m');
    expect(formatLength(0.85)).toBe('85.0 cm');
    expect(formatLength(0.0032)).toBe('3.2 mm');
    expect(formatLength(0)).toBe('0.00 m');
  });
  it('keeps the sign and survives non-finite input', () => {
    expect(formatLength(-2)).toBe('-2.00 m');
    expect(formatLength(NaN)).toBe('n/a');
    expect(formatLength(Infinity)).toBe('n/a');
  });
  it('rolls over at the boundaries rather than printing 100.0 cm', () => {
    expect(formatLength(0.999)).not.toMatch(/^100/);
    expect(formatLength(1)).toBe('1.00 m');
    expect(formatLength(0.9999)).toBe('1.00 m');
  });
});

describe('readoutText', () => {
  it('shows distance, signed deltas and horizontal distance', () => {
    expect(readoutText(distanceReadout({ x: 0, y: 0, z: 0 }, { x: 3, y: -4, z: 0 }))).toBe(
      '5.00 m  (dx +3.00 m, dy -4.00 m, dz +0.00 m; 5.00 m horizontal)',
    );
  });
});
