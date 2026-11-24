import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeLasFile,
  parseLasHeader,
  lasOrigin,
  disposeLasCache,
  MAX_STORED_POINTS,
} from '../../src/parsers/las';
import { detectFormat, parseBag, readPointCloudAtTime } from '../../src/parsers/core';
import type { BagSource } from '../../src/parsers/source';
import { classificationColor, decodePointCloud2, type PointCloud2Message } from '../../src/utils/pointcloud';

const FIX = join(__dirname, '../fixtures/las');
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIX, name)));
const fileSource = (bytes: Uint8Array, name: string): BagSource => ({ kind: 'file', file: new File([bytes], name) });

/** Read back the builder's FLOAT32 layout: x y z intensity classification [rgb]. */
function points(cloud: PointCloud2Message) {
  const dv = new DataView(cloud.data!.buffer, cloud.data!.byteOffset, cloud.data!.byteLength);
  const step = cloud.point_step!;
  const hasRgb = cloud.fields!.some((f) => f.name === 'rgb');
  return Array.from({ length: cloud.width! }, (_, i) => {
    const b = i * step;
    const raw = hasRgb ? dv.getUint32(b + 20, true) : 0;
    return {
      x: dv.getFloat32(b, true),
      y: dv.getFloat32(b + 4, true),
      z: dv.getFloat32(b + 8, true),
      intensity: dv.getFloat32(b + 12, true),
      cls: dv.getFloat32(b + 16, true),
      rgb: hasRgb ? [(raw >> 16) & 0xff, (raw >> 8) & 0xff, raw & 0xff] : null,
    };
  });
}

/** The points every fmtN.laz holds (mirrors make_fixtures.py). */
const expected = (i: number) => ({
  x: 637000 + i * 0.37,
  y: 851000 + ((i * 7) % 100) * 0.5,
  z: 100 + (i % 50) * 0.25,
  intensity: (i * 13) % 65536,
  cls: i % 19,
  rgb: [(i * 3) % 256, (i * 5) % 256, (i * 7) % 256],
});
const RGB_FORMATS = new Set([2, 3, 5, 7, 8, 10]);

// ---------------------------------------------------------------------------
// A tiny uncompressed LAS writer, so headers can be deliberately wrong.
// ---------------------------------------------------------------------------
interface WriteOpts {
  format?: number;
  minor?: number;
  headerSize?: number;
  extraBytes?: number;
  legacyCount?: number;
  bigCount?: number;
  bounds?: { min: [number, number, number]; max: [number, number, number] };
  rgb?: (i: number) => [number, number, number];
  classByte?: (i: number) => number;
}
const MIN_LEN: Record<number, number> = { 0: 20, 1: 28, 2: 26, 3: 34, 4: 57, 6: 30, 7: 36, 9: 59 };
function writeLas(pts: [number, number, number][], o: WriteOpts = {}): Uint8Array {
  const format = o.format ?? 3;
  const minor = o.minor ?? 2;
  const headerSize = o.headerSize ?? (minor >= 4 ? 375 : 227);
  const recLen = MIN_LEN[format] + (o.extraBytes ?? 0);
  const out = new Uint8Array(headerSize + pts.length * recLen);
  const dv = new DataView(out.buffer);
  out.set(new TextEncoder().encode('LASF'), 0);
  dv.setUint8(24, 1);
  dv.setUint8(25, minor);
  dv.setUint16(94, headerSize, true);
  dv.setUint32(96, headerSize, true);
  dv.setUint8(104, format);
  dv.setUint16(105, recLen, true);
  dv.setUint32(107, o.legacyCount ?? pts.length, true);
  const scale = 0.001;
  const offset = [500000, 4000000, 0];
  [0, 1, 2].forEach((a) => {
    dv.setFloat64(131 + a * 8, scale, true);
    dv.setFloat64(155 + a * 8, offset[a], true);
  });
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]), zs = pts.map((p) => p[2]);
  const b = o.bounds ?? {
    min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
    max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
  };
  [0, 1, 2].forEach((a) => {
    dv.setFloat64(179 + a * 16, b.max[a], true);
    dv.setFloat64(187 + a * 16, b.min[a], true);
  });
  if (headerSize >= 375) dv.setBigUint64(247, BigInt(o.bigCount ?? pts.length), true);
  const classOff = format >= 6 ? 16 : 15;
  const rgbOff = format === 2 ? 20 : format === 3 ? 28 : format === 7 ? 30 : null;
  pts.forEach((p, i) => {
    const at = headerSize + i * recLen;
    [0, 1, 2].forEach((a) => dv.setInt32(at + a * 4, Math.round((p[a] - offset[a]) / scale), true));
    dv.setUint16(at + 12, i, true);
    dv.setUint8(at + classOff, o.classByte ? o.classByte(i) : 2);
    if (rgbOff !== null && o.rgb) o.rgb(i).forEach((c, k) => dv.setUint16(at + rgbOff + k * 2, c, true));
  });
  return out;
}
const utm = (n: number): [number, number, number][] =>
  Array.from({ length: n }, (_, i) => [500100 + i, 4000200 + i * 0.5, 250 + i * 0.1]);

