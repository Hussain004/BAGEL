/**
 * Minimal PNG decoder for single-channel (grayscale) 8/16-bit, non-interlaced
 * images - the only variant `compressed_depth_image_transport` ever produces
 * (it always PNG-encodes a single-channel CV_16UC1 or CV_8UC1 mat via
 * OpenCV's `imencode`).
 *
 * Not a general-purpose PNG decoder: RGB/palette/alpha and Adam7 interlacing
 * are rejected rather than silently mis-decoded. This exists purely to
 * recover raw depth samples at full bit precision - browser
 * `createImageBitmap` + canvas readback clamps every channel to 8-bit RGBA,
 * which would corrupt 16-bit depth values before the compressedDepth
 * dequantization math ever saw them.
 */

import { unzlibSync } from 'fflate';

export interface DecodedGrayscalePng {
  width: number;
  height: number;
  bitDepth: 8 | 16;
  /** One sample per pixel, row-major. Uint16Array for 16-bit, Uint8Array for 8-bit. */
  samples: Uint16Array | Uint8Array;
}

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodeGrayscalePng(data: Uint8Array): DecodedGrayscalePng {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (data[i] !== PNG_SIGNATURE[i]) throw new Error('Not a PNG file.');
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatParts: Uint8Array[] = [];

  let offset = 8;
  while (offset + 8 <= data.length) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(
      data[offset + 4],
      data[offset + 5],
      data[offset + 6],
      data[offset + 7],
    );
    const chunkStart = offset + 8;
    if (type === 'IHDR') {
      width = view.getUint32(chunkStart, false);
      height = view.getUint32(chunkStart + 4, false);
      bitDepth = data[chunkStart + 8];
      colorType = data[chunkStart + 9];
      interlace = data[chunkStart + 12];
    } else if (type === 'IDAT') {
      idatParts.push(data.subarray(chunkStart, chunkStart + length));
    } else if (type === 'IEND') {
      break;
    }
    offset = chunkStart + length + 4; // skip the trailing CRC
  }

  if (colorType !== 0) {
    throw new Error(`Unsupported PNG color type ${colorType} (expected grayscale).`);
  }
  if (bitDepth !== 8 && bitDepth !== 16) {
    throw new Error(`Unsupported PNG bit depth ${bitDepth} (expected 8 or 16).`);
  }
  if (interlace !== 0) {
    throw new Error('Interlaced PNG is not supported.');
  }

  let idatLength = 0;
  for (const p of idatParts) idatLength += p.length;
  const idat = new Uint8Array(idatLength);
  let idatOffset = 0;
  for (const p of idatParts) {
    idat.set(p, idatOffset);
    idatOffset += p.length;
  }
  const raw = unzlibSync(idat);

  const bytesPerSample = bitDepth === 16 ? 2 : 1;
  const bpp = bytesPerSample; // single channel
  const stride = width * bytesPerSample;
  const out = new Uint8Array(height * stride);

  let src = 0;
  let prevRowStart = -1;
  for (let y = 0; y < height; y++) {
    const filterType = raw[src];
    src += 1;
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
      const filt = raw[src + x];
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = prevRowStart >= 0 ? out[prevRowStart + x] : 0;
      const c = prevRowStart >= 0 && x >= bpp ? out[prevRowStart + x - bpp] : 0;
      let value: number;
      switch (filterType) {
        case 0: value = filt; break;
        case 1: value = filt + a; break;
        case 2: value = filt + b; break;
        case 3: value = filt + ((a + b) >> 1); break;
        case 4: value = filt + paeth(a, b, c); break;
        default: throw new Error(`Unsupported PNG filter type ${filterType}.`);
      }
      out[rowStart + x] = value & 0xff;
    }
    src += stride;
    prevRowStart = rowStart;
  }

  if (bitDepth === 8) {
    return { width, height, bitDepth: 8, samples: out };
  }

  const samples = new Uint16Array(width * height);
  for (let i = 0; i < samples.length; i++) {
    // PNG stores multi-byte samples big-endian.
    samples[i] = (out[i * 2] << 8) | out[i * 2 + 1];
  }
  return { width, height, bitDepth: 16, samples };
}
