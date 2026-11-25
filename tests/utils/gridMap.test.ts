/**
 * GridMap as a point cloud. A plane z = 0.3x - 0.2y + 1 is written into a
 * grid the way grid_map stores it, then moved with grid_map's own move()
 * rule (GridMap.cpp: position += k*res, startIndex += -k, data stays in the
 * buffer). Every point must stay on the plane, in both storage orders.
 */
import { describe, it, expect } from 'vitest';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';
import { colorLayer, gridMapToPointCloud2, heightLayer } from '../../src/utils/gridMap';
import { decodePointCloud2 } from '../../src/utils/pointcloud';
import { readPointCloudAtTime } from '../../src/parsers/core';
import { collectMessageDefinitions, writeSyntheticDb3, writeSyntheticMcap, type RosmsgDef } from '../fixtures/synth';

const plane = (x: number, y: number) => 0.3 * x - 0.2 * y + 1;
const RES = 0.5;
const ROWS = 8; // along x
const COLS = 6; // along y

/** Buffer of `ROWS x COLS` holding plane(world position of the cell), as grid_map lays it out. */
function grid(px: number, py: number, startR: number, startC: number, rowMajor: boolean, nanAt: Array<[number, number]> = []) {
  const lenX = ROWS * RES, lenY = COLS * RES;
  const data = new Array<number>(ROWS * COLS);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ur = (((r - startR) % ROWS) + ROWS) % ROWS;
      const uc = (((c - startC) % COLS) + COLS) % COLS;
      const x = px + lenX / 2 - RES / 2 - ur * RES;
      const y = py + lenY / 2 - RES / 2 - uc * RES;
      const nan = nanAt.some(([a, b]) => a === r && b === c);
      data[rowMajor ? r * COLS + c : c * ROWS + r] = nan ? NaN : plane(x, y);
    }
  }
  const dim = rowMajor
    ? [{ label: 'row_index', size: ROWS, stride: ROWS * COLS }, { label: 'column_index', size: COLS, stride: COLS }]
    : [{ label: 'column_index', size: COLS, stride: ROWS * COLS }, { label: 'row_index', size: ROWS, stride: ROWS }];
  return { layout: { dim, data_offset: 0 }, data: Float32Array.from(data) };
}

function msg(px: number, py: number, startR: number, startC: number, rowMajor = false, extra: Record<string, unknown> = {}) {
  const elevation = grid(px, py, startR, startC, rowMajor, [[2, 3]]);
  const traversability = { ...elevation, data: elevation.data.map((_, i) => i / 100) };
  return {
    header: { stamp: { sec: 1, nanosec: 0 }, frame_id: 'odom' },
    info: { resolution: RES, length_x: ROWS * RES, length_y: COLS * RES, pose: { position: { x: px, y: py, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } },
    layers: ['traversability', 'elevation'],
    basic_layers: ['elevation'],
    data: [traversability, elevation],
    outer_start_index: startR,
    inner_start_index: startC,
    ...extra,
  };
}

function points(m: Record<string, unknown>) {
  const cloud = gridMapToPointCloud2(m)!;
  const d = decodePointCloud2(cloud, { colorMode: 'intensity' })!;
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i < d.pointCount; i++) out.push([d.positions[i * 3]!, d.positions[i * 3 + 1]!, d.positions[i * 3 + 2]!]);
  return out;
}

const onPlane = (pts: Array<[number, number, number]>) => pts.every(([x, y, z]) => Math.abs(z - plane(x, y)) < 1e-5);