beforeEach(() => disposeLasCache());

const LAZ_OK = [0, 1, 2, 3, 6, 7, 8];
const WAVEFORM = [4, 5, 9, 10];

describe('LAZ fixtures, point formats 0 to 10 (laspy + lazrs)', () => {
  for (const fmt of WAVEFORM) {
    it(`compressed waveform format ${fmt} is refused with a way forward, before reaching WASM`, async () => {
      await expect(decodeLasFile(fixture(`fmt${fmt}.laz`))).rejects.toThrow(/format \d+ .*las2las/);
    });
  }
  for (const fmt of LAZ_OK) {
    it(`format ${fmt} decodes every field`, async () => {
      const { cloud, origin, header } = await decodeLasFile(fixture(`fmt${fmt}.laz`));
      expect(header.compressed).toBe(true);
      expect(header.pointFormat).toBe(fmt);
      const pts = points(cloud);
      expect(pts).toHaveLength(300);
      expect(cloud.fields!.some((f) => f.name === 'rgb')).toBe(RGB_FORMATS.has(fmt));
      pts.forEach((p, i) => {
        const e = expected(i);
        expect(p.x + origin[0]).toBeCloseTo(e.x, 2);
        expect(p.y + origin[1]).toBeCloseTo(e.y, 2);
        expect(p.z + origin[2]).toBeCloseTo(e.z, 2);
        expect(p.intensity).toBe(e.intensity);
        expect(p.cls).toBe(e.cls);
        if (p.rgb) expect(p.rgb).toEqual(e.rgb);
      });
    });
  }
});

describe('PDAL fixtures (LASzip / libLAS producer)', () => {
  it('simple.laz decodes to exactly the points of its uncompressed twin', async () => {
    const las = await decodeLasFile(fixture('simple.las'));
    const laz = await decodeLasFile(fixture('simple.laz'));
    expect(laz.header.compressed).toBe(true);
    expect(las.cloud.width).toBe(1065);
    expect(laz.origin).toEqual(las.origin);
    expect(Buffer.from(laz.cloud.data!)).toEqual(Buffer.from(las.cloud.data!));
    expect(new Set(points(las.cloud).map((p) => p.cls))).toEqual(new Set([1, 2]));
  });

  it('100-points.las reads as format 3 with colour', async () => {
    const { cloud, header } = await decodeLasFile(fixture('100-points.las'));
    expect(header.pointFormat).toBe(3);
    expect(cloud.width).toBe(100);
    expect(points(cloud).some((p) => p.rgb!.some((c) => c > 0))).toBe(true);
  });
});

