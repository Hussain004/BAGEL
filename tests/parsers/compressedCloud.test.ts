/**
 * point_cloud_interfaces/CompressedPointCloud2 (zstd, zlib). The compressed
 * bytes come from Node's own zlib and zstd (not the decoders under test), with
 * the framings and options the point_cloud_transport plugins and other
 * producers use: gzip (what the "zlib" plugin really writes), zlib-wrapped and
 * raw deflate at several levels; one-shot zstd, zstd with a checksum, and
 * streamed zstd frames that omit the content size.
 */
import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';
import { decompressCloud, isCompressedCloudValue } from '../../src/parsers/compressedCloud';
import { decodePointCloud2, type PointCloud2Message } from '../../src/utils/pointcloud';
import { readPointCloudAtTime } from '../../src/parsers/core';
import { collectMessageDefinitions, writeSyntheticDb3, writeSyntheticMcap, type RosmsgDef } from '../fixtures/synth';

/** An Ouster-like organized cloud: 16 rings x 256 columns, x y z intensity float32, ring uint16, 32-byte points. */
function ousterCloud(): PointCloud2Message & { data: Uint8Array } {
  const width = 256, height = 16, pointStep = 32;
  const data = new Uint8Array(width * height * pointStep);
  const v = new DataView(data.buffer);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const o = (r * width + c) * pointStep;
      const az = (c / width) * 2 * Math.PI, el = ((r - 8) / 8) * 0.3, range = 5 + 3 * Math.sin(az * 3) + r * 0.1;
      v.setFloat32(o, range * Math.cos(el) * Math.cos(az), true);
      v.setFloat32(o + 4, range * Math.cos(el) * Math.sin(az), true);
      v.setFloat32(o + 8, range * Math.sin(el), true);
      v.setFloat32(o + 16, (r * 37 + c) % 255, true);
      v.setUint16(o + 20, r, true);
    }
  }
  return {
    header: { frame_id: 'os_lidar', stamp: { sec: 1_700_000_000, nanosec: 5 } },
    height, width, is_bigendian: false, point_step: pointStep, row_step: width * pointStep, is_dense: true, data,
    fields: [
      { name: 'x', offset: 0, datatype: 7, count: 1 },
      { name: 'y', offset: 4, datatype: 7, count: 1 },
      { name: 'z', offset: 8, datatype: 7, count: 1 },
      { name: 'intensity', offset: 16, datatype: 7, count: 1 },
      { name: 'ring', offset: 20, datatype: 4, count: 1 },
    ],
  };
}

const streamedZstd = (data: Uint8Array) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const z = zlib.createZstdCompress({ params: { [zlib.constants.ZSTD_c_contentSizeFlag]: 0 } });
    const parts: Buffer[] = [];
    z.on('data', (b: Buffer) => parts.push(b)).on('end', () => resolve(new Uint8Array(Buffer.concat(parts)))).on('error', reject);
    for (let i = 0; i < data.length; i += 4096) z.write(data.subarray(i, i + 4096));
    z.end();
  });

const PRODUCERS: Array<[string, string, (d: Uint8Array) => Uint8Array | Promise<Uint8Array>]> = [
  ['gzip level 1 (the zlib plugin)', 'zlib', (d) => zlib.gzipSync(d, { level: 1 })],
  ['gzip level 9', 'zlib', (d) => zlib.gzipSync(d, { level: 9 })],
  ['zlib-wrapped', 'zlib', (d) => zlib.deflateSync(d)],
  ['raw deflate', 'deflate', (d) => zlib.deflateRawSync(d)],
  ['zstd level 1', 'zstd', (d) => zlib.zstdCompressSync(d, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 1 } })],
  ['zstd level 19 + checksum', 'zstd', (d) => zlib.zstdCompressSync(d, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 19, [zlib.constants.ZSTD_c_checksumFlag]: 1 } })],
  ['zstd streamed, no content size', 'zstd', streamedZstd],
];

const compressed = async (cloud: ReturnType<typeof ousterCloud>, format: string, pack: (d: Uint8Array) => Uint8Array | Promise<Uint8Array>) => {
  const { data, ...rest } = cloud;
  return { ...rest, compressed_data: new Uint8Array(await pack(data)), format };
};

