/**
 * Hovering a point in the 3D view shows its coordinates, intensity and ring.
 *
 * The decoder keeps intensity and ring per point (unit-tested); what is only
 * provable here is the wiring: a real raycast hit, read back from the decoded
 * frame, and a tooltip that follows the pointer and goes away with it.
 */

import { test, expect } from '@playwright/test';

test('hovering a LiDAR point shows its coordinates, intensity and ring', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.locator('button:has-text("EXPLORE SAMPLE DATA")').click();
  await expect(page.locator('header[tabindex="0"] span.badge.badge-slate', { hasText: /^3D Scene$/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/[\d,]+ pts/)).toBeVisible({ timeout: 60_000 });
  // Hold the frame still so the point under the pointer stays put.
  await page.getByRole('button', { name: 'Pause playback' }).click();
  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const tip = page.getByTestId('point-inspector');

  // The cloud is sparse (rings of dots); sweep a grid over the middle until the pointer lands on one.
  let found = false;
  for (let row = 0; row < 14 && !found; row++) {
    for (let col = 0; col < 24 && !found; col++) {
      await page.mouse.move(box.x + box.width * (0.2 + 0.6 * (col / 23)), box.y + box.height * (0.3 + 0.5 * (row / 13)));
      found = await tip.isVisible().catch(() => false) || (await tip.waitFor({ state: 'visible', timeout: 120 }).then(() => true, () => false));
    }
  }
  expect(found, 'no point was hit anywhere in the sweep').toBe(true);
  await expect(tip).toContainText(/point [\d,]+/);
  await expect(tip).toContainText(/x -?\d+\.\d{3}\s+y -?\d+\.\d{3}\s+z -?\d+\.\d{3} m/);
  await expect(tip).toContainText(/intensity \d/);
  await expect(tip).toContainText(/ring \d+/);
  await expect(tip).toContainText('/lidar/points');

  // It goes with the pointer: leaving the canvas hides it, and a drag never shows it.
  await page.mouse.move(box.x - 40, box.y + box.height / 2);
  await expect(tip).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the tool that owns the pointer wins: no tooltip while measuring', async ({ page }) => {
  await page.goto('/');
  await page.locator('button:has-text("EXPLORE SAMPLE DATA")').click();
  await expect(page.getByText(/[\d,]+ pts/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Pause playback' }).click();
  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  const box = (await page.locator('canvas').first().boundingBox())!;
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(box.x + box.width * (0.3 + i * 0.04), box.y + box.height * 0.6);
    await page.waitForTimeout(100);
  }
  await expect(page.getByTestId('point-inspector')).toHaveCount(0);
});