describe('gridMapToPointCloud2', () => {
  it('puts every cell on the plane, in both storage orders, skipping NaN cells', () => {
    for (const rowMajor of [false, true]) {
      const pts = points(msg(10, -4, 0, 0, rowMajor));
      expect(pts).toHaveLength(ROWS * COLS - 1);
      expect(onPlane(pts)).toBe(true);
    }
  });

  it('puts unwrapped (0,0) at +x +y, centred on the map position', () => {
    const pts = points(msg(10, -4, 0, 0));
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    expect(Math.max(...xs)).toBeCloseTo(10 + (ROWS * RES) / 2 - RES / 2);
    expect(Math.min(...xs)).toBeCloseTo(10 - (ROWS * RES) / 2 + RES / 2);
    expect(Math.max(...ys)).toBeCloseTo(-4 + (COLS * RES) / 2 - RES / 2);
  });

  it("stays on the plane after grid_map's move() in either direction (circular buffer)", () => {
    for (const [kx, ky] of [[3, 0], [0, -2], [5, 4], [-7, 9], [13, -11]]) {
      const startR = (((0 - kx) % ROWS) + ROWS) % ROWS;
      const startC = (((0 - ky) % COLS) + COLS) % COLS;
      for (const rowMajor of [false, true]) {
        const pts = points(msg(10 + kx * RES, -4 + ky * RES, startR, startC, rowMajor));
        expect(onPlane(pts), `move ${kx},${ky}`).toBe(true);
        expect(new Set(pts.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`)).size).toBe(pts.length);
      }
    }
  });

  it('carries a second layer as intensity, and a packed color layer as rgb', () => {
    const d = decodePointCloud2(gridMapToPointCloud2(msg(0, 0, 0, 0))!, { colorMode: 'intensity' })!;
    expect(d.pointCount).toBe(ROWS * COLS - 1);
    const m = msg(0, 0, 0, 0);
    const f = new Float32Array(1);
    new Uint32Array(f.buffer)[0] = 0x00ff0000; // pure red, packed the PCL way
    const color = { ...m.data[1]!, data: new Float32Array(ROWS * COLS).fill(f[0]!) };
    const withColor = { ...m, layers: [...m.layers, 'color'], data: [...m.data, color] };
    const cloud = gridMapToPointCloud2(withColor)!;
    expect(cloud.fields!.map((x) => x.name)).toEqual(['x', 'y', 'z', 'rgb']);
    const rgb = decodePointCloud2(cloud, { colorMode: 'rgb' })!;
    expect([rgb.colors[0], rgb.colors[1], rgb.colors[2]]).toEqual([1, 0, 0]);
  });

  it('picks the height and colour layers sensibly', () => {
    expect(heightLayer(['traversability', 'elevation'])).toBe('elevation');
    expect(heightLayer(['elevation_inpainted', 'normal_x'])).toBe('elevation_inpainted');
    expect(heightLayer(['occupancy'])).toBe('occupancy');
    expect(colorLayer(['elevation', 'color', 'variance'], 'elevation')).toBe('color');
    expect(colorLayer(['elevation'], 'elevation')).toBeUndefined();
  });

  it('returns null for unusable maps instead of throwing', () => {
    const m = msg(0, 0, 0, 0);
    expect(gridMapToPointCloud2({ ...m, layers: [], data: [] })).toBeNull();
    expect(gridMapToPointCloud2({ ...m, info: { ...m.info, resolution: 0 } })).toBeNull();
    const short = { ...m.data[1]!, data: new Float32Array(5) };
    expect(gridMapToPointCloud2({ ...m, data: [m.data[0], short] })).toBeNull();
  });
});

describe('a GridMap topic in a bag', () => {
  const TYPE = 'grid_map_msgs/msg/GridMap';
  const info: RosmsgDef = {
    name: 'grid_map_msgs/GridMapInfo',
    definitions: [
      { name: 'resolution', type: 'float64' }, { name: 'length_x', type: 'float64' }, { name: 'length_y', type: 'float64' },
      { name: 'pose', type: 'geometry_msgs/Pose', isComplex: true },
    ],
  };
  const gm: RosmsgDef = {
    name: 'grid_map_msgs/GridMap',
    definitions: [
      { name: 'header', type: 'std_msgs/Header', isComplex: true }, { name: 'info', type: 'grid_map_msgs/GridMapInfo', isComplex: true },
      { name: 'layers', type: 'string', isArray: true }, { name: 'basic_layers', type: 'string', isArray: true },
      { name: 'data', type: 'std_msgs/Float32MultiArray', isComplex: true, isArray: true },
      { name: 'outer_start_index', type: 'uint16' }, { name: 'inner_start_index', type: 'uint16' },
    ],
  };
  const value = msg(2, 3, 5, 1);
  const expected = points(value);

  it('decodes from MCAP and from .db3 (bundled definition), with a moved buffer', async () => {
    const mcap = await writeSyntheticMcap([{ topic: '/elevation_map', type: TYPE, extraDefinitions: [gm, info], messages: [{ logTime: 1_000_000_000n, value }] }]);
    const fromMcap = (await readPointCloudAtTime({ kind: 'file', file: new File([mcap as BlobPart], 'g.mcap') }, 'mcap', '/elevation_map', 1_000_000_000n))!;
    expect(fromMcap.pointCount).toBe(expected.length);

    const deps = ['std_msgs/msg/Header', 'geometry_msgs/msg/Pose', 'std_msgs/msg/Float32MultiArray'].flatMap((t) => collectMessageDefinitions(t));
    const writer = new MessageWriter([gm, info, ...deps] as never);
    const db3 = await writeSyntheticDb3([{ topic: '/elevation_map', type: TYPE, messages: [{ timestampNs: 1_000_000_000n, data: writer.writeMessage(value) }] }]);
    const fromDb3 = (await readPointCloudAtTime({ kind: 'file', file: new File([db3 as BlobPart], 'g.db3') }, 'db3', '/elevation_map', 1_000_000_000n))!;
    expect(fromDb3.pointCount).toBe(expected.length);
    expect(fromDb3.positions).toEqual(fromMcap.positions);
  });
});
