/**
 * Opening topics fills the grid evenly instead of adding ever thinner columns,
 * and the panels already open stay mounted (a 3D view keeps its camera).
 */

import { test, expect } from '@playwright/test';

test('new panels fill three columns, then stack, without remounting the ones already open', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.locator('button:has-text("EXPLORE SAMPLE DATA")').click();
  const headers = page.locator('header[tabindex="0"]');
  await expect(headers).toHaveCount(4, { timeout: 60_000 });

  // Tag the 3D canvas; a remount would replace the element and lose the tag.
  const canvas = page.locator('header[tabindex="0"]', { hasText: '/lidar/points' }).locator('xpath=..').locator('canvas').first();
  await canvas.evaluate((el) => el.setAttribute('data-kept', 'yes'));

  // Some topics join an open panel (a laser scan becomes a 3D layer, detections draw on the
  // camera image), so keep opening topics until four new panels exist.
  for (const topic of ['/rosout', '/tf', '/imu/data', '/detections_3d', '/gps/fix', '/particles', '/odom']) {
    if ((await headers.count()) >= 8) break;
    await page.locator('.topic-row', { hasText: topic }).first().click();
    await page.waitForTimeout(400);
  }
  await expect(headers).toHaveCount(8);
  await expect(page.locator('canvas[data-kept="yes"]')).toHaveCount(1);

  // No panel ends up a sliver: at 1440 px the narrowest is still a usable width.
  const widths = await headers.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  expect(Math.min(...widths)).toBeGreaterThan(250);
  expect(errors).toEqual([]);
});
