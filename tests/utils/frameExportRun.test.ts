import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import { ExportAborted, runFrameExport, type FrameExportDeps, type FrameExportOptions } from '../../src/utils/frameExportRun';
import { rangeFromAll } from '../../src/parsers/range';

const T0 = 1_000_000_000_000n;
const STEP = 100_000_000n; // 10 Hz

const rgb = (i: number) => ({ timestamp: T0 + BigInt(i) * STEP, value: { header: { stamp: { sec: 1000, nanosec: i * 100_000_000 } }, encoding: 'rgb8', width: 2, height: 2, data: new Uint8Array(12).fill(i) } as Record<string, unknown> });
const jpg = (i: number) => ({ timestamp: T0 + BigInt(i) * STEP, value: { format: 'jpeg', data: Uint8Array.from([0xff, 0xd8, 0xff, i, 9, 9]) } as Record<string, unknown> });
const cloud = (i: number) => ({ timestamp: T0 + BigInt(i) * 4n * STEP + 20_000_000n, value: { n: i } as Record<string, unknown> });

function deps(images: ReturnType<typeof rgb>[], clouds: ReturnType<typeof cloud>[] = [], log: string[] = []): FrameExportDeps {
  return {
    async readRange(topic, params) {
      log.push(`range ${topic} ${params.startNs}..${params.endNs} max ${params.max}`);
      return rangeFromAll(images, params);
    },
    async readAt(_topic, t) {
      // Nearest, like the real reader.
      let best: (typeof clouds)[number] | null = null;
      for (const c of clouds) if (!best || Math.abs(Number(c.timestamp - t)) < Math.abs(Number(best.timestamp - t))) best = c;
      return best;
    },
    decodeCloud: (v) => ({ positions: Float32Array.from([v.n as number, 0, 0]) }),
  };
}

const base = (extra: Partial<FrameExportOptions> = {}): FrameExportOptions => ({
  imageTopic: '/camera/image_raw',
  cloudTopic: null,
  startNs: T0,
  endNs: T0 + 100n * STEP,
  stride: 1,
  maxFrames: 1000,
  maxCloudGapNs: 500_000_000n,
  labels: [],
  ...extra,
});

async function open(blob: Blob) {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const csv = new TextDecoder().decode(files['frames.csv']).split('\r\n').filter(Boolean);
  return { files, header: csv[0]!, rows: csv.slice(1).map((l) => l.split(',')) };
}

