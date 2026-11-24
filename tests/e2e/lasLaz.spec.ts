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
