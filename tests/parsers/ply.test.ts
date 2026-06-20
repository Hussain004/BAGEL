import { describe, it, expect, beforeEach } from 'vitest';
import { parsePly, readPointCloudAtTimePly, disposePlyCache, PLY_MAGIC } from '../../src/parsers/ply';
import type { BagSource } from '../../src/parsers/source';

function fileSource(bytes: Uint8Array, name = 'test.ply'): BagSource {
  const file = new File([bytes], name, { type: 'application/octet-stream' });
  return { kind: 'file', file };
}

function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function asciiPly(
  props: { name: string; type: string }[],
  rows: string[],
): Uint8Array {
  const header = [
    'ply',
    'format ascii 1.0',
    `element vertex ${rows.length}`,
    ...props.map((p) => `property ${p.type} ${p.name}`),
    'end_header',
    '',
  ].join('\n');
  return encode(header + rows.join('\n') + '\n');
}

function binaryLePly(
  props: { name: string; type: 'float' | 'uchar' | 'double' }[],
  points: number[][],
  bigEndian = false,
): Uint8Array {
  const typeInfo: Record<string, { size: number; write: (dv: DataView, off: number, v: number, le: boolean) => void }> = {
    float:  { size: 4, write: (dv, o, v, le) => dv.setFloat32(o, v, le) },
    double: { size: 8, write: (dv, o, v, le) => dv.setFloat64(o, v, le) },
    uchar:  { size: 1, write: (dv, o, v) => dv.setUint8(o, v) },
  };
  const le = !bigEndian;
  const fmtStr = bigEndian ? 'binary_big_endian' : 'binary_little_endian';
  const header = [
    'ply',
    `format ${fmtStr} 1.0`,
    `element vertex ${points.length}`,
    ...props.map((p) => `property ${p.type} ${p.name}`),
    'end_header',
    '',
  ].join('\n');
  const headerBytes = encode(header);
  const pointStep = props.reduce((s, p) => s + typeInfo[p.type].size, 0);
  const dataBytes = new Uint8Array(points.length * pointStep);
  const dv = new DataView(dataBytes.buffer);
  for (let pi = 0; pi < points.length; pi++) {
    let off = pi * pointStep;
    for (let fi = 0; fi < props.length; fi++) {
      const { size, write } = typeInfo[props[fi].type];
      write(dv, off, points[pi][fi] ?? 0, le);
      off += size;
    }
  }
  const out = new Uint8Array(headerBytes.length + dataBytes.length);
  out.set(headerBytes);
  out.set(dataBytes, headerBytes.length);
  return out;
}

beforeEach(() => disposePlyCache());

describe('PLY_MAGIC', () => {
  it('equals "ply"', () => {
    expect(PLY_MAGIC).toBe('ply');
  });
});

describe('parsePly - ascii', () => {
  it('returns correct summary shape for 3-point xyz cloud', async () => {
    const bytes = asciiPly(
      [{ name: 'x', type: 'float' }, { name: 'y', type: 'float' }, { name: 'z', type: 'float' }],
      ['0.1 0.2 0.3', '1.0 2.0 3.0', '-1.0 -2.0 -3.0'],
    );
    const summary = await parsePly(fileSource(bytes));
    expect(summary.format).toBe('ply');
    expect(summary.totalMessageCount).toBe(1);
    expect(summary.topics).toHaveLength(1);
    expect(summary.topics[0]).toMatchObject({
      name: '/cloud',
      type: 'sensor_msgs/PointCloud2',
      serializationFormat: 'ply',
    });
    expect(summary.startTime).toBe(0n);
    expect(summary.endTime).toBe(1_000_000n);
  });

  it('uses file name in the summary', async () => {
    const bytes = asciiPly(
      [{ name: 'x', type: 'float' }, { name: 'y', type: 'float' }, { name: 'z', type: 'float' }],
      ['0 0 0'],
    );
    const summary = await parsePly(fileSource(bytes, 'scene.ply'));
    expect(summary.fileName).toBe('scene.ply');
  });

  it('throws on missing end_header', async () => {
    const bytes = encode('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\n');
    await expect(parsePly(fileSource(bytes))).rejects.toThrow('end_header');
  });

  it('throws when xyz properties are absent', async () => {
    const bytes = asciiPly(
      [{ name: 'intensity', type: 'float' }],
      ['0.5'],
    );
    await expect(parsePly(fileSource(bytes))).rejects.toThrow();
  });
});

