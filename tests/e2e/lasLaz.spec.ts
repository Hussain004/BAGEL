/**
 * A .laz survey tile opens as a point cloud, decoded by laz-perf in the parser
 * worker, and can be coloured by ASPRS class. The decoding itself is
 * unit-tested; what is only provable here is that the WASM loads in a real
 * module worker and the result reaches the 3D panel.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('a .laz file opens in the 3D view and colours by class', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'survey.laz',
    mimeType: 'application/octet-stream',
    buffer: readFileSync(fileURLToPath(new URL('../fixtures/las/simple.laz', import.meta.url))),
  });
  await expect(page.getByLabel('/cloud, sensor_msgs/PointCloud2, 1 messages')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Open 3D scene' }).first().click();
  await expect(page.getByText(/1,065 pts/)).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: /Display/ }).first().click();
  // simple.laz has colour and classes, so both extra modes are offered.
  await expect(page.getByRole('button', { name: 'rgb', exact: true })).toBeVisible();
  const cls = page.getByRole('button', { name: 'class', exact: true });
  await cls.click();
  await expect(cls).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/1,065 pts/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('a remote .copc.laz streams by HTTP Range and never downloads whole', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const bytes = readFileSync(fileURLToPath(new URL('../fixtures/las/deep6.copc.laz', import.meta.url)));
  let ranged = 0;
  let whole = 0;
  await page.context().route('http://bags.test/**', async (route) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
      'Accept-Ranges': 'bytes',
    };
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.method() === 'HEAD') {
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Length': String(bytes.length) } });
    }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers()['range'] ?? '');
    if (!m) {
      whole++;
      return route.fulfill({ status: 200, headers: cors, body: bytes });
    }
    ranged++;
    const start = Number(m[1]);
    const end = Math.min(bytes.length - 1, m[2] ? Number(m[2]) : bytes.length - 1);
    return route.fulfill({
      status: 206,
      headers: { ...cors, 'Content-Range': `bytes ${start}-${end}/${bytes.length}` },
      body: bytes.subarray(start, end + 1),
    });
  });

  await page.goto(`/#b=${encodeURIComponent('http://bags.test/deep6.copc.laz')}`);
  await expect(page.getByLabel('/cloud, sensor_msgs/PointCloud2, 1 messages')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Open 3D scene' }).first().click();
  // All 6,000 points fit the default budget, fetched node by node.
  await expect(page.getByText(/6,000 pts/)).toBeVisible({ timeout: 60_000 });
  expect(whole).toBe(0);
  expect(ranged).toBeGreaterThan(10);
  expect(errors).toEqual([]);
});