describe('decompressCloud', () => {
  const cloud = ousterCloud();
  const expected = decodePointCloud2(cloud, { colorMode: 'intensity' })!;

  it.each(PRODUCERS)('%s gives back the exact bytes and the same points', async (_label, format, pack) => {
    const msg = await compressed(cloud, format, pack);
    expect(isCompressedCloudValue(msg)).toBe(true);
    const out = decompressCloud(msg);
    expect(Buffer.from(out.data!).equals(Buffer.from(cloud.data))).toBe(true);
    const got = decodePointCloud2(out, { colorMode: 'intensity' })!;
    expect(got.pointCount).toBe(expected.pointCount);
    expect(got.positions).toEqual(expected.positions);
  });

  it('accepts JSON-encoded bytes (base64 and number arrays) and odd format spellings', async () => {
    const msg = await compressed(cloud, 'ZSTD', (d) => zlib.zstdCompressSync(d));
    const b64 = { ...msg, compressed_data: Buffer.from(msg.compressed_data).toString('base64') };
    const arr = { ...msg, compressed_data: Array.from(msg.compressed_data), format: ' zstd ' };
    for (const m of [b64, arr]) expect(decompressCloud(m).data!.length).toBe(cloud.data.length);
  });

  it('refuses Draco, an unknown format, garbage, and a size that does not add up', async () => {
    const msg = await compressed(cloud, 'zstd', (d) => zlib.zstdCompressSync(d));
    expect(() => decompressCloud({ ...msg, format: 'draco' })).toThrow(/Draco-compressed point clouds are not supported yet/);
    expect(() => decompressCloud({ ...msg, format: 'lz4' })).toThrow(/Unknown CompressedPointCloud2 format "lz4"/);
    expect(() => decompressCloud({ ...msg, compressed_data: new Uint8Array(64).fill(7) })).toThrow();
    expect(() => decompressCloud({ ...msg, format: 'zlib', compressed_data: new Uint8Array(64).fill(7) })).toThrow();
    // width claims more points than the data holds (an inaccurate producer)
    expect(() => decompressCloud({ ...msg, width: 512 })).toThrow(/need 262144/);
    // extra trailing bytes (row padding) are fine
    const padded = await compressed({ ...cloud, data: new Uint8Array([...cloud.data, 0, 0, 0, 0]) }, 'zstd', (d) => zlib.zstdCompressSync(d));
    expect(decompressCloud(padded).data!.length).toBe(cloud.data.length + 4);
  });

  it('many sequential clouds of varied size through the same decoders', async () => {
    for (let i = 0; i < 60; i++) {
      const w = 1 + ((i * 37) % 300);
      const data = new Uint8Array(w * 16).map((_, k) => (k * (i + 3)) & 0xff);
      const base = { ...cloud, width: w, height: 1, point_step: 16, row_step: w * 16, data };
      const [, format, pack] = PRODUCERS[i % PRODUCERS.length]!;
      const out = decompressCloud(await compressed(base, format, pack));
      expect(Buffer.from(out.data!).equals(Buffer.from(data)), `cloud ${i}`).toBe(true);
    }
  });
});

describe('a CompressedPointCloud2 topic in a bag', () => {
  const TYPE = 'point_cloud_interfaces/msg/CompressedPointCloud2';
  const pc2 = collectMessageDefinitions('sensor_msgs/msg/PointCloud2');
  const def: RosmsgDef = {
    name: 'point_cloud_interfaces/CompressedPointCloud2',
    definitions: [...pc2[0]!.definitions.map((f) => (f.name === 'data' ? { ...f, name: 'compressed_data' } : f)), { name: 'format', type: 'string' }],
  };
  const cloud = ousterCloud();
  const expected = decodePointCloud2(cloud, { colorMode: 'height' })!;

  it('decodes from MCAP (schema in the file)', async () => {
    const value = await compressed(cloud, 'zstd', (d) => zlib.zstdCompressSync(d));
    const bytes = await writeSyntheticMcap([{ topic: '/os/points/zstd', type: TYPE, extraDefinitions: [def], messages: [{ logTime: 1_000_000_000n, value }] }]);
    const src = { kind: 'file' as const, file: new File([bytes as BlobPart], 'c.mcap') };
    const got = (await readPointCloudAtTime(src, 'mcap', '/os/points/zstd', 1_000_000_000n))!;
    expect(got.pointCount).toBe(expected.pointCount);
    expect(got.positions).toEqual(expected.positions);
  });

  it('decodes from .db3 (definition from the bundled registry)', async () => {
    const value = await compressed(cloud, 'zlib', (d) => zlib.gzipSync(d));
    const writer = new MessageWriter([def, ...pc2.slice(1)] as never);
    const bytes = await writeSyntheticDb3([{ topic: '/os/points/zlib', type: TYPE, messages: [{ timestampNs: 1_000_000_000n, data: writer.writeMessage(value) }] }]);
    const src = { kind: 'file' as const, file: new File([bytes as BlobPart], 'c.db3') };
    const got = (await readPointCloudAtTime(src, 'db3', '/os/points/zlib', 1_000_000_000n))!;
    expect(got.pointCount).toBe(expected.pointCount);
    expect(got.positions).toEqual(expected.positions);
  });
});
