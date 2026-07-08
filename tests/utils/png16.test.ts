/**
 * Tests for the grayscale 8/16-bit PNG decoder (png16.ts), used to recover
 * full-precision depth samples from `compressed_depth_image_transport`
 * payloads without going through createImageBitmap's 8-bit canvas clamp.
 *
 * Exercises:
 *  - Round-trips a 16-bit grayscale PNG (filter type 0 / None) built by hand.
 *  - Round-trips with Sub/Up/Average/Paeth filters applied per row.
 *  - Round-trips an 8-bit grayscale PNG.
 *  - Rejects non-grayscale color types and interlaced images with a clear error.
 */

import { deflateSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { decodeGrayscalePng } from '../../src/utils/png16';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + 4 + data.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // CRC is unused by the decoder (intentionally not validated); zero-fill.
  return out;
}

function buildIhdr(width: number, height: number, bitDepth: number, interlace = 0): Uint8Array {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  data[8] = bitDepth;
  data[9] = 0; // color type: grayscale
  data[10] = 0; // compression method
  data[11] = 0; // filter method
  data[12] = interlace;
  return data;
}

/** Filter each scanline with `filterTypes[y]` (defaults to None/0 for all rows). */
function buildGrayscalePng(
  width: number,
  height: number,
  bitDepth: 8 | 16,
  samples: number[],
  filterTypes?: number[],
): Uint8Array {
  const bytesPerSample = bitDepth === 16 ? 2 : 1;
  const stride = width * bytesPerSample;

  // Unfiltered scanlines first.
  const unfiltered = new Uint8Array(height * stride);
  for (let i = 0; i < samples.length; i++) {
    if (bitDepth === 16) {
      unfiltered[i * 2] = (samples[i]! >> 8) & 0xff;
      unfiltered[i * 2 + 1] = samples[i]! & 0xff;
    } else {
      unfiltered[i] = samples[i]! & 0xff;
    }
  }

  const bpp = bytesPerSample;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const ftype = filterTypes?.[y] ?? 0;
    raw[y * (stride + 1)] = ftype;
    const rowStart = y * stride;
    const prevRowStart = y > 0 ? (y - 1) * stride : -1;
    for (let x = 0; x < stride; x++) {
      const cur = unfiltered[rowStart + x]!;
      const a = x >= bpp ? unfiltered[rowStart + x - bpp]! : 0;
      const b = prevRowStart >= 0 ? unfiltered[prevRowStart + x]! : 0;
      const c = prevRowStart >= 0 && x >= bpp ? unfiltered[prevRowStart + x - bpp]! : 0;
      let filt: number;
      switch (ftype) {
        case 0: filt = cur; break;
        case 1: filt = cur - a; break;
        case 2: filt = cur - b; break;
        case 3: filt = cur - ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          filt = cur - pred;
          break;
        }
        default: throw new Error(`test fixture: unsupported filter ${ftype}`);
      }
      raw[y * (stride + 1) + 1 + x] = filt & 0xff;
    }
  }

  const idat = deflateSync(raw);
  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    chunk('IHDR', buildIhdr(width, height, bitDepth, 0)),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

describe('png16/decodeGrayscalePng', () => {
  it('round-trips a 16-bit grayscale image with no filtering', () => {
    const samples = [0, 4096, 32768, 65535];
    const png = buildGrayscalePng(2, 2, 16, samples);
    const decoded = decodeGrayscalePng(png);
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(decoded.bitDepth).toBe(16);
    expect(Array.from(decoded.samples)).toEqual(samples);
  });

  it('round-trips a 16-bit image using Sub/Up/Average/Paeth filters per row', () => {
    // 4x3: enough rows to exercise every filter type once, values chosen to
    // avoid accidental ties in the byte-wise (not sample-wise) filter math.
    const samples = [
      100, 20000, 300, 40000,
      50000, 12345, 6789, 60000,
      1, 2, 3, 4,
    ];
    const png = buildGrayscalePng(4, 3, 16, samples, [1, 2, 4]);
    const decoded = decodeGrayscalePng(png);
    expect(Array.from(decoded.samples)).toEqual(samples);
  });

  it('round-trips an 8-bit grayscale image', () => {
    const samples = [0, 1, 127, 255, 64, 200];
    const png = buildGrayscalePng(3, 2, 8, samples, [0, 3]);
    const decoded = decodeGrayscalePng(png);
    expect(decoded.bitDepth).toBe(8);
    expect(Array.from(decoded.samples)).toEqual(samples);
  });

  it('rejects a non-grayscale color type', () => {
    const png = buildGrayscalePng(1, 1, 8, [42]);
    // Flip the IHDR color-type byte (offset: signature[8] + IHDR header[8] + colorType[9]).
    const ihdrColorTypeOffset = 8 + 8 + 9;
    const patched = new Uint8Array(png);
    patched[ihdrColorTypeOffset] = 2; // RGB
    expect(() => decodeGrayscalePng(patched)).toThrow(/color type/i);
  });

  it('rejects interlaced images', () => {
    const samples = [1, 2, 3, 4];
    const png = buildGrayscalePng(2, 2, 8, samples);
    const ihdrInterlaceOffset = 8 + 8 + 12;
    const patched = new Uint8Array(png);
    patched[ihdrInterlaceOffset] = 1; // Adam7
    expect(() => decodeGrayscalePng(patched)).toThrow(/interlac/i);
  });

  it('rejects data that is not a PNG', () => {
    expect(() => decodeGrayscalePng(new Uint8Array([1, 2, 3, 4]))).toThrow(/not a png/i);
  });
});
