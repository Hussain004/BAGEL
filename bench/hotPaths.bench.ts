/**
 * Timings for the paths a big bag leans on. Run with `pnpm bench`.
 *
 * These are for spotting regressions by eye, not gates: numbers move with the
 * machine, so compare two runs on the same one (before and after a change).
 */
import { bench, describe } from 'vitest';
import { zstdCompressSync } from 'node:zlib';
import { decompress as fzstdDecompress } from 'fzstd';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';
import { deserializeWithSchema } from '../src/parsers/cdr';
import { decodePointCloud2 } from '../src/utils/pointcloud';
import { alignColumns } from '../src/utils/alignSeries';
import { collectMessageDefinitions, flattenSchemaText } from '../tests/fixtures/synth';

/** Same data every run. */
function rng(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
}

describe('PointCloud2 decode, 1M points (x y z intensity, float32)', () => {
  const POINTS = 1_000_000;
  const data = new Uint8Array(POINTS * 16);
  const dv = new DataView(data.buffer);
  const rand = rng(1);
  for (let i = 0; i < POINTS; i++) {
    for (let k = 0; k < 4; k++) dv.setFloat32(i * 16 + k * 4, (rand() - 0.5) * 100, true);
  }
  const field = (name: string, offset: number) => ({ name, offset, datatype: 7, count: 1 });
  const msg = {
    header: { frame_id: 'lidar' }, height: 1, width: POINTS, is_bigendian: false, point_step: 16, row_step: POINTS * 16, is_dense: true, data,
    fields: [field('x', 0), field('y', 4), field('z', 8), field('intensity', 12)],
  };
  bench('intensity colours', () => { decodePointCloud2(msg, { colorMode: 'intensity' }); });
  bench('single colour', () => { decodePointCloud2(msg, { colorMode: 'single' }); });
});

describe('CDR decode, 10k sensor_msgs/Imu', () => {
  const defs = collectMessageDefinitions('sensor_msgs/msg/Imu');
  const schemaText = flattenSchemaText(defs);
  const writer = new MessageWriter(defs);
  const rand = rng(2);
  const cov = () => Array.from({ length: 9 }, () => rand());
  const messages = Array.from({ length: 10_000 }, (_, i) => writer.writeMessage({
    header: { stamp: { sec: i, nanosec: 0 }, frame_id: 'imu' },
    orientation: { x: 0, y: 0, z: 0, w: 1 }, orientation_covariance: cov(),
    angular_velocity: { x: rand(), y: rand(), z: rand() }, angular_velocity_covariance: cov(),
    linear_acceleration: { x: rand(), y: rand(), z: 9.8 }, linear_acceleration_covariance: cov(),
  }));
  bench('10k messages through one cached reader', () => {
    for (const m of messages) deserializeWithSchema(schemaText, m);
  });
});

describe('zstd chunk decompression (fzstd, what MCAP chunks go through)', () => {
  const rand = rng(3);
  const chunk = (size: number, noisy: boolean) => {
    const raw = new Uint8Array(size);
    for (let i = 0; i < size; i++) raw[i] = noisy ? Math.floor(rand() * 256) : (i * 7) & 0x3f;
    return { raw, packed: new Uint8Array(zstdCompressSync(raw)) };
  };
  const mixed = [chunk(4_096, false), chunk(65_536, true), chunk(1_048_576, false), chunk(1_048_576, true), chunk(262_144, false)];
  bench('5 mixed chunks, ~2.4 MB', () => {
    for (const c of mixed) fzstdDecompress(c.packed, new Uint8Array(c.raw.length));
  });
});

describe('aligning plot series on one time axis', () => {
  const rand = rng(4);
  const column = (n: number, step: number) => {
    const times = new Float64Array(n);
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) { times[i] = i * step + rand() * step * 0.1; values[i] = rand(); }
    return { times, values };
  };
  const columns = [column(100_000, 0.01), column(50_000, 0.02), column(10_000, 0.1)];
  bench('3 series, 160k samples', () => { alignColumns(columns); });
});
