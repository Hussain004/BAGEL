/**
 * A dropped .urdf.xacro expands in the browser. Its include names a package
 * BAGEL has not seen, so the modal asks for that package's folder, then
 * expands again once it is mapped. The evaluator itself is checked against
 * ROS xacro in tests/parsers/xacro.test.ts; this proves the modal flow.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fixture = (p: string) => fileURLToPath(new URL(`../fixtures/${p}`, import.meta.url));

test('a xacro with a package include loads once the package folder is mapped', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  // Any loaded file brings up the toolbar; the small LiDAR tile is quickest.
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'survey.laz',
    mimeType: 'application/octet-stream',
    buffer: readFileSync(fixture('las/simple.laz')),
  });
  await page.getByRole('button', { name: 'Load robot model' }).click();

  await page.locator('input[accept=".urdf,.xml,.xacro"]').setInputFiles({
    name: 'demo.urdf.xacro',
    mimeType: 'application/xml',
    buffer: readFileSync(fixture('xacro/demo.urdf.xacro')),
  });
  await expect(page.getByText('Package needed to expand this xacro')).toBeVisible();
  await expect(page.locator('code', { hasText: 'demo_pkg' })).toBeVisible();

  await page.locator('input[webkitdirectory]').setInputFiles(fixture('xacro/demo_pkg'));
  await expect(page.getByText(/Parsed\s+walker\s+with\s+3 links, 2 joints/)).toBeVisible();

  await page.getByRole('button', { name: 'Load robot', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Load robot model' })).toHaveAttribute('title', /demo\.urdf\.xacro \(3 links\)/);
  expect(errors).toEqual([]);
});
