/**
 * A grid_map_msgs/GridMap topic routes to the 3D scene and renders a point per
 * known cell. The cell geometry is unit-tested; this proves routing and the
 * worker path.
 */

import { test, expect } from '@playwright/test';
import { writeSyntheticMcap, type RosmsgDef } from '../fixtures/synth';

test('a GridMap opens in the 3D scene', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
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
  const rows = 40, cols = 30;
  const elevation = Float32Array.from({ length: rows * cols }, (_, i) => (i % 97 === 0 ? NaN : Math.sin(i / 50)));
  const value = {
    header: { stamp: { sec: 1, nanosec: 0 }, frame_id: 'odom' },
    info: { resolution: 0.1, length_x: rows * 0.1, length_y: cols * 0.1, pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } },
    layers: ['elevation'],
    basic_layers: ['elevation'],
    data: [{ layout: { dim: [{ label: 'column_index', size: cols, stride: rows * cols }, { label: 'row_index', size: rows, stride: rows }], data_offset: 0 }, data: elevation }],
    outer_start_index: 3,
    inner_start_index: 7,
  };
  const bytes = await writeSyntheticMcap([{ topic: '/elevation_map', type: 'grid_map_msgs/msg/GridMap', extraDefinitions: [gm, info], messages: [{ logTime: 1_000_000_000n, value }] }]);

  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'grid.mcap', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
  await page.getByRole('button', { name: 'Open 3D scene' }).first().click({ timeout: 60_000 });
  // 1,200 cells, 13 of them NaN (every 97th).
  await expect(page.getByText(/1,187 pts/)).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
});
