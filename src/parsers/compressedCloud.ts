/**
 * `point_cloud_interfaces/msg/CompressedPointCloud2`, as written by
 * point_cloud_transport_plugins: the PointCloud2 fields, sizes and header,
 * with `data` compressed into `compressed_data` and the plugin named in
 * `format`. The zstd plugin compresses the raw bytes one-shot; the "zlib"
 * plugin actually writes gzip framing (windowBits + 16), and its own
 * subscriber accepts either, so both are accepted here.
 *
 * Draco is a different codec (attributes are re-encoded and quantized, not
 * the raw bytes) and is refused with a clear message for now.
 */

import { decompressSync } from 'fflate';
import { decompress as zstdDecompress } from 'fzstd';
import type { PointCloud2Message } from '../utils/pointcloud';

export function isCompressedPointCloud2Type(type: string): boolean {
  return type.endsWith('/CompressedPointCloud2');
}

/** True for a decoded message with the CompressedPointCloud2 shape. */
export function isCompressedCloudValue(v: unknown): v is Record<string, unknown> {
  const o = v as Record<string, unknown> | null;
  return !!o && Array.isArray(o.fields) && 'compressed_data' in o && typeof o.format === 'string';
}

function bytesOf(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  if (typeof v === 'string') return Uint8Array.from(atob(v), (c) => c.charCodeAt(0)); // JSON-encoded bytes
  throw new Error('CompressedPointCloud2 has no compressed_data bytes');
}

/** The PointCloud2 a CompressedPointCloud2 stands for. Throws on an unknown or unsupported format. */
export function decompressCloud(msg: Record<string, unknown>): PointCloud2Message {
  const format = String(msg.format).trim().toLowerCase();
  const packed = bytesOf(msg.compressed_data);
  let data: Uint8Array;
  if (format.includes('zstd')) {
    data = zstdDecompress(packed);
  } else if (format.includes('zlib') || format.includes('gzip') || format.includes('deflate')) {
    data = decompressSync(packed); // gzip, zlib or raw deflate, by its header
  } else if (format.includes('draco')) {
    throw new Error('Draco-compressed point clouds are not supported yet (zstd and zlib are).');
  } else {
    throw new Error(`Unknown CompressedPointCloud2 format "${msg.format}" (expected zstd, zlib or draco).`);
  }
  const width = Number(msg.width ?? 0);
  const height = Number(msg.height ?? 1);
  const pointStep = Number(msg.point_step ?? 0);
  const need = width * height * pointStep;
  if (data.length < need) {
    throw new Error(`CompressedPointCloud2 decompressed to ${data.length} bytes, but ${width}x${height} points of ${pointStep} bytes need ${need}.`);
  }
  return { ...(msg as PointCloud2Message), data };
}
