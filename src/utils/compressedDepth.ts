/**
 * `image_transport`'s `compressed_depth_image_transport` payload format:
 * a 12-byte ConfigHeader (int32 format flag + 2x float32 quantization
 * params) followed by a PNG. See
 * ros-perception/image_transport_plugins compressed_depth_image_transport
 * (compression_common.hpp / codec.cpp) for the reference implementation
 * this mirrors.
 *
 * For 32FC1 depth the PNG carries a quantized 16-bit "inverse depth"
 * disparity that must be dequantized per-pixel via
 * `depthQuantA / (raw - depthQuantB)` (raw == 0 means "no measurement").
 * 16UC1 depth is the raw millimeter value directly, no dequantization.
 *
 * Split out from the ImageViewer panel (rather than inlined there) so the
 * byte-offset and dequantization math - the part with real correctness risk
 * - can be unit-tested without depending on `createImageBitmap`/canvas,
 * which aren't available outside a real browser.
 */

import { decodeGrayscalePng } from './png16';

export interface DecodedDepthImage {
  width: number;
  height: number;
  /** Depth in the encoding's native unit: meters for 32FC1, millimeters for 16UC1. NaN = no measurement. */
  depth: Float32Array;
}

const HEADER_BYTES = 12;

export function decodeCompressedDepthImage(
  data: Uint8Array,
  imageEncoding: string,
): DecodedDepthImage {
  if (data.byteLength <= HEADER_BYTES) {
    throw new Error('Malformed compressedDepth message (missing PNG payload).');
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const depthQuantA = view.getFloat32(4, true);
  const depthQuantB = view.getFloat32(8, true);
  const payload = data.subarray(HEADER_BYTES);

  const png = decodeGrayscalePng(payload);
  const isInverseDepth = imageEncoding.trim().toLowerCase() === '32fc1';

  const depth = new Float32Array(png.width * png.height);
  for (let i = 0; i < depth.length; i++) {
    const raw = png.samples[i]!;
    depth[i] = isInverseDepth ? (raw === 0 ? NaN : depthQuantA / (raw - depthQuantB)) : raw;
  }
  return { width: png.width, height: png.height, depth };
}
