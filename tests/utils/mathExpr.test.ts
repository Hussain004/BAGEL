import { describe, it, expect } from 'vitest';
import { compileExpr, type CompiledExpr } from '../../src/utils/mathExpr';

function compile(src: string): CompiledExpr {
  const result = compileExpr(src);
  if (typeof result === 'string') throw new Error(`Compile error: ${result}`);
  return result;
}

function eval_(src: string, vars: Record<string, number | null> = {}): number | null {
  return compile(src)(vars);
}

describe('compileExpr - basic arithmetic', () => {
  it('evaluates number literals', () => {
    expect(eval_('42')).toBe(42);
    expect(eval_('3.14')).toBeCloseTo(3.14);
    expect(eval_('1e3')).toBe(1000);
  });

  it('addition and subtraction', () => {
    expect(eval_('2 + 3')).toBe(5);
    expect(eval_('10 - 4')).toBe(6);
    expect(eval_('1 + 2 + 3')).toBe(6);
  });

  it('multiplication and division', () => {
    expect(eval_('3 * 4')).toBe(12);
    expect(eval_('10 / 4')).toBe(2.5);
  });

  it('division by zero yields null', () => {
    expect(eval_('5 / 0')).toBeNull();
  });

  it('operator precedence: * before +', () => {
    expect(eval_('2 + 3 * 4')).toBe(14);
    expect(eval_('(2 + 3) * 4')).toBe(20);
  });

  it('power operator', () => {
    expect(eval_('2^10')).toBe(1024);
    expect(eval_('4^0.5')).toBe(2);
  });

  it('power is right-associative: 2^3^2 = 2^(3^2) = 512', () => {
    expect(eval_('2^3^2')).toBe(512);
  });

  it('unary minus has lower precedence than power: -2^3 = -8', () => {
    expect(eval_('-2^3')).toBe(-8);
  });

  it('unary minus on variable', () => {
    expect(eval_('-x', { x: 5 })).toBe(-5);
  });

  it('double unary minus', () => {
    expect(eval_('--5')).toBe(5);
  });
});

describe('compileExpr - variables', () => {
  it('reads a simple variable', () => {
    expect(eval_('x * 2', { x: 3 })).toBe(6);
  });

  it('reads dot-path variables (flattenNumeric format)', () => {
    expect(eval_('linear.x * 2', { 'linear.x': 2.5 })).toBe(5);
  });

  it('reads bracket-index variables', () => {
    expect(eval_('covariance[0] + 1', { 'covariance[0]': 9 })).toBe(10);
  });

  it('returns null for missing variable', () => {
    expect(eval_('missing_var', {})).toBeNull();
  });

  it('propagates null from variable through arithmetic', () => {
    expect(eval_('x + 1', { x: null })).toBeNull();
    expect(eval_('x * y', { x: 2, y: null })).toBeNull();
  });

  it('computes speed magnitude from two fields', () => {
    const fn = compile('sqrt(vx^2 + vy^2)');
    expect(fn({ vx: 3, vy: 4 })).toBe(5);
  });
});

describe('compileExpr - built-in functions', () => {
  it('sqrt', () => {
    expect(eval_('sqrt(9)')).toBe(3);
    expect(eval_('sqrt(-1)')).toBeNull();
  });

  it('abs', () => {
    expect(eval_('abs(-7)')).toBe(7);
  });

  it('sin / cos', () => {
    expect(eval_('sin(0)')).toBe(0);
    expect(eval_('cos(0)')).toBe(1);
  });

  it('atan2', () => {
    expect(eval_('atan2(1, 1)')).toBeCloseTo(Math.PI / 4);
  });

  it('log returns null for non-positive input', () => {
    expect(eval_('log(0)')).toBeNull();
    expect(eval_('log(-1)')).toBeNull();
    expect(eval_('log(1)')).toBe(0);
  });

  it('exp', () => {
    expect(eval_('exp(0)')).toBe(1);
    expect(eval_('exp(1)')).toBeCloseTo(Math.E);
  });

  it('floor / ceil / round', () => {
    expect(eval_('floor(2.9)')).toBe(2);
    expect(eval_('ceil(2.1)')).toBe(3);
    expect(eval_('round(2.5)')).toBe(3);
  });

  it('min / max variadic', () => {
    expect(eval_('min(3, 1, 2)')).toBe(1);
    expect(eval_('max(3, 1, 2)')).toBe(3);
  });

  it('clamp', () => {
    expect(eval_('clamp(5, 0, 3)')).toBe(3);
    expect(eval_('clamp(-1, 0, 3)')).toBe(0);
    expect(eval_('clamp(2, 0, 3)')).toBe(2);
  });

  it('deg / rad conversion', () => {
    expect(eval_('deg(pi)')).toBeCloseTo(180);
    expect(eval_('rad(180)')).toBeCloseTo(Math.PI);
  });

  it('unknown function returns parse error', () => {
    const result = compileExpr('unknownfn(x)');
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/unknown function/i);
  });
});

describe('compileExpr - constants', () => {
  it('pi and PI', () => {
    expect(eval_('pi')).toBeCloseTo(Math.PI);
    expect(eval_('PI')).toBeCloseTo(Math.PI);
  });

  it('e and E', () => {
    expect(eval_('e')).toBeCloseTo(Math.E);
    expect(eval_('E')).toBeCloseTo(Math.E);
  });
});

describe('compileExpr - error cases', () => {
  it('empty expression returns error string', () => {
    const r = compileExpr('');
    expect(typeof r).toBe('string');
  });

  it('whitespace-only expression returns error string', () => {
    const r = compileExpr('   ');
    expect(typeof r).toBe('string');
  });

  it('unclosed parenthesis returns error string', () => {
    const r = compileExpr('(1 + 2');
    expect(typeof r).toBe('string');
  });

  it('trailing operator returns error string', () => {
    const r = compileExpr('1 +');
    expect(typeof r).toBe('string');
  });

  it('unexpected character returns error string', () => {
    const r = compileExpr('1 @ 2');
    expect(typeof r).toBe('string');
  });
});

describe('compileExpr - non-finite results', () => {
  it('Infinity result yields null', () => {
    expect(eval_('1 / 0')).toBeNull();
  });

  it('NaN result yields null (asin out of range)', () => {
    expect(eval_('asin(2)')).toBeNull();
  });
});
