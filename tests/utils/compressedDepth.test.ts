/**
 * Tests for the compressed_depth_image_transport decoder (compressedDepth.ts).
 *
 * Exercises:
 *  - 16UC1: raw PNG samples pass through unchanged as millimeter depth.
 *  - 32FC1: raw PNG samples are dequantized via depthQuantA/(raw-depthQuantB).
 *  - 32FC1: a raw sample of 0 (no measurement) decodes to NaN, not 0m.
 *  - Malformed (too-short) payloads throw rather than reading garbage.
 */

import { deflateSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import { decodeCompressedDepthImage } from '../../src/utils/compressedDepth';

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + 4 + data.length + 4);
  new DataView(out.buffer).setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out;
}

/** Build a minimal, unfiltered (filter type 0) 16-bit grayscale PNG. */
function build16BitPng(width: number, height: number, samples: number[]): Uint8Array {
  const stride = width * 2;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const s = samples[y * width + x]!;
      raw[y * (stride + 1) + 1 + x * 2] = (s >> 8) & 0xff;
      raw[y * (stride + 1) + 1 + x * 2 + 1] = s & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const iview = new DataView(ihdr.buffer);
  iview.setUint32(0, width, false);
  iview.setUint32(4, height, false);
  ihdr[8] = 16; // bit depth
  ihdr[9] = 0; // color type: grayscale

  const idat = deflateSync(raw);
  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Prepend the 12-byte ConfigHeader (format flag + depthQuantA/B) used by compressed_depth_image_transport. */
function withConfigHeader(png: Uint8Array, depthQuantA: number, depthQuantB: number): Uint8Array {
  const header = new Uint8Array(12);
  const view = new DataView(header.buffer);
  view.setInt32(0, 0, true); // format: INV_DEPTH (unused by the decoder, ROS writes it regardless)
  view.setFloat32(4, depthQuantA, true);
  view.setFloat32(8, depthQuantB, true);
  const out = new Uint8Array(header.length + png.length);
  out.set(header, 0);
  out.set(png, header.length);
  return out;
}

describe('compressedDepth/decodeCompressedDepthImage', () => {
  it('16UC1: passes raw samples through as millimeter depth (no dequantization)', () => {
    const samples = [0, 500, 1000, 65535];
    const png = build16BitPng(2, 2, samples);
    const message = withConfigHeader(png, 0, 0); // quant params are unused for 16UC1
    const decoded = decodeCompressedDepthImage(message, '16UC1');
    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(Array.from(decoded.depth)).toEqual(samples);
  });

  it('32FC1: dequantizes via depthQuantA / (raw - depthQuantB)', () => {
    const depthQuantA = 100;
    const depthQuantB = -1;
    const raw = [50, 200, 1000];
    // Pad to a rectangular 3x1 image.
    const png = build16BitPng(3, 1, raw);
    const message = withConfigHeader(png, depthQuantA, depthQuantB);
    const decoded = decodeCompressedDepthImage(message, '32FC1');
    const expected = raw.map((r) => depthQuantA / (r - depthQuantB));
    for (let i = 0; i < expected.length; i++) {
      expect(decoded.depth[i]).toBeCloseTo(expected[i]!, 4);
    }
  });

  it('32FC1: a raw sample of 0 (no measurement) decodes to NaN', () => {
    const png = build16BitPng(1, 1, [0]);
    const message = withConfigHeader(png, 100, 0);
    const decoded = decodeCompressedDepthImage(message, '32FC1');
    expect(Number.isNaN(decoded.depth[0])).toBe(true);
  });

  it('is case-insensitive on the image encoding token', () => {
    const png = build16BitPng(1, 1, [42]);
    const message = withConfigHeader(png, 0, 0);
    const decoded = decodeCompressedDepthImage(message, '16uc1');
    expect(decoded.depth[0]).toBe(42);
  });

  it('rejects a payload too short to contain the ConfigHeader + PNG', () => {
    expect(() => decodeCompressedDepthImage(new Uint8Array(5), '16UC1')).toThrow(/malformed/i);
  });
});
