import { describe, expect, it } from 'vitest';
import { DEADZONE, keysToCommand, padToCommand } from '../../src/live/controlInput';

describe('padToCommand', () => {
  it('centre and the dead zone are exactly zero', () => {
    expect(padToCommand(0, 0, 1, 1)).toEqual({ linear: 0, angular: 0 });
    expect(padToCommand(DEADZONE * 0.99, -DEADZONE * 0.99, 1, 1)).toEqual({ linear: 0, angular: 0 });
  });

  it('up is forward, down is back, left is a positive turn', () => {
    expect(padToCommand(0, -1, 0.5, 2)).toEqual({ linear: 0.5, angular: 0 });
    expect(padToCommand(0, 1, 0.5, 2)).toEqual({ linear: -0.5, angular: 0 });
    expect(padToCommand(-1, 0, 0.5, 2)).toEqual({ linear: 0, angular: 2 });
    expect(padToCommand(1, 0, 0.5, 2)).toEqual({ linear: 0, angular: -2 });
  });

  it('speed rises smoothly from the dead zone to the limit and never exceeds it', () => {
    let prev = 0;
    for (let y = -DEADZONE; y >= -1; y -= 0.02) {
      const v = padToCommand(0, y, 1, 1).linear;
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    expect(padToCommand(0, -5, 1, 1).linear).toBe(1); // beyond the rim is the rim
    expect(padToCommand(3, 3, 0.2, 0.4)).toEqual({ linear: -0.2, angular: -0.4 });
  });

  it('non-finite input is zero', () => {
    expect(padToCommand(NaN, Infinity, 1, 1)).toEqual({ linear: 0, angular: 0 });
  });
});

describe('keysToCommand', () => {
  const k = (...keys: string[]) => keysToCommand(new Set(keys), 0.2, 0.5);
  it('maps WASD and arrows', () => {
    expect(k('w')).toEqual({ linear: 0.2, angular: 0 });
    expect(k('arrowdown')).toEqual({ linear: -0.2, angular: 0 });
    expect(k('a')).toEqual({ linear: 0, angular: 0.5 });
    expect(k('arrowright')).toEqual({ linear: 0, angular: -0.5 });
    expect(k('w', 'a')).toEqual({ linear: 0.2, angular: 0.5 });
  });
  it('opposite keys cancel, other keys do nothing, nothing held is zero', () => {
    expect(k('w', 's')).toEqual({ linear: 0, angular: 0 });
    expect(k('a', 'd')).toEqual({ linear: 0, angular: 0 });
    expect(k('w', 'arrowdown')).toEqual({ linear: 0, angular: 0 });
    expect(k('x', 'q')).toEqual({ linear: 0, angular: 0 });
    expect(k()).toEqual({ linear: 0, angular: 0 });
  });
});
