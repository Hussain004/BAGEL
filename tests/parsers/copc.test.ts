import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decompressChunk, disposeCopcCache, openCopc, parseHierarchyPage, readPointCloudAtTimeCopc } from '../../src/parsers/copc';
import { decodeLasFile, disposeLasCache } from '../../src/parsers/las';
import { parseBag, readPointCloudAtTime } from '../../src/parsers/core';
import type { SingleBagSource } from '../../src/parsers/source';
import { classificationColor, type PointCloud2Message } from '../../src/utils/pointcloud';

const FIX = join(__dirname, '../fixtures/las');
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIX, name)));
const fileSource = (bytes: Uint8Array, name: string): SingleBagSource => ({ kind: 'file', file: new File([bytes], name) });
const GENERATED = ['deep6.copc.laz', 'rgb7.copc.laz', 'nir8.copc.laz'];
const COUNTS: Record<string, number> = { 'deep6.copc.laz': 6000, 'rgb7.copc.laz': 1500, 'nir8.copc.laz': 800 };

/** Points of the make_copc.py files, keyed on the 0.01 m grid they were written on. */
function expectedKeys(n: number): string[] {
  return Array.from({ length: n }, (_, i) =>
    [((i * 7919) % 10007) * 5, 85100000 + ((i * 104729) % 10009) * 5, 10000 + ((i * 31) % 997), i % 19].join(','),
  ).map((k) => {
    const [x, ...rest] = k.split(',');
    return [63700000 + Number(x), ...rest].join(',');
  }).sort();
}

/** Decoded cloud as sorted "x,y,z,class" keys on a 0.01 m grid (immune to float32 rounding). */
function keys(cloud: PointCloud2Message, origin: number[]): string[] {
  const dv = new DataView(cloud.data!.buffer, cloud.data!.byteOffset, cloud.data!.byteLength);
  const out: string[] = [];
  for (let i = 0; i < cloud.width!; i++) {
    const b = i * cloud.point_step!;
    const xyz = [0, 1, 2].map((a) => Math.round((dv.getFloat32(b + a * 4, true) + origin[a]) * 100));
    out.push([...xyz, dv.getFloat32(b + 16, true)].join(','));
  }
  return out.sort();
}

beforeEach(() => {
  disposeCopcCache();
  disposeLasCache();
});

describe('COPC files with nested hierarchy pages (make_copc.py)', () => {
  for (const name of GENERATED) {
    it(`${name}: the whole tree decodes to exactly the points written`, async () => {
      const file = (await openCopc(fileSource(fixture(name), name)))!;
      const { cloud } = await file.cloud(undefined, Infinity);
      expect(keys(cloud, file.origin)).toEqual(expectedKeys(COUNTS[name]));
    });
  }

  it('loads subtree pages only when the walk reaches them', async () => {
    const file = (await openCopc(fileSource(fixture('deep6.copc.laz'), 'deep6.copc.laz')))!;
    expect(file.nodes.size).toBe(1); // the root page holds the root node and 8 page pointers
    await file.cloud(undefined, Infinity);
    expect(file.nodes.size).toBe(169);
  });

  it('descends through a node with no points of its own', async () => {
    const file = (await openCopc(fileSource(fixture('deep6.copc.laz'), 'deep6.copc.laz')))!;
    await file.cloud(undefined, Infinity);
    expect(file.nodes.get('1-0-0-0')!.pointCount).toBe(0);
    expect([...file.nodes.keys()].some((k) => /^2-[01]-[01]-[01]$/.test(k))).toBe(true);
  });

  it('takes whole levels until the point budget, never part of one', async () => {
    const file = (await openCopc(fileSource(fixture('deep6.copc.laz'), 'deep6.copc.laz')))!;
    await file.cloud(undefined, Infinity);
    // Running total of points through each depth: what whole levels add up to.
    const byDepth = [0, 0, 0, 0];
    for (const e of file.nodes.values()) byDepth[e.d] += Math.max(0, e.pointCount);
    const cumulative = byDepth.map((_, d) => byDepth.slice(0, d + 1).reduce((a, b) => a + b, 0));
    expect(cumulative[3]).toBe(6000);
    for (const budget of [1, 1500, 2000, 3000, 4500, 5999, 6000]) {
      const got = (await file.cloud(undefined, budget)).cloud.width!;
      // The most whole levels that fit, and always at least the root level.
      const want = Math.max(cumulative[0], ...cumulative.filter((c) => c <= budget));
      expect(got).toBe(want);
    }
  });

  it('spends the budget inside the clip box when one is set', async () => {
    const src = fileSource(fixture('deep6.copc.laz'), 'deep6.copc.laz');
    const file = (await openCopc(src))!;
    const all = await readPointCloudAtTimeCopc(src, 'height', undefined, undefined, '+z', undefined, 1500);
    // A corner box, in the local (origin-shifted) frame the 3D view clips in.
    const o = file.origin;
    const clip = { xMin: 637000 - o[0], xMax: 637100 - o[0], yMin: 851000 - o[1], yMax: 851100 - o[1] };
    const clipped = await readPointCloudAtTimeCopc(src, 'height', undefined, undefined, '+z', clip, 1500);
    const inBox = (r: typeof all) => {
      let n = 0;
      for (let i = 0; i < r!.pointCount; i++) {
        const x = r!.positions[i * 3], y = r!.positions[i * 3 + 1];
        if (x >= clip.xMin && x <= clip.xMax && y >= clip.yMin && y <= clip.yMax) n++;
      }
      return n;
    };
    expect(clipped!.pointCount).toBe(inBox(clipped));
    expect(inBox(clipped)).toBeGreaterThan(inBox(all));
  });
});