describe('readPointCloudAtTimePly - ascii', () => {
  it('returns positions for 2 xyz points', async () => {
    const bytes = asciiPly(
      [{ name: 'x', type: 'float' }, { name: 'y', type: 'float' }, { name: 'z', type: 'float' }],
      ['1.0 2.0 3.0', '4.0 5.0 6.0'],
    );
    const result = await readPointCloudAtTimePly(fileSource(bytes));
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe(0n);
    expect(result!.positions).toBeInstanceOf(Float32Array);
    expect(result!.positions.length).toBe(6);
    expect(result!.positions[0]).toBeCloseTo(1.0);
    expect(result!.positions[1]).toBeCloseTo(2.0);
    expect(result!.positions[2]).toBeCloseTo(3.0);
  });

  it('returns colors as Float32Array', async () => {
    const bytes = asciiPly(
      [{ name: 'x', type: 'float' }, { name: 'y', type: 'float' }, { name: 'z', type: 'float' }],
      ['0 0 0'],
    );
    const result = await readPointCloudAtTimePly(fileSource(bytes));
    expect(result).not.toBeNull();
    expect(result!.colors).toBeInstanceOf(Float32Array);
  });

  it('packs red/green/blue uchar into rgb field', async () => {
    const bytes = asciiPly(
      [
        { name: 'x', type: 'float' },
        { name: 'y', type: 'float' },
        { name: 'z', type: 'float' },
        { name: 'red', type: 'uchar' },
        { name: 'green', type: 'uchar' },
        { name: 'blue', type: 'uchar' },
      ],
      ['0 0 0 255 0 0'],
    );
    const result = await readPointCloudAtTimePly(fileSource(bytes), 'rgb');
    expect(result).not.toBeNull();
    // Red channel dominant
    expect(result!.colors[0]).toBeGreaterThan(0.5);
    expect(result!.colors[1]).toBeCloseTo(0, 1);
    expect(result!.colors[2]).toBeCloseTo(0, 1);
  });

  it('reads intensity field', async () => {
    const bytes = asciiPly(
      [
        { name: 'x', type: 'float' },
        { name: 'y', type: 'float' },
        { name: 'z', type: 'float' },
        { name: 'intensity', type: 'float' },
      ],
      ['0 0 0 0.5', '1 2 3 1.0'],
    );
    const result = await readPointCloudAtTimePly(fileSource(bytes), 'intensity');
    expect(result).not.toBeNull();
    expect(result!.colors).toBeInstanceOf(Float32Array);
  });

  it('respects maxPoints', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => `${i} ${i} ${i}`);
    const bytes = asciiPly(
      [{ name: 'x', type: 'float' }, { name: 'y', type: 'float' }, { name: 'z', type: 'float' }],
      rows,
    );
    const result = await readPointCloudAtTimePly(fileSource(bytes), 'height', 4);
    expect(result).not.toBeNull();
    expect(result!.positions.length).toBeLessThanOrEqual(12);
  });
});

describe('readPointCloudAtTimePly - binary little endian', () => {
  it('reads xyz from binary LE data', async () => {
    const props = [
      { name: 'x', type: 'float' as const },
      { name: 'y', type: 'float' as const },
      { name: 'z', type: 'float' as const },
    ];
    const bytes = binaryLePly(props, [[10, 20, 30], [-1, -2, -3]]);
    const result = await readPointCloudAtTimePly(fileSource(bytes));
    expect(result).not.toBeNull();
    expect(result!.positions.length).toBe(6);
    expect(result!.positions[0]).toBeCloseTo(10);
    expect(result!.positions[3]).toBeCloseTo(-1);
  });

  it('reads rgb from uchar red/green/blue in binary LE', async () => {
    const props = [
      { name: 'x', type: 'float' as const },
      { name: 'y', type: 'float' as const },
      { name: 'z', type: 'float' as const },
      { name: 'red', type: 'uchar' as const },
      { name: 'green', type: 'uchar' as const },
      { name: 'blue', type: 'uchar' as const },
    ];
    const bytes = binaryLePly(props, [[0, 0, 0, 0, 255, 0]]);
    const result = await readPointCloudAtTimePly(fileSource(bytes), 'rgb');
    expect(result).not.toBeNull();
    // Green channel dominant
    expect(result!.colors[1]).toBeGreaterThan(0.5);
    expect(result!.colors[0]).toBeCloseTo(0, 1);
    expect(result!.colors[2]).toBeCloseTo(0, 1);
  });
});

describe('readPointCloudAtTimePly - binary big endian', () => {
  it('reads xyz from binary BE data', async () => {
    const props = [
      { name: 'x', type: 'float' as const },
      { name: 'y', type: 'float' as const },
      { name: 'z', type: 'float' as const },
    ];
    const bytes = binaryLePly(props, [[5, 6, 7]], /* bigEndian */ true);
    const result = await readPointCloudAtTimePly(fileSource(bytes));
    expect(result).not.toBeNull();
    expect(result!.positions[0]).toBeCloseTo(5);
    expect(result!.positions[1]).toBeCloseTo(6);
    expect(result!.positions[2]).toBeCloseTo(7);
  });
});

describe('parsePly - caching', () => {
  it('returns the same summary instance on second call', async () => {
    const bytes = asciiPly(
      [{ name: 'x', type: 'float' }, { name: 'y', type: 'float' }, { name: 'z', type: 'float' }],
      ['0 0 0'],
    );
    const source = fileSource(bytes);
    const a = await parsePly(source);
    const b = await parsePly(source);
    expect(a).toBe(b);
  });

  it('disposePlyCache clears the cache', async () => {
    const bytes = asciiPly(
      [{ name: 'x', type: 'float' }, { name: 'y', type: 'float' }, { name: 'z', type: 'float' }],
      ['0 0 0'],
    );
    const source = fileSource(bytes);
    const a = await parsePly(source);
    disposePlyCache();
    const b = await parsePly(source);
    expect(a).not.toBe(b);
  });
});