describe('one reused laz-perf instance across many sequential decodes', () => {
  it('stays byte-identical over 20 rounds of every fixture in varied order', async () => {
    const names = [...LAZ_OK.map((f) => `fmt${f}.laz`), 'simple.laz'];
    const firstPass = new Map<string, Buffer>();
    for (const n of names) firstPass.set(n, Buffer.from((await decodeLasFile(fixture(n))).cloud.data!));
    for (let round = 0; round < 20; round++) {
      // Rotate and alternate direction so neighbours differ between rounds.
      const order = names.map((_, k) => names[(k * (round % 2 ? 5 : 7) + round) % names.length]);
      for (const n of order) {
        // Vary the thinning too: a different stride exercises a different read pattern.
        const cap = round % 3 === 0 ? 37 : MAX_STORED_POINTS;
        const { cloud } = await decodeLasFile(fixture(n), cap);
        if (cap === MAX_STORED_POINTS) expect(Buffer.from(cloud.data!)).toEqual(firstPass.get(n));
        else expect(cloud.width).toBeLessThanOrEqual(37);
      }
    }
  });

  it('survives truncated and garbage LAZ, then still decodes a good file', async () => {
    const good = fixture('simple.laz');
    const reference = Buffer.from((await decodeLasFile(good)).cloud.data!);
    for (const frac of [0.95, 0.7, 0.4]) {
      const cut = good.slice(0, Math.floor(good.length * frac));
      // Either a clean error or some points; never a hang or a crash.
      await decodeLasFile(cut).then(
        (r) => expect(r.cloud.width).toBeLessThanOrEqual(1065),
        (e) => expect(e).toBeInstanceOf(Error),
      );
    }
    const garbage = good.slice();
    const hdr = parseLasHeader(good);
    for (let i = hdr.pointOffset + 8; i < garbage.length; i++) garbage[i] = (i * 31) & 0xff;
    await decodeLasFile(garbage).catch((e) => expect(e).toBeInstanceOf(Error));
    expect(Buffer.from((await decodeLasFile(good)).cloud.data!)).toEqual(reference);
  });
});

describe('uncompressed LAS with absent or inaccurate header values', () => {
  it('reads what the file holds when the declared count is too large', async () => {
    const r = await decodeLasFile(writeLas(utm(10), { legacyCount: 1000 }));
    expect(r.cloud.width).toBe(10);
    expect(r.readCount).toBe(10);
  });

  it('reads the whole file when the declared count is 0', async () => {
    const r = await decodeLasFile(writeLas(utm(10), { legacyCount: 0 }));
    expect(r.cloud.width).toBe(10);
  });

  it('stops at a declared count smaller than the data', async () => {
    const r = await decodeLasFile(writeLas(utm(10), { legacyCount: 4 }));
    expect(r.cloud.width).toBe(4);
  });

  it('uses the 64-bit count in a 1.4 header with the legacy count left at 0', async () => {
    const r = await decodeLasFile(writeLas(utm(12), { format: 6, minor: 4, legacyCount: 0, bigCount: 12 }));
    expect(r.header.pointCount).toBe(12);
    expect(r.cloud.width).toBe(12);
  });

  it('ignores the 64-bit field when a "1.4" file has a 227-byte header', async () => {
    const r = await decodeLasFile(writeLas(utm(7), { minor: 4, headerSize: 227 }));
    expect(r.header.pointCount).toBe(7);
    expect(r.cloud.width).toBe(7);
  });

  it('steps over extra bytes at the end of each record', async () => {
    const r = await decodeLasFile(writeLas(utm(5), { extraBytes: 9 }));
    const pts = points(r.cloud);
    expect(pts.map((p) => p.intensity)).toEqual([0, 1, 2, 3, 4]);
    expect(pts[4].x + r.origin[0]).toBeCloseTo(500104, 2);
  });

  it('keeps points when the header bounds are zero (never filled in)', async () => {
    const bytes = writeLas(utm(20), { bounds: { min: [0, 0, 0], max: [0, 0, 0] } });
    const r = await decodeLasFile(bytes);
    expect(r.origin[0]).toBeGreaterThan(400000);
    // Local coordinates are small, so the shared decoder's sanity filter keeps them all.
    expect(decodePointCloud2(r.cloud)!.pointCount).toBe(20);
  });

  it('masks the flag bits out of a legacy class byte', async () => {
    const r = await decodeLasFile(writeLas(utm(3), { format: 0, classByte: () => 0x80 | 0x20 | 6 }));
    expect(points(r.cloud).map((p) => p.cls)).toEqual([6, 6, 6]);
  });

  it('keeps the full byte as the class in formats 6+', async () => {
    const r = await decodeLasFile(writeLas(utm(3), { format: 6, minor: 4, classByte: () => 200 }));
    expect(points(r.cloud).map((p) => p.cls)).toEqual([200, 200, 200]);
  });

  it('reads uncompressed waveform formats (4 and 9), which need no laz-perf', async () => {
    for (const [format, minor] of [[4, 3], [9, 4]]) {
      const r = await decodeLasFile(writeLas(utm(6), { format, minor, classByte: () => 9 }));
      expect(r.cloud.width).toBe(6);
      expect(points(r.cloud).every((p) => p.cls === 9)).toBe(true);
    }
  });

  it('does not shift colour that only uses the low byte', async () => {
    const r = await decodeLasFile(writeLas(utm(2), { format: 2, rgb: () => [200, 100, 50] }));
    expect(points(r.cloud)[0].rgb).toEqual([200, 100, 50]);
  });

  it('shifts true 16-bit colour down to 8 bits', async () => {
    const r = await decodeLasFile(writeLas(utm(2), { format: 7, minor: 4, rgb: () => [0xff00, 0x8000, 0x0100] }));
    expect(points(r.cloud)[0].rgb).toEqual([255, 128, 1]);
  });

  it('thins large files to the stored cap', async () => {
    const r = await decodeLasFile(writeLas(utm(300)), 50);
    expect(r.cloud.width).toBe(50);
    expect(r.readCount).toBe(300);
  });

  it('rejects files it cannot read, with a reason', async () => {
    const ok = writeLas(utm(3));
    await expect(decodeLasFile(ok.slice(0, 100))).rejects.toThrow(/too small/);
    const notLas = ok.slice();
    notLas[0] = 0x58;
    await expect(decodeLasFile(notLas)).rejects.toThrow(/LASF/);
    const badOffset = ok.slice();
    new DataView(badOffset.buffer).setUint32(96, 1 << 30, true);
    await expect(decodeLasFile(badOffset)).rejects.toThrow(/offset/);
    const shortRecord = ok.slice();
    new DataView(shortRecord.buffer).setUint16(105, 20, true);
    await expect(decodeLasFile(shortRecord)).rejects.toThrow(/shorter/);
    const badFormat = ok.slice();
    badFormat[104] = 11;
    await expect(decodeLasFile(badFormat)).rejects.toThrow(/format 11/);
  });
});

