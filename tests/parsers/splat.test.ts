import { describe, it, expect, beforeEach } from 'vitest';
import { isSplatPly, parseSplat, disposeSplatCache, SPLAT_TYPE } from '../../src/parsers/splat';
import { detectFormat } from '../../src/parsers/core';
import type { BagSource } from '../../src/parsers/source';

function fileSource(bytes: Uint8Array, name: string): BagSource {
  const file = new File([bytes], name, { type: 'application/octet-stream' });
  return { kind: 'file', file };
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function asciiPlyHeader(props: { name: string; type: string }[], rowCount: number): string {
  return [
    'ply',
    'format ascii 1.0',
    `element vertex ${rowCount}`,
    ...props.map((p) => `property ${p.type} ${p.name}`),
    'end_header',
    '',
  ].join('\n');
}

const XYZ_RGB_PROPS = [
  { name: 'x', type: 'float' },
  { name: 'y', type: 'float' },
  { name: 'z', type: 'float' },
  { name: 'red', type: 'uchar' },
  { name: 'green', type: 'uchar' },
  { name: 'blue', type: 'uchar' },
];

// A representative subset of a real INRIA/gsplat-exported splat PLY's vertex
// properties - x/y/z, SH degree-0 color, opacity, anisotropic scale, and a
// rotation quaternion. Real exports also carry f_rest_0..44 (higher SH
// bands) and normals, but any one of f_dc_0/opacity/scale_0/rot_0 alone is
// enough for isSplatPly to key off, so the fixture doesn't need the full set.
const SPLAT_PLY_PROPS = [
  { name: 'x', type: 'float' },
  { name: 'y', type: 'float' },
  { name: 'z', type: 'float' },
  { name: 'nx', type: 'float' },
  { name: 'ny', type: 'float' },
  { name: 'nz', type: 'float' },
  { name: 'f_dc_0', type: 'float' },
  { name: 'f_dc_1', type: 'float' },
  { name: 'f_dc_2', type: 'float' },
  { name: 'opacity', type: 'float' },
  { name: 'scale_0', type: 'float' },
  { name: 'scale_1', type: 'float' },
  { name: 'scale_2', type: 'float' },
  { name: 'rot_0', type: 'float' },
  { name: 'rot_1', type: 'float' },
  { name: 'rot_2', type: 'float' },
  { name: 'rot_3', type: 'float' },
];

function splatPlyRow(): string {
  return SPLAT_PLY_PROPS.map(() => '0.0').join(' ');
}

function xyzRgbRow(): string {
  return '0 0 0 255 0 0';
}

beforeEach(() => disposeSplatCache());

describe('isSplatPly', () => {
  it('recognizes a splat-flavored PLY header (SH color + opacity + scale + rotation)', () => {
    const bytes = encode(asciiPlyHeader(SPLAT_PLY_PROPS, 1) + splatPlyRow() + '\n');
    expect(isSplatPly(bytes)).toBe(true);
  });

  it('does not misclassify a regular colored point-cloud PLY as a splat', () => {
    const bytes = encode(asciiPlyHeader(XYZ_RGB_PROPS, 1) + xyzRgbRow() + '\n');
    expect(isSplatPly(bytes)).toBe(false);
  });

  it('does not misclassify a bare xyz PLY (no color at all) as a splat', () => {
    const bytes = encode(
      asciiPlyHeader(
        [{ name: 'x', type: 'float' }, { name: 'y', type: 'float' }, { name: 'z', type: 'float' }],
        1,
      ) + '0 0 0\n',
    );
    expect(isSplatPly(bytes)).toBe(false);
  });

  it('returns false rather than throwing on garbage input', () => {
    expect(isSplatPly(encode('not a ply file at all'))).toBe(false);
  });

  it('keys off a single distinguishing property (opacity alone, no f_dc/scale/rot)', () => {
    // Some splat exporters (or partial conversions) may only carry a subset
    // of the standard properties - any one of the four is enough to route
    // away from the point-cloud decoder, which would silently drop it.
    const props = [
      { name: 'x', type: 'float' },
      { name: 'y', type: 'float' },
      { name: 'z', type: 'float' },
      { name: 'opacity', type: 'float' },
    ];
    const bytes = encode(asciiPlyHeader(props, 1) + '0 0 0 1.0\n');
    expect(isSplatPly(bytes)).toBe(true);
  });
});

describe('detectFormat - splat routing', () => {
  it('routes a splat-flavored .ply to "splat", not "ply"', async () => {
    const bytes = encode(asciiPlyHeader(SPLAT_PLY_PROPS, 1) + splatPlyRow() + '\n');
    const format = await detectFormat(fileSource(bytes, 'scene.ply'));
    expect(format).toBe('splat');
  });

  it('still routes a regular colored .ply to "ply" (no regression)', async () => {
    const bytes = encode(asciiPlyHeader(XYZ_RGB_PROPS, 1) + xyzRgbRow() + '\n');
    const format = await detectFormat(fileSource(bytes, 'cloud.ply'));
    expect(format).toBe('ply');
  });

  it('routes .splat by extension alone (no ASCII header to sniff)', async () => {
    const bytes = new Uint8Array(32); // one raw antimatter15-format record
    const format = await detectFormat(fileSource(bytes, 'scene.splat'));
    expect(format).toBe('splat');
  });

  it('routes .ksplat by extension alone', async () => {
    const bytes = new Uint8Array(16);
    const format = await detectFormat(fileSource(bytes, 'scene.ksplat'));
    expect(format).toBe('splat');
  });
});

describe('parseSplat', () => {
  it('returns a splat-format summary with one synthetic topic', async () => {
    const bytes = encode(asciiPlyHeader(SPLAT_PLY_PROPS, 3) + `${splatPlyRow()}\n`.repeat(3));
    const summary = await parseSplat(fileSource(bytes, 'scene.ply'));
    expect(summary.format).toBe('splat');
    expect(summary.topics).toHaveLength(1);
    expect(summary.topics[0]).toMatchObject({ name: '/splat', type: SPLAT_TYPE });
  });

  it('reports vertexCount from the PLY header as the splat count', async () => {
    const bytes = encode(asciiPlyHeader(SPLAT_PLY_PROPS, 5) + `${splatPlyRow()}\n`.repeat(5));
    const summary = await parseSplat(fileSource(bytes, 'scene.ply'));
    expect(summary.topics[0].messageCount).toBe(5);
  });

  it('estimates splat count for .splat from file size / 32 bytes per record', async () => {
    const bytes = new Uint8Array(32 * 10); // 10 records
    const summary = await parseSplat(fileSource(bytes, 'scene.splat'));
    expect(summary.topics[0].messageCount).toBe(10);
  });

  it('caches by source and clears on disposeSplatCache', async () => {
    const bytes = encode(asciiPlyHeader(SPLAT_PLY_PROPS, 1) + splatPlyRow() + '\n');
    const source = fileSource(bytes, 'scene.ply');
    const a = await parseSplat(source);
    const b = await parseSplat(source);
    expect(a).toBe(b);
    disposeSplatCache();
    const c = await parseSplat(source);
    expect(c).not.toBe(a);
  });
});
