/**
 * A zstd CompressedPointCloud2 topic routes to the 3D scene and renders. The
 * codecs are unit-tested; this proves the routing and the worker path.
 */

import { test, expect } from '@playwright/test';
import zlib from 'node:zlib';
import { collectMessageDefinitions, writeSyntheticMcap, type RosmsgDef } from '../fixtures/synth';

test('a zstd CompressedPointCloud2 opens in the 3D scene', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const pc2 = collectMessageDefinitions('sensor_msgs/msg/PointCloud2');
  const def: RosmsgDef = {
    name: 'point_cloud_interfaces/CompressedPointCloud2',
    definitions: [...pc2[0]!.definitions.map((f) => (f.name === 'data' ? { ...f, name: 'compressed_data' } : f)), { name: 'format', type: 'string' }],
  };
  const n = 1000;
  const data = new Uint8Array(n * 12);
  const v = new DataView(data.buffer);
  for (let i = 0; i < n; i++) {
    v.setFloat32(i * 12, Math.cos(i / 50) * 4, true);
    v.setFloat32(i * 12 + 4, Math.sin(i / 50) * 4, true);
    v.setFloat32(i * 12 + 8, i / 500, true);
  }
  const value = {
    header: { stamp: { sec: 1, nanosec: 0 }, frame_id: 'lidar' },
    height: 1, width: n, is_bigendian: false, point_step: 12, row_step: n * 12, is_dense: true,
    fields: ['x', 'y', 'z'].map((name, k) => ({ name, offset: k * 4, datatype: 7, count: 1 })),
    compressed_data: new Uint8Array(zlib.zstdCompressSync(data)),
    format: 'zstd',
  };
  const bytes = await writeSyntheticMcap([{
    topic: '/points/zstd', type: 'point_cloud_interfaces/msg/CompressedPointCloud2', extraDefinitions: [def],
    messages: [{ logTime: 1_000_000_000n, value }],
  }]);

  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'compressed.mcap', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  await page.getByRole('button', { name: 'Open 3D scene' }).first().click({ timeout: 60_000 });
  await expect(page.getByText(/1,000 pts/)).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
});
