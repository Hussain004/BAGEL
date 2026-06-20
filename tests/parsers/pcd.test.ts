import { describe, it, expect, beforeEach } from 'vitest';
import { parsePcd, readPointCloudAtTimePcd, disposePcdCache, PCD_MAGIC } from '../../src/parsers/pcd';
import type { BagSource } from '../../src/parsers/source';

function fileSource(bytes: Uint8Array, name = 'test.pcd'): BagSource {
  const file = new File([bytes], name, { type: 'application/octet-stream' });
  return { kind: 'file', file };
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// Build a minimal ASCII PCD with the given fields and rows.
function asciiPcd(fields: string[], sizes: number[], types: string[], rows: string[]): Uint8Array {
  const pointCount = rows.length;
  const header = [
    '# .PCD v0.7',
    `FIELDS ${fields.join(' ')}`,
    `SIZE ${sizes.join(' ')}`,
    `TYPE ${types.join(' ')}`,
    `COUNT ${fields.map(() => '1').join(' ')}`,
    `WIDTH ${pointCount}`,
    'HEIGHT 1',
    `POINTS ${pointCount}`,
    'DATA ascii',
    '',
  ].join('\n');
  return encode(header + rows.join('\n') + '\n');
}

function binaryPcd(
  fields: string[],
  sizes: number[],
  types: string[],
  points: number[][],
): Uint8Array {
  const pointCount = points.length;
  const header = [
    '# .PCD v0.7',
    `FIELDS ${fields.join(' ')}`,
    `SIZE ${sizes.join(' ')}`,
    `TYPE ${types.join(' ')}`,
    `COUNT ${fields.map(() => '1').join(' ')}`,
    `WIDTH ${pointCount}`,
    'HEIGHT 1',
    `POINTS ${pointCount}`,
    'DATA binary',
    '',
  ].join('\n');
  const headerBytes = encode(header);
  const pointStep = sizes.reduce((a, b) => a + b, 0);
  const dataBytes = new Uint8Array(pointCount * pointStep);
  const dv = new DataView(dataBytes.buffer);
  for (let pi = 0; pi < pointCount; pi++) {
    let off = pi * pointStep;
    for (let fi = 0; fi < fields.length; fi++) {
      const val = points[pi][fi] ?? 0;
      const size = sizes[fi];
      const type = types[fi];
      if (type === 'F' && size === 4) dv.setFloat32(off, val, true);
      else if (type === 'U' && size === 4) dv.setUint32(off, val >>> 0, true);
      else if (type === 'I' && size === 4) dv.setInt32(off, val, true);
      off += size;
    }
  }
  const out = new Uint8Array(headerBytes.length + dataBytes.length);
  out.set(headerBytes);
  out.set(dataBytes, headerBytes.length);
  return out;
}

beforeEach(() => disposePcdCache());

describe('PCD_MAGIC', () => {
  it('starts with # .PCD', () => {
    expect(PCD_MAGIC).toBe('# .PCD');
  });
});

describe('parsePcd - ascii', () => {
  it('returns correct summary shape for a 3-point xyz cloud', async () => {
    const bytes = asciiPcd(
      ['x', 'y', 'z'],
      [4, 4, 4],
      ['F', 'F', 'F'],
      ['0.1 0.2 0.3', '1.0 2.0 3.0', '-1.0 -2.0 -3.0'],
    );
    const summary = await parsePcd(fileSource(bytes));
    expect(summary.format).toBe('pcd');
    expect(summary.totalMessageCount).toBe(1);
    expect(summary.topics).toHaveLength(1);
    expect(summary.topics[0]).toMatchObject({
      name: '/cloud',
      type: 'sensor_msgs/PointCloud2',
      serializationFormat: 'pcd',
    });
    expect(summary.startTime).toBe(0n);
    expect(summary.endTime).toBe(1_000_000n);
  });

  it('uses the file name in the summary', async () => {
    const bytes = asciiPcd(['x', 'y', 'z'], [4, 4, 4], ['F', 'F', 'F'], ['0 0 0']);
    const summary = await parsePcd(fileSource(bytes, 'lidar.pcd'));
    expect(summary.fileName).toBe('lidar.pcd');
  });
});

describe('readPointCloudAtTimePcd - ascii', () => {
  it('returns positions for 2 xyz points', async () => {
    const bytes = asciiPcd(
      ['x', 'y', 'z'],
      [4, 4, 4],
      ['F', 'F', 'F'],
      ['1.0 2.0 3.0', '4.0 5.0 6.0'],
    );
    const source = fileSource(bytes);
    const result = await readPointCloudAtTimePcd(source);
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(0n);
    expect(result!.positions).toBeInstanceOf(Float32Array);
    // 2 points * 3 components = 6 values
    expect(result!.positions.length).toBe(6);
    expect(result!.positions[0]).toBeCloseTo(1.0);
    expect(result!.positions[1]).toBeCloseTo(2.0);
    expect(result!.positions[2]).toBeCloseTo(3.0);
  });

  it('returns colors as Float32Array', async () => {
    const bytes = asciiPcd(
      ['x', 'y', 'z'],
      [4, 4, 4],
      ['F', 'F', 'F'],
      ['0 0 0', '1 2 3'],
    );
    const result = await readPointCloudAtTimePcd(fileSource(bytes));
    expect(result).not.toBeNull();
    expect(result!.colors).toBeInstanceOf(Float32Array);
  });

  it('handles an empty cloud (0 points)', async () => {
    const bytes = asciiPcd(['x', 'y', 'z'], [4, 4, 4], ['F', 'F', 'F'], []);
    const result = await readPointCloudAtTimePcd(fileSource(bytes));
    // decodePointCloud2 returns null for empty clouds
    expect(result).toBeNull();
  });

  it('respects maxPoints', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => `${i} ${i} ${i}`);
    const bytes = asciiPcd(['x', 'y', 'z'], [4, 4, 4], ['F', 'F', 'F'], rows);
    const result = await readPointCloudAtTimePcd(fileSource(bytes), 'height', 3);
    expect(result).not.toBeNull();
    // positions has 3 * 3 = 9 values (at most 3 points)
    expect(result!.positions.length).toBeLessThanOrEqual(9);
  });

  it('decodes rgb field from packed float', async () => {
    // Pack rgb = red=255, green=0, blue=0 as a FLOAT32 reinterpretation of 0x00FF0000
    const packed = new DataView(new ArrayBuffer(4));
    packed.setUint32(0, 0x00ff0000, true);
    const rgbFloat = packed.getFloat32(0, true);
    const bytes = asciiPcd(
      ['x', 'y', 'z', 'rgb'],
      [4, 4, 4, 4],
      ['F', 'F', 'F', 'F'],
      [`0 0 0 ${rgbFloat}`],
    );
    const result = await readPointCloudAtTimePcd(fileSource(bytes), 'rgb');
    expect(result).not.toBeNull();
    expect(result!.colors).toBeInstanceOf(Float32Array);
    // In rgb mode, the red channel should dominate
    expect(result!.colors[0]).toBeGreaterThan(0.5); // r
    expect(result!.colors[1]).toBeCloseTo(0, 1);    // g
    expect(result!.colors[2]).toBeCloseTo(0, 1);    // b
  });
});

