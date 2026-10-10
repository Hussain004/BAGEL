import { describe, expect, it } from 'vitest';
import { cssColor, isImageAnnotationsType, MAX_SHAPES, parseImageAnnotations, type Circle, type Label, type Poly } from '../../src/utils/imageAnnotations';

const red = { r: 1, g: 0, b: 0, a: 1 };
const clear = { r: 0, g: 0, b: 0, a: 0 };
const T = (sec: number, nsec = 0) => ({ sec, nsec });

describe('cssColor', () => {
  it('scales 0 to 1 components to 0 to 255 and keeps alpha', () => {
    expect(cssColor({ r: 1, g: 0.5, b: 0, a: 0.25 })).toBe('rgba(255, 128, 0, 0.250)');
  });
  it('transparent, missing and malformed colours are none; out-of-range is clamped', () => {
    expect(cssColor(clear)).toBeNull();
    expect(cssColor(undefined)).toBeNull();
    expect(cssColor('red')).toBeNull();
    expect(cssColor({ r: 9, g: -1, b: NaN, a: 7 })).toBe('rgba(255, 0, 0, 1.000)');
    expect(cssColor({ r: 1, g: 1, b: 1 })).toBe('rgba(255, 255, 255, 1.000)'); // alpha defaults to opaque
  });
});

describe('parseImageAnnotations', () => {
  it('knows its type', () => {
    expect(isImageAnnotationsType('foxglove.ImageAnnotations')).toBe(true);
    expect(isImageAnnotationsType('foxglove.SceneUpdate')).toBe(false);
  });

  it('reads circles, polylines, points and text', () => {
    const p = parseImageAnnotations({
      circles: [{ timestamp: T(5, 100), position: { x: 10, y: 20 }, diameter: 30, thickness: 2, fill_color: clear, outline_color: red }],
      points: [
        { timestamp: T(5), type: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], outline_color: red, thickness: 3 },
        { timestamp: T(6), type: 'LINE_LOOP', points: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], fill_color: { r: 0, g: 1, b: 0, a: 0.5 }, outline_color: red },
        { type: 4, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], outline_color: red },
        { type: 1, points: [{ x: 7, y: 7 }], outline_colors: [red], outline_color: clear },
      ],
      texts: [{ timestamp: T(7), position: { x: 5, y: 6 }, text: 'car', font_size: 14, text_color: red, background_color: { r: 0, g: 0, b: 0, a: 0.5 } }],
    });
    expect(p.shapes.map((s) => s.kind)).toEqual(['circle', 'strip', 'loop', 'list', 'points', 'text']);
    const circle = p.shapes[0] as Circle;
    expect(circle).toMatchObject({ x: 10, y: 20, diameter: 30, thickness: 2, fill: null });
    expect(circle.outline).toBe('rgba(255, 0, 0, 1.000)');
    expect((p.shapes[2] as Poly).fill).toBe('rgba(0, 255, 0, 0.500)');
    expect((p.shapes[4] as Poly).outlines).toEqual(['rgba(255, 0, 0, 1.000)']);
    expect(p.shapes[5] as Label).toMatchObject({ text: 'car', fontSize: 14, x: 5, y: 6 });
    // The earliest stamp, exact.
    expect(p.stampNs).toBe(5_000_000_000n);
  });

  it('keeps big stamps exact', () => {
    const p = parseImageAnnotations({ circles: [{ timestamp: T(1_700_000_000, 123_456_789), position: { x: 0, y: 0 }, diameter: 1 }] });
    expect(p.stampNs).toBe(1_700_000_000_123_456_789n);
  });

  it('skips what it cannot draw instead of failing', () => {
    const p = parseImageAnnotations({
      circles: [{ position: { x: 'a', y: 1 }, diameter: 5 }, { diameter: 5 }, null, 'x'],
      points: [{ type: 0, points: [{ x: 1, y: 1 }] }, { type: 3, points: [] }, { type: 3, points: [{ x: NaN, y: 1 }] }, { type: 99, points: [{ x: 1, y: 1 }] }],
      texts: [{ position: { x: 1, y: 1 }, text: '' }, { position: { x: 1, y: 1 } }, { text: 'no position' }],
    });
    expect(p.shapes).toEqual([]);
    expect(p.stampNs).toBeNull();
  });

  it('per-point colours only count when there is one for every point', () => {
    const p = parseImageAnnotations({ points: [{ type: 3, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], outline_colors: [red] }] });
    expect((p.shapes[0] as Poly).outlines).toEqual([]);
  });

  it('empty, null and wrongly shaped messages are empty', () => {
    for (const v of [null, undefined, {}, { circles: 5, points: 'x', texts: {} }]) expect(parseImageAnnotations(v as never).shapes).toEqual([]);
  });

  it('caps the number of shapes', () => {
    const circles = Array.from({ length: MAX_SHAPES + 500 }, (_, i) => ({ position: { x: i, y: 0 }, diameter: 2 }));
    expect(parseImageAnnotations({ circles }).shapes).toHaveLength(MAX_SHAPES);
  });
});
