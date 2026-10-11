/**
 * Frame export against the bundled sample bag, through the real parsers: the
 * same readers the app's worker uses, no fakes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
import { parseBag, readMessageAtTime, readMessagesInRange } from '../../src/parsers/core';
import { createFileSource } from '../../src/parsers/source';
import { decodePointCloud2, type PointCloud2Message } from '../../src/utils/pointcloud';
import { runFrameExport } from '../../src/utils/frameExportRun';
import { parsePcd, readPointCloudAtTimePcd, disposePcdCache } from '../../src/parsers/pcd';

const file = () => new File([readFileSync(resolve(__dirname, '../../public/sample-bags/tour.mcap'))], 'bagel-tour.mcap');

async function exportSample(extra: Partial<Parameters<typeof runFrameExport>[0]> = {}) {
  const source = createFileSource(file());
  const summary = await parseBag(source);
  const t0 = summary.startTime;
  const result = await runFrameExport(
    {
      imageTopic: '/camera/image_raw',
      cloudTopic: null,
      startNs: t0 + 5_000_000_000n,
      endNs: t0 + 10_000_000_000n,
      stride: 1,
      maxFrames: 1000,
      maxCloudGapNs: 600_000_000n,
      labels: [],
      ...extra,
    },
    {
      readRange: (topic, params) => readMessagesInRange(source, summary.format, topic, params),
      readAt: (topic, t) => readMessageAtTime(source, summary.format, topic, t),
      decodeCloud: (v) => {
        const out = decodePointCloud2(v as unknown as PointCloud2Message, { maxPoints: 20_000_000 });
        return out ? { positions: out.positions, intensity: out.intensity, ring: out.ring } : null;
      },
    },
  );
  return { result, summary, files: unzipSync(new Uint8Array(await result.blob.arrayBuffer())) };
}

const ihdr = (png: Uint8Array) => {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20), depth: png[24], color: png[25] };
};

describe('exporting frames from the sample bag', () => {
  it('writes the 5 Hz camera frames in a 5 s range as 480x360 RGB PNGs, with a matching csv', async () => {
    const { result, files, summary } = await exportSample();
    // 5 Hz over [5 s, 10 s] inclusive: 25 or 26 frames depending on the phase of the stream.
    expect(result.frames).toBeGreaterThanOrEqual(25);
    expect(result.frames).toBeLessThanOrEqual(26);
    const pngs = Object.keys(files).filter((n) => n.endsWith('.png')).sort();
    expect(pngs).toHaveLength(result.frames);
    expect(ihdr(files[pngs[0]!]!)).toEqual({ width: 480, height: 360, depth: 8, color: 2 });

    const rows = new TextDecoder().decode(files['frames.csv']).split('\r\n').filter(Boolean).slice(1).map((l) => l.split(','));
    expect(rows).toHaveLength(result.frames);
    for (const row of rows) {
      const ts = BigInt(row[2]!);
      expect(ts).toBeGreaterThanOrEqual(summary.startTime + 5_000_000_000n);
      expect(ts).toBeLessThanOrEqual(summary.startTime + 10_000_000_000n);
      expect(row[0]).toBe(`camera_image_raw/${row[2]}.png`);
      // The sample's image header stamp is the log time.
      expect(row[3]).toBe(row[2]);
    }
  });

  it('a stride of 2 halves the frames and keeps every other one', async () => {
    const all = (await exportSample()).result.frames;
    const half = (await exportSample({ stride: 2 })).result.frames;
    expect(half).toBe(Math.ceil(all / 2));
  });

  it('pairs each frame with the nearest LiDAR sweep as a PCD the app can read back', async () => {
    disposePcdCache();
    const { result, files } = await exportSample({ cloudTopic: '/lidar/points' });
    expect(result.clouds).toBeGreaterThan(1);
    const pcds = Object.keys(files).filter((n) => n.endsWith('.pcd'));
    expect(pcds).toHaveLength(result.clouds);
    // 4 Hz sweeps against 5 Hz frames: each frame takes the sweep at or before it, so it is
    // never more than one sweep period (250 ms) older.
    const rows = new TextDecoder().decode(files['frames.csv']).split('\r\n').filter(Boolean).slice(1).map((l) => l.split(','));
    for (const row of rows) {
      expect(row[5]).toMatch(/^lidar_points\/\d+\.pcd$/);
      expect(Math.abs(Number(row[6]))).toBeLessThanOrEqual(250_000_000);
    }
    const pcd = files[pcds[0]!]!;
    const source = createFileSource(new File([pcd], 'sweep.pcd'));
    await parsePcd(source);
    const cloud = await readPointCloudAtTimePcd(source);
    expect(cloud!.pointCount).toBeGreaterThan(5000);
    expect(cloud!.fieldNames).toEqual(['x', 'y', 'z', 'intensity', 'ring']);
    // The sample's LiDAR has 32 beams, numbered 0 to 31.
    expect(Math.max(...cloud!.ring!)).toBe(31);
    expect(Math.min(...cloud!.ring!)).toBe(0);
  });

  it('puts the label covering a frame in its csv row', async () => {
    const source = createFileSource(file());
    const t0 = (await parseBag(source)).startTime;
    const { files } = await exportSample({ labels: [{ label: 'sharp left', startNs: t0 + 6_000_000_000n, endNs: t0 + 8_000_000_000n }] });
    const rows = new TextDecoder().decode(files['frames.csv']).split('\r\n').filter(Boolean).slice(1).map((l) => l.split(','));
    const labelled = rows.filter((r) => r[4] === 'sharp left');
    expect(labelled.length).toBeGreaterThanOrEqual(4);
    expect(labelled.length).toBeLessThan(rows.length);
    for (const r of labelled) expect(BigInt(r[2]!)).toBeGreaterThanOrEqual(t0 + 6_000_000_000n);
  });
});