describe('runFrameExport', () => {
  it('writes one file per frame, named by time, plus a csv that matches them', async () => {
    const r = await runFrameExport(base(), deps(Array.from({ length: 20 }, (_, i) => rgb(i))));
    expect(r.frames).toBe(20);
    const z = await open(r.blob);
    const names = Object.keys(z.files).filter((n) => n.endsWith('.png'));
    expect(names).toHaveLength(20);
    expect(names[0]).toBe(`camera_image_raw/${T0}.png`);
    expect(z.rows).toHaveLength(20);
    expect(z.rows.map((row) => row[0]).sort()).toEqual([...names].sort());
    // Header stamp and log time are both there, exact.
    expect(z.rows[3]![2]).toBe((T0 + 3n * STEP).toString());
    expect(z.rows[3]![3]).toBe('1000300000000');
    // Each PNG has the PNG signature.
    expect(Array.from(z.files[names[0]!]!.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);
  });

  it('honours the range and the stride, and reads in bounded batches', async () => {
    const log: string[] = [];
    const r = await runFrameExport(base({ startNs: T0 + 10n * STEP, endNs: T0 + 40n * STEP, stride: 5 }), deps(Array.from({ length: 100 }, (_, i) => rgb(i)), [], log));
    const z = await open(r.blob);
    expect(z.rows.map((row) => row[2])).toEqual([10, 15, 20, 25, 30, 35, 40].map((i) => (T0 + BigInt(i) * STEP).toString()));
    expect(log.every((l) => /max [1-8]$/.test(l))).toBe(true);
  });

  it('stops at the frame limit and says so', async () => {
    const r = await runFrameExport(base({ maxFrames: 12 }), deps(Array.from({ length: 50 }, (_, i) => rgb(i))));
    expect(r.frames).toBe(12);
    expect(r.truncated).toBe('frames');
    expect((await open(r.blob)).rows).toHaveLength(12);
    // Exactly as many frames as the limit is not truncation.
    const exact = await runFrameExport(base({ maxFrames: 12 }), deps(Array.from({ length: 12 }, (_, i) => rgb(i))));
    expect(exact.truncated).toBeNull();
  });

  it('passes JPEG bytes through untouched', async () => {
    const r = await runFrameExport(base(), deps([jpg(0), jpg(1)]));
    const z = await open(r.blob);
    expect(Array.from(z.files[`camera_image_raw/${T0 + STEP}.jpg`]!)).toEqual([0xff, 0xd8, 0xff, 1, 9, 9]);
  });

  it('pairs each frame with the nearest cloud once, shares a cloud between frames, and skips far ones', async () => {
    const images = Array.from({ length: 10 }, (_, i) => rgb(i));
    const r = await runFrameExport(base({ cloudTopic: '/lidar/points', maxCloudGapNs: 150_000_000n }), deps(images, [cloud(0), cloud(1)]));
    const z = await open(r.blob);
    expect(r.clouds).toBe(2);
    expect(Object.keys(z.files).filter((n) => n.endsWith('.pcd'))).toHaveLength(2);
    const cloudCol = z.rows.map((row) => row[5]);
    // Frames 0-2 are within 150 ms of the first cloud (at +20 ms), and 3-5 of the second (at +420 ms).
    expect(cloudCol[0]).toBe(cloudCol[1]);
    expect(cloudCol[0]).not.toBe('');
    expect(cloudCol[9]).toBe(''); // too far from any cloud
    expect(r.skipped.some((s) => /no point cloud close enough/.test(s.reason))).toBe(true);
    // The gap is signed and exact.
    expect(z.rows[0]![6]).toBe('20000000');
  });

  it('writes the labels covering each frame', async () => {
    const r = await runFrameExport(
      base({ labels: [{ label: 'turn', startNs: T0 + 2n * STEP, endNs: T0 + 4n * STEP }, { label: 'brake', startNs: T0 + 3n * STEP, endNs: T0 + 6n * STEP }] }),
      deps(Array.from({ length: 8 }, (_, i) => rgb(i))),
    );
    const z = await open(r.blob);
    expect(z.rows.map((row) => row[4])).toEqual(['', '', 'turn', 'turn|brake', 'turn|brake', 'brake', 'brake', '']);
  });

  it('reports frames it cannot convert by reason instead of failing the run', async () => {
    const bad = { timestamp: T0 + 2n * STEP, value: { encoding: 'bayer_rggb8', width: 2, height: 2, data: new Uint8Array(4) } as Record<string, unknown> };
    const nul = { timestamp: T0 + 3n * STEP, value: null };
    const r = await runFrameExport(base(), deps([rgb(0), rgb(1), bad, nul, rgb(4)]));
    expect(r.frames).toBe(3);
    expect(r.skipped).toEqual([
      { reason: 'images encoded as "bayer_rggb8" cannot be exported as PNG yet', count: 1 },
      { reason: 'the image could not be decoded', count: 1 },
    ]);
  });

  it('two frames with the same timestamp get different file names', async () => {
    const twin = { ...rgb(1) };
    const r = await runFrameExport(base(), deps([rgb(1), twin]));
    const names = Object.keys((await open(r.blob)).files).filter((n) => n.endsWith('.png'));
    expect(new Set(names).size).toBe(2);
  });

  it('an empty range still gives a valid zip with just the csv header', async () => {
    const r = await runFrameExport(base(), deps([]));
    const z = await open(r.blob);
    expect(r.frames).toBe(0);
    expect(Object.keys(z.files)).toEqual(['frames.csv']);
    expect(z.header).toBe('file,topic,timestamp_ns,header_stamp_ns,label,cloud_file,cloud_dt_ns,note');
  });

  it('can be cancelled between batches', async () => {
    const controller = new AbortController();
    const slow: FrameExportDeps = {
      ...deps(Array.from({ length: 100 }, (_, i) => rgb(i))),
      async readRange(topic, params) {
        controller.abort();
        return rangeFromAll(Array.from({ length: 100 }, (_, i) => rgb(i)), params);
      },
    };
    await expect(runFrameExport(base(), slow, () => {}, controller.signal)).rejects.toBeInstanceOf(ExportAborted);
  });

  it('reports progress as it goes', async () => {
    const seen: number[] = [];
    await runFrameExport(base(), deps(Array.from({ length: 5 }, (_, i) => rgb(i))), (p) => seen.push(p.frames));
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });
});
