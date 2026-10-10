/**
 * Walk a time range of an image topic in bounded batches and write each frame
 * (and, optionally, the nearest point cloud) into one zip with a `frames.csv`
 * that ties every file to its time and labels.
 *
 * Readers are injected, so the same code runs against the real parser worker in
 * the app and against in-memory fakes in tests.
 */

import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import type { RangeParams, RangeResult } from '../parsers/range';
import {
  UnsupportedImage,
  framesToCsv,
  headerStampNs,
  imageMessageToFile,
  topicFolder,
  writePcd,
  type CloudForPcd,
  type FrameRow,
} from './frameExport';

type Message = { timestamp: bigint; value: Record<string, unknown> | null };

export interface FrameExportOptions {
  imageTopic: string;
  /** Pair each frame with the nearest cloud on this topic; null for images only. */
  cloudTopic: string | null;
  /** Range on the bag's own clock, inclusive. */
  startNs: bigint;
  endNs: bigint;
  /** Take every Nth image. */
  stride: number;
  /** Stop after this many frames. */
  maxFrames: number;
  /** A cloud further than this from its frame is not paired. */
  maxCloudGapNs: bigint;
  /** Labels (bag clock) whose names go in each frame's `label` column. */
  labels: ReadonlyArray<{ label: string; startNs: bigint; endNs: bigint }>;
}

export interface FrameExportDeps {
  readRange(topic: string, params: RangeParams): Promise<RangeResult>;
  readAt(topic: string, timeNs: bigint): Promise<Message | null>;
  decodeCloud(value: Record<string, unknown>): CloudForPcd | null;
}

export interface FrameExportProgress {
  frames: number;
  clouds: number;
  bytes: number;
}

export interface FrameExportResult extends FrameExportProgress {
  blob: Blob;
  /** Why some frames were left out (first few distinct reasons, with counts). */
  skipped: Array<{ reason: string; count: number }>;
  /** The run stopped at a limit before the range ended. */
  truncated: 'frames' | 'size' | null;
}

/** About 2 GiB: beyond this a browser tab struggles to hold the zip. */
export const MAX_EXPORT_BYTES = 2 * 1024 ** 3;
const BATCH = 8;

export class ExportAborted extends Error {
  constructor() {
    super('Export cancelled');
  }
}

export async function runFrameExport(
  opts: FrameExportOptions,
  deps: FrameExportDeps,
  onProgress: (p: FrameExportProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<FrameExportResult> {
  const parts: Uint8Array[] = [];
  let zipError: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) zipError = err;
    else parts.push(chunk);
  });
  const addStored = (name: string, bytes: Uint8Array) => {
    const f = new ZipPassThrough(name);
    zip.add(f);
    f.push(bytes, true);
  };
  const addDeflated = (name: string, bytes: Uint8Array) => {
    const f = new ZipDeflate(name, { level: 6 });
    zip.add(f);
    f.push(bytes, true);
  };

  const imageDir = topicFolder(opts.imageTopic);
  const cloudDir = opts.cloudTopic ? topicFolder(opts.cloudTopic) : '';
  const rows: FrameRow[] = [];
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  const usedNames = new Set<string>();

  let frames = 0;
  let clouds = 0;
  let bytes = 0;
  let truncated: FrameExportResult['truncated'] = null;
  let lastCloud = null as { ts: bigint; file: string } | null;

  let start: bigint | null = opts.startNs;
  let phase = 0;
  outer: while (start !== null) {
    if (signal?.aborted) throw new ExportAborted();
    const batch: RangeResult = await deps.readRange(opts.imageTopic, {
      startNs: start,
      endNs: opts.endNs,
      stride: opts.stride,
      phase,
      max: Math.min(BATCH, opts.maxFrames - frames),
    });

    for (const m of batch.messages) {
      if (signal?.aborted) throw new ExportAborted();
      if (!m.value) {
        skip('the image could not be decoded');
        continue;
      }
      let file;
      try {
        file = imageMessageToFile(m.value);
      } catch (e) {
        if (e instanceof UnsupportedImage) {
          skip(e.message);
          continue;
        }
        throw e;
      }
      let name = `${imageDir}/${m.timestamp}.${file.ext}`;
      for (let n = 1; usedNames.has(name); n++) name = `${imageDir}/${m.timestamp}_${n}.${file.ext}`;
      usedNames.add(name);
      addStored(name, file.bytes);
      bytes += file.bytes.length;
      frames++;

      let cloudFile = '';
      let cloudDt = '';
      if (opts.cloudTopic) {
        const near = await deps.readAt(opts.cloudTopic, m.timestamp);
        const gap = near ? near.timestamp - m.timestamp : 0n;
        if (near?.value && (gap < 0n ? -gap : gap) <= opts.maxCloudGapNs) {
          if (lastCloud?.ts === near.timestamp) {
            cloudFile = lastCloud.file;
          } else {
            const cloud = deps.decodeCloud(near.value);
            if (cloud) {
              cloudFile = `${cloudDir}/${near.timestamp}.pcd`;
              const pcd = writePcd(cloud);
              addDeflated(cloudFile, pcd);
              bytes += pcd.length;
              clouds++;
              lastCloud = { ts: near.timestamp, file: cloudFile };
            } else {
              skip('a point cloud could not be decoded');
            }
          }
          if (cloudFile) cloudDt = gap.toString();
        } else {
          skip('no point cloud close enough to pair');
        }
      }

      rows.push({
        file: name,
        topic: opts.imageTopic,
        timestamp_ns: m.timestamp.toString(),
        header_stamp_ns: headerStampNs(m.value),
        label: opts.labels
          .filter((l) => m.timestamp >= l.startNs && m.timestamp <= l.endNs)
          .map((l) => l.label)
          .join('|'),
        cloud_file: cloudFile,
        cloud_dt_ns: cloudDt,
        note: file.note ?? '',
      });
      onProgress({ frames, clouds, bytes });
      if (bytes > MAX_EXPORT_BYTES) {
        truncated = 'size';
        break outer;
      }
    }

    start = batch.nextStartNs;
    phase = batch.phase;
    if (start !== null && frames >= opts.maxFrames) {
      // At the limit: only call it truncation if there really is another frame.
      const more = await deps.readRange(opts.imageTopic, { startNs: start, endNs: opts.endNs, stride: opts.stride, phase, max: 1 });
      if (more.messages.length > 0) truncated = 'frames';
      break;
    }
  }

  const csv = new TextEncoder().encode(framesToCsv(rows));
  addDeflated('frames.csv', csv);
  zip.end();
  if (zipError) throw zipError;

  const total = parts.reduce((n, p) => n + p.length, 0);
  const all = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return {
    blob: new Blob([all], { type: 'application/zip' }),
    frames,
    clouds,
    bytes,
    skipped: [...skipped].map(([reason, count]) => ({ reason, count })),
    truncated,
  };
}
