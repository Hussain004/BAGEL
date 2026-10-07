import { describe, it, expect } from 'vitest';
import {
  autoDepthRange,
  colorizeDepth,
  decodeRawDepth,
  depthColorbarGradient,
  depthUnit,
} from '../../src/utils/depthColor';

function u16le(values: number[]): Uint8Array {
  const buf = new ArrayBuffer(values.length * 2);
  const v = new DataView(buf);
  values.forEach((x, i) => v.setUint16(i * 2, x, true));
  return new Uint8Array(buf);
}

describe('depthUnit', () => {
  it('maps native depth encodings, case-insensitively', () => {
    expect(depthUnit('16UC1')).toBe('mm');
    expect(depthUnit(' 32fc1 ')).toBe('m');
    expect(depthUnit('mono16')).toBeNull();
    expect(depthUnit('rgb8')).toBeNull();
  });
});

describe('decodeRawDepth', () => {
  it('returns null for non-depth encodings', () => {
    expect(decodeRawDepth('rgb8', new Uint8Array(12), 2, 2)).toBeNull();
    expect(decodeRawDepth('mono16', new Uint8Array(8), 2, 2)).toBeNull();
  });

  it('decodes 16UC1 little and big endian', () => {
    const le = u16le([0, 1000, 65535, 42]);
    expect(Array.from(decodeRawDepth('16UC1', le, 2, 2)!)).toEqual([0, 1000, 65535, 42]);
    const be = new Uint8Array(8);
    const v = new DataView(be.buffer);
    [0, 1000, 65535, 42].forEach((x, i) => v.setUint16(i * 2, x, false));
    expect(Array.from(decodeRawDepth('16UC1', be, 2, 2, true)!)).toEqual([0, 1000, 65535, 42]);
  });

  it('decodes 32FC1 including NaN and Infinity', () => {
    const buf = new ArrayBuffer(16);
    const v = new DataView(buf);
    [1.5, NaN, Infinity, 0].forEach((x, i) => v.setFloat32(i * 4, x, true));
    const out = decodeRawDepth('32FC1', new Uint8Array(buf), 2, 2)!;
    expect(out[0]).toBeCloseTo(1.5);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(out[2]).toBe(Infinity);
  });

  it('handles a data view that is not aligned to the sample size', () => {
    // ROS messages often hand out a subarray at an odd byte offset.
    const backing = new Uint8Array(1 + 8 + 3);
    backing.set(u16le([10, 20, 30, 40]), 1);
    const sub = backing.subarray(1, 9);
    expect(Array.from(decodeRawDepth('16UC1', sub, 2, 2)!)).toEqual([10, 20, 30, 40]);
    const f = new Uint8Array(1 + 8);
    new DataView(f.buffer).setFloat32(1, 2.5, true);
    new DataView(f.buffer).setFloat32(5, 3.5, true);
    expect(Array.from(decodeRawDepth('32FC1', f.subarray(1), 2, 1)!)).toEqual([2.5, 3.5]);
  });

  it('throws a clear error on truncated data', () => {
    expect(() => decodeRawDepth('16UC1', new Uint8Array(6), 2, 2)).toThrow(/needs 8/);
  });

  it('tolerates trailing padding bytes', () => {
    expect(decodeRawDepth('16UC1', new Uint8Array(20), 2, 2)!.length).toBe(4);
  });
});

describe('autoDepthRange', () => {
  it('falls back to 0..1 when nothing is valid', () => {
    expect(autoDepthRange([0, NaN, Infinity, -1])).toEqual({ min: 0, max: 1 });
    expect(autoDepthRange([])).toEqual({ min: 0, max: 1 });
  });

  it('excludes invalid pixels from the range', () => {
    const r = autoDepthRange([0, 0, 0, 500, 1500, NaN]);
    expect(r.min).toBe(500);
    expect(r.max).toBe(1500);
  });

  it('ignores a few outliers via percentiles', () => {
    const d = new Float32Array(10000).fill(2000);
    for (let i = 0; i < d.length; i++) d[i] = 1000 + (i % 1000);
    d[0] = 1; // near speckle
    d[1] = 60000; // stray far return
    const r = autoDepthRange(d);
    expect(r.min).toBeGreaterThan(1000);
    expect(r.max).toBeLessThan(2100);
  });

  it('never returns an empty span for a constant image', () => {
    const r = autoDepthRange(new Float32Array(100).fill(3));
    expect(r.max).toBeGreaterThan(r.min);
  });

  it('stays cheap and correct on a large frame', () => {
    const d = new Float32Array(1920 * 1080);
    for (let i = 0; i < d.length; i++) d[i] = 500 + (i % 3000);
    const r = autoDepthRange(d);
    expect(r.min).toBeGreaterThanOrEqual(500);
    expect(r.max).toBeLessThanOrEqual(3500);
  });
});

describe('colorizeDepth', () => {
  it('paints invalid pixels black in every colormap', () => {
    for (const colormap of ['gray', 'turbo', 'turbo-inverted'] as const) {
      const { rgba } = colorizeDepth([0, NaN, 1000, 2000], { colormap });
      expect(Array.from(rgba.slice(0, 8))).toEqual([0, 0, 0, 255, 0, 0, 0, 255]);
    }
  });

  it('gray is bright near and dark far', () => {
    const { rgba } = colorizeDepth([1000, 3000], { colormap: 'gray', min: 1000, max: 3000 });
    expect(rgba[0]).toBe(255);
    expect(rgba[4]).toBe(0);
  });

  it('turbo-inverted swaps the ends of turbo', () => {
    const a = colorizeDepth([1000, 3000], { colormap: 'turbo', min: 1000, max: 3000 }).rgba;
    const b = colorizeDepth([1000, 3000], { colormap: 'turbo-inverted', min: 1000, max: 3000 }).rgba;
    expect(Array.from(a.slice(0, 3))).toEqual(Array.from(b.slice(4, 7)));
    expect(Array.from(a.slice(4, 7))).toEqual(Array.from(b.slice(0, 3)));
  });

  it('clamps values outside an explicit range', () => {
    const { rgba, min, max } = colorizeDepth([10, 99999], { colormap: 'gray', min: 1000, max: 3000 });
    expect([min, max]).toEqual([1000, 3000]);
    expect(rgba[0]).toBe(255);
    expect(rgba[4]).toBe(0);
  });

  it('mixes an explicit end with an auto end, and survives max <= min', () => {
    const r = colorizeDepth([1000, 2000, 3000], { colormap: 'gray', min: 1500 });
    expect(r.min).toBe(1500);
    expect(r.max).toBeGreaterThan(1500);
    const bad = colorizeDepth([1000, 2000], { colormap: 'gray', min: 3000, max: 2000 });
    expect(bad.max).toBeGreaterThan(bad.min);
  });

  it('treats non-finite overrides as auto', () => {
    const r = colorizeDepth([1000, 3000], { colormap: 'gray', min: NaN, max: null });
    expect(r.min).toBe(1000);
  });
});

describe('depthColorbarGradient', () => {
  it('produces a CSS gradient for each colormap', () => {
    for (const c of ['gray', 'turbo', 'turbo-inverted'] as const) {
      expect(depthColorbarGradient(c)).toMatch(/^linear-gradient\(to right, rgb\(/);
    }
  });
});