describe('lasOrigin', () => {
  it('uses the bounds centre when the first point is inside', () => {
    expect(lasOrigin([10, 20, 0], [30, 40, 10], [15, 25, 5])).toEqual([20, 30, 0]);
  });
  it('falls back to the first point when the bounds do not contain it', () => {
    expect(lasOrigin([0, 0, 0], [0, 0, 0], [500100.4, 4000200.6, 7000])).toEqual([500100, 4000201, 7000]);
  });
});

describe('through the shared parser entry points', () => {
  it('detects .las / .laz by extension and by magic, and colours by class', async () => {
    const bytes = fixture('fmt6.laz');
    expect(await detectFormat(fileSource(bytes, 'tile.laz'))).toBe('las');
    expect(await detectFormat(fileSource(bytes, 'download'))).toBe('las');
    const src = fileSource(bytes, 'tile.laz');
    const summary = await parseBag(src);
    expect(summary.format).toBe('las');
    expect(summary.topics[0]).toMatchObject({ name: '/cloud', type: 'sensor_msgs/PointCloud2' });
    const cloud = await readPointCloudAtTime(src, 'las', '/cloud', 0n, 'classification');
    expect(cloud!.pointCount).toBe(300);
    for (const i of [0, 1, 6, 9, 18]) {
      expect(Array.from(cloud!.colors.slice(i * 3, i * 3 + 3))).toEqual(
        classificationColor(i).map((c) => Math.fround(c)),
      );
    }
  });
});

describe('colour modes for clouds without the field', () => {
  it('falls back to height for rgb and classification instead of painting black', async () => {
    const { cloud } = await decodeLasFile(fixture('fmt0.laz'));
    const noClass = { ...cloud, fields: cloud.fields!.filter((f) => f.name !== 'classification') };
    for (const mode of ['rgb', 'classification'] as const) {
      const d = decodePointCloud2(noClass, { colorMode: mode })!;
      expect(d.colors.some((c) => c > 0)).toBe(true);
    }
  });
});

it('public/laz-perf.wasm is the copy the installed laz-perf ships', () => {
  const shipped = readFileSync(join(__dirname, '../../public/laz-perf.wasm'));
  const installed = readFileSync(join(__dirname, '../../node_modules/laz-perf/lib/web/laz-perf.wasm'));
  expect(shipped.equals(installed)).toBe(true);
});
