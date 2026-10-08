/**
 * Gaussian splat format detection + lightweight summary.
 *
 * BAGEL treats splat files (splat-flavored `.ply`, `.splat`, `.ksplat`, `.spz`) as a
 * standalone format, same tier as `.pcd`/`.ply`, but rendered by the
 * SplatViewer panel through `@mkkellogg/gaussian-splats-3d` rather than
 * BAGEL's own point-cloud decoder. That decoder only understands positions +
 * packed RGB (`PointCloudExtraction`), it has no room for per-splat opacity,
 * scale, rotation, or spherical-harmonics color, so splats need a completely
 * different render path, not a variant of the point-cloud one.
 *
 * This module only detects the format and reports a cheap best-effort splat
 * count for the topic list. It never decodes splat data - the SplatViewer
 * panel hands the raw file/URL straight to the gaussian-splats-3d library,
 * which does its own parsing, sorting, and rendering off-thread.
 */

import { Gunzip } from 'fflate';
import type { BagSummary } from '../types/bag';
import { parsePlyHeader } from './ply';
import { sourceDisplayName, sourceKey, sourceReadSlice, sourceSize, type SingleBagSource } from './source';

/** Synthetic topic type for the one splat "topic" a summary reports. */
export const SPLAT_TYPE = 'gaussian/GaussianSplat';

/** Byte size of one record in the antimatter15 `.splat` format (pos+scale+rgba+quantized rot). */
const SPLAT_RECORD_BYTES = 32;

const splatSummaryCache = new Map<string, BagSummary>();

/**
 * A splat-PLY carries SH color / opacity / scale / rotation properties that
 * a plain colored point-cloud PLY never has. Any one of them is enough to
 * tell the two apart - real splat exporters (INRIA, gsplat, Postshot, etc.)
 * always emit the full set together.
 */
export function isSplatPly(bytes: Uint8Array): boolean {
  try {
    const header = parsePlyHeader(bytes);
    return header.props.some((p) => p.name === 'f_dc_0' || p.name === 'opacity' || p.name === 'scale_0' || p.name === 'rot_0');
  } catch {
    return false;
  }
}

/**
 * How much of an `.spz` to read for its count. A stored (level 0) gzip block can
 * be 64 KB and inflates only once whole, so 4 KB is not enough for those.
 */
const SPZ_HEAD_BYTES = 128 * 1024;

/**
 * Point count of an `.spz`: a gzip stream whose decompressed header is
 * `magic u32, version u32, numPoints u32, ...`. Only the head of the file is
 * inflated (streaming, so a truncated input still yields its first bytes).
 */
export function spzPointCount(head: Uint8Array): number | undefined {
  const out = new Uint8Array(12);
  let got = 0;
  try {
    const gz = new Gunzip((chunk) => {
      const n = Math.min(chunk.length, out.length - got);
      out.set(chunk.subarray(0, n), got);
      got += n;
    });
    gz.push(head, false);
  } catch {
    return undefined;
  }
  if (got < 12) return undefined;
  const view = new DataView(out.buffer);
  // 'NGSP' little-endian: anything else is gzip of something that is not a splat.
  return view.getUint32(0, true) === 0x5053474e ? view.getUint32(8, true) : undefined;
}

/** Best-effort splat count without decoding: cheap for `.splat`, header-only for splat-PLY, unknown for `.ksplat`. */
async function estimateSplatCount(source: SingleBagSource): Promise<number | undefined> {
  const name = sourceDisplayName(source).toLowerCase();
  if (name.endsWith('.splat')) {
    return Math.floor(sourceSize(source) / SPLAT_RECORD_BYTES);
  }
  if (name.endsWith('.ply')) {
    const head = await sourceReadSlice(source, 0, 8192);
    try {
      return parsePlyHeader(head).vertexCount;
    } catch {
      return undefined;
    }
  }
  if (name.endsWith('.spz')) return spzPointCount(await sourceReadSlice(source, 0, SPZ_HEAD_BYTES));
  // .ksplat has its own compressed section-header layout; not worth
  // parsing just to report a count in the topic list.
  return undefined;
}

export async function parseSplat(source: SingleBagSource): Promise<BagSummary> {
  const key = sourceKey(source);
  const cached = splatSummaryCache.get(key);
  if (cached) return cached;

  const splatCount = await estimateSplatCount(source);

  const summary: BagSummary = {
    format: 'splat',
    fileName: sourceDisplayName(source),
    fileSize: sourceSize(source),
    startTime: 0n,
    endTime: 1_000_000n,
    duration: 0.001,
    totalMessageCount: 1,
    topics: [
      {
        name: '/splat',
        type: SPLAT_TYPE,
        messageCount: splatCount ?? 1,
        serializationFormat: 'splat',
        frequency: undefined,
      },
    ],
  };

  splatSummaryCache.set(key, summary);
  return summary;
}

export function disposeSplatCache(): void {
  splatSummaryCache.clear();
}