describe('PDAL COPC files', () => {
  it('1.2-with-color.copc.laz holds exactly the points of simple.las', async () => {
    const file = (await openCopc(fileSource(fixture('1.2-with-color.copc.laz'), 'a.copc.laz')))!;
    const { cloud } = await file.cloud(undefined, Infinity);
    const twin = await decodeLasFile(fixture('simple.las'));
    expect(keys(cloud, file.origin)).toEqual(keys(twin.cloud, twin.origin));
  });

  it('a single-node file opens', async () => {
    const r = await readPointCloudAtTimeCopc(fileSource(fixture('autzen_clip_native.copc.laz'), 'c.copc.laz'));
    expect(r!.pointCount).toBe(43);
  });
});

describe('reads ranges, not the file', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('an overview of a remote tile fetches a fraction of it, always with Range', async () => {
    const bytes = fixture('deep6.copc.laz');
    let fetched = 0;
    let unranged = 0;
    globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const range = (init?.headers as Record<string, string> | undefined)?.Range;
      if (!range) {
        unranged++;
        return new Response(bytes, { status: 200 });
      }
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(range)!;
      const body = bytes.slice(Number(a), Number(b) + 1);
      fetched += body.length;
      return new Response(body, { status: 206 });
    }) as typeof fetch;
    const src: SingleBagSource = { kind: 'url', url: 'https://example.com/deep6.copc.laz', contentLength: bytes.length, displayName: 'deep6.copc.laz' };
    const r = await readPointCloudAtTimeCopc(src, 'height', undefined, undefined, '+z', undefined, 1500);
    expect(r!.pointCount).toBe(1500);
    expect(unranged).toBe(0);
    expect(fetched).toBeLessThan(bytes.length * 0.4);
  });
});

describe('one reused laz-perf instance, node by node', () => {
  it('decodes every node of every fixture identically over 10 varied rounds', async () => {
    const names = [...GENERATED, '1.2-with-color.copc.laz', 'autzen_clip_native.copc.laz'];
    const jobs: { name: string; key: string; run: () => Promise<Uint8Array> }[] = [];
    for (const name of names) {
      const bytes = fixture(name);
      const file = (await openCopc(fileSource(bytes, name)))!;
      await file.cloud(undefined, Infinity);
      for (const [key, e] of file.nodes) {
        if (e.pointCount <= 0) continue;
        const chunk = bytes.slice(e.offset, e.offset + e.byteSize);
        jobs.push({ name, key, run: () => decompressChunk(chunk, file.header.pointFormat, file.header.recordLength, e.pointCount) });
      }
    }
    expect(jobs.length).toBeGreaterThan(250);
    const first = new Map<string, Buffer>();
    for (const j of jobs) first.set(`${j.name}/${j.key}`, Buffer.from(await j.run()));
    for (let round = 0; round < 10; round++) {
      const step = [7, 11, 13, 17, 19][round % 5];
      for (let k = 0; k < jobs.length; k++) {
        const j = jobs[(k * step + round) % jobs.length];
        expect(Buffer.from(await j.run())).toEqual(first.get(`${j.name}/${j.key}`));
      }
    }
  });
});