describe('parsePcd - binary', () => {
  it('returns correct point count for binary xyz cloud', async () => {
    const points = [[1, 2, 3], [4, 5, 6], [7, 8, 9]];
    const bytes = binaryPcd(['x', 'y', 'z'], [4, 4, 4], ['F', 'F', 'F'], points);
    const summary = await parsePcd(fileSource(bytes));
    expect(summary.format).toBe('pcd');
    expect(summary.totalMessageCount).toBe(1);
  });

  it('reads xyz positions correctly from binary data', async () => {
    const points = [[10, 20, 30], [-5, -10, -15]];
    const bytes = binaryPcd(['x', 'y', 'z'], [4, 4, 4], ['F', 'F', 'F'], points);
    const result = await readPointCloudAtTimePcd(fileSource(bytes));
    expect(result).not.toBeNull();
    expect(result!.positions.length).toBe(6);
    expect(result!.positions[0]).toBeCloseTo(10);
    expect(result!.positions[1]).toBeCloseTo(20);
    expect(result!.positions[2]).toBeCloseTo(30);
  });

  it('handles intensity field in binary data', async () => {
    const points = [[1, 2, 3, 0.75], [4, 5, 6, 0.25]];
    const bytes = binaryPcd(
      ['x', 'y', 'z', 'intensity'],
      [4, 4, 4, 4],
      ['F', 'F', 'F', 'F'],
      points,
    );
    const result = await readPointCloudAtTimePcd(fileSource(bytes), 'intensity');
    expect(result).not.toBeNull();
    expect(result!.colors).toBeInstanceOf(Float32Array);
    expect(result!.colors.length).toBe(6); // 2 points * 3 rgb channels
  });
});

describe('parsePcd - caching', () => {
  it('returns the same summary instance on second call', async () => {
    const bytes = asciiPcd(['x', 'y', 'z'], [4, 4, 4], ['F', 'F', 'F'], ['0 0 0']);
    const source = fileSource(bytes);
    const a = await parsePcd(source);
    const b = await parsePcd(source);
    expect(a).toBe(b);
  });

  it('disposePcdCache clears the cache', async () => {
    const bytes = asciiPcd(['x', 'y', 'z'], [4, 4, 4], ['F', 'F', 'F'], ['0 0 0']);
    const source = fileSource(bytes);
    const a = await parsePcd(source);
    disposePcdCache();
    const b = await parsePcd(source);
    expect(a).not.toBe(b);
  });
});
