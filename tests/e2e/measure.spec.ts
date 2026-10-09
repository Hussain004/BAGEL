/**
 * 3D measure tool, exercised in a real browser.
 *
 * The distance maths and formatting have unit tests. What is only provable
 * here is the wiring: two clicks give a readout, a drag (orbit) does not place
 * a point, a third click starts over, and Esc clears then exits.
 */

import { test, expect } from '@playwright/test';

const SAMPLE_BUTTON = 'button:has-text("EXPLORE SAMPLE DATA")';

test('two clicks measure, a drag does not, Esc clears then turns the tool off', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.locator(SAMPLE_BUTTON).click();
  await expect(page.locator('header[tabindex="0"] span.badge.badge-slate', { hasText: /^3D Scene$/ })).toBeVisible({ timeout: 60_000 });

  // The scene is covered by a loading overlay until its first cloud has decoded; clicks before that miss the canvas.
  await expect(page.getByText(/[\d,]+ pts/)).toBeVisible({ timeout: 60_000 });
  // The world frame is auto-picked once the TF tree loads, and a frame change clears a measurement (by design).
  await expect(page.getByText(/lidar_link\s*→\s*map/)).toBeVisible({ timeout: 60_000 });
  const canvas = page.locator('canvas').first();
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });

  await page.getByRole('button', { name: 'Measure', exact: true }).click();
  const readout = page.getByTestId('measure-readout');
  await expect(readout).toHaveText('Click two points to measure');

  // An orbit drag must not count as a click.
  const a = at(0.4, 0.7);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + 5, { steps: 4 });
  await page.mouse.up();
  await expect(readout).toHaveText('Click two points to measure');

  await page.mouse.click(a.x, a.y);
  await expect(readout).toHaveText('Click a second point');
  const b = at(0.6, 0.7);
  await page.mouse.click(b.x, b.y);
  await expect(readout).toContainText(/^[\d.]+ (m|cm|mm)\s+\(dx [+-]/);

  // A third click starts over, and a fourth completes a new measurement.
  await page.mouse.click(a.x, a.y);
  await expect(readout).toHaveText('Click a second point');
  await page.mouse.click(b.x, b.y);
  await expect(readout).toContainText(/^[\d.]+ (m|cm|mm)\s+\(dx [+-]/);

  await page.keyboard.press('Escape');
  await expect(readout).toHaveText('Click two points to measure');
  await page.keyboard.press('Escape');
  await expect(readout).toHaveCount(0);
  expect(errors).toEqual([]);
});