describe('damaged hierarchies and chunks', () => {
  /** Byte offset of the root page's first entry whose pointCount matches. */
  async function rootEntryAt(bytes: Uint8Array, pointer: boolean): Promise<number> {
    const file = (await openCopc(fileSource(bytes, 'probe.copc.laz')))!;
    disposeCopcCache();
    const page = parseHierarchyPage(bytes.slice(file.info.rootOffset, file.info.rootOffset + file.info.rootSize));
    const i = page.findIndex((e) => (pointer ? e.pointCount === -1 : e.pointCount > 0));
    return file.info.rootOffset + i * 32;
  }
  const good = () => fixture('deep6.copc.laz');
  const decodeAll = async (bytes: Uint8Array) => {
    const file = (await openCopc(fileSource(bytes, `x${Math.random()}.copc.laz`)))!;
    return file.cloud(undefined, Infinity);
  };

  it('a child page past the end of the file fails with a reason', async () => {
    const bytes = good();
    const at = await rootEntryAt(bytes, true);
    new DataView(bytes.buffer).setBigUint64(at + 16, BigInt(bytes.length + 10), true);
    await expect(decodeAll(bytes)).rejects.toThrow(/outside/);
  });

  it('a page that points back at the root page terminates', async () => {
    const bytes = good();
    const at = await rootEntryAt(bytes, true);
    const dv = new DataView(bytes.buffer);
    const file = (await openCopc(fileSource(good(), 'r.copc.laz')))!;
    dv.setBigUint64(at + 16, BigInt(file.info.rootOffset), true);
    dv.setInt32(at + 24, file.info.rootSize, true);
    const { cloud } = await decodeAll(bytes);
    expect(cloud.width).toBeGreaterThan(0);
  });

  it('a chunk size past the end of the file is skipped, the rest still loads', async () => {
    const bytes = good();
    const at = await rootEntryAt(bytes, false);
    new DataView(bytes.buffer).setInt32(at + 24, bytes.length, true);
    const { cloud } = await decodeAll(bytes);
    expect(cloud.width).toBeGreaterThan(0);
    expect(cloud.width).toBeLessThan(6000);
  });

  it('a truncated or garbled chunk fails alone, and a good file decodes after it', async () => {
    const bytes = good();
    const at = await rootEntryAt(bytes, false);
    const dv = new DataView(bytes.buffer);
    const off = Number(dv.getBigUint64(at + 16, true));
    const size = dv.getInt32(at + 24, true);
    for (let i = off + 4; i < off + size; i++) bytes[i] = (i * 131) & 0xff;
    dv.setInt32(at + 24, Math.max(8, size >> 2), true);
    const damaged = await decodeAll(bytes).catch((e: Error) => e);
    if (!(damaged instanceof Error)) expect(damaged.cloud.width).toBeLessThanOrEqual(6000);
    const { cloud } = await decodeAll(good());
    expect(cloud.width).toBe(6000);
  });
});

describe('through the shared parser entry points', () => {
  it('routes a .copc.laz to the node reader and colours it by class', async () => {
    const src = fileSource(fixture('rgb7.copc.laz'), 'tile.copc.laz');
    const summary = await parseBag(src);
    expect(summary.format).toBe('las');
    expect(summary.topics[0].serializationFormat).toBe('copc');
    const r = await readPointCloudAtTime(src, 'las', '/cloud', 0n, 'classification');
    expect(r!.pointCount).toBe(1500);
    const c = classificationColor(0).map((v) => Math.fround(v));
    expect(r!.colors.some((_, i) => i % 3 === 0 && r!.colors[i] === c[0] && r!.colors[i + 1] === c[1] && r!.colors[i + 2] === c[2])).toBe(true);
  });

  it('leaves a plain .laz on the whole-file path', async () => {
    const src = fileSource(fixture('fmt6.laz'), 'plain.laz');
    expect(await openCopc(src)).toBeNull();
    expect((await parseBag(src)).topics[0].serializationFormat).toBe('las');
  });
});
