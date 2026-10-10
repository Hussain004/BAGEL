/**
 * Label a range, export its camera frames with the paired LiDAR sweeps, and
 * open the zip that comes down.
 */

import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

async function openSample(page: Page) {
  await page.goto('/');
  await page.locator('button:has-text("EXPLORE SAMPLE DATA")').click();
  await expect(page.locator('#timeline-track')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Pause playback' }).click();
}

test('export the frames of a labelled range, with paired point clouds', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openSample(page);

  // A range from about 6 s to 12 s: Home, seek right, mark, seek further, mark.
  const box = (await page.locator('#timeline-track').boundingBox())!;
  const y = box.y + box.height / 2;
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  const name = page.getByPlaceholder('Bookmark name');
  await name.fill('left turn');
  await name.press('Enter');

  await page.getByRole('button', { name: /Open labels \(1\)/ }).click();
  await page.getByRole('button', { name: 'Frames', exact: true }).click();

  await expect(page.getByRole('dialog', { name: 'Export frames' })).toBeVisible();
  // The dialog opens on that range, so the estimate is for about 6 s of a 2 Hz camera.
  await expect(page.getByLabel('Range')).toHaveValue(/ann-/);
  await expect(page.getByTestId('frame-estimate')).toContainText(/About \d+ frames over 6\.\d s/);

  await page.getByLabel('Image topic').selectOption('/camera/image_raw');
  await page.getByLabel(/Also the nearest point cloud/).selectOption('/lidar/points');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export zip' }).click()]);
  expect(download.suggestedFilename()).toBe('bagel-tour-frames.zip');
  await expect(page.getByTestId('frame-done')).toContainText(/Done: \d+ frames and \d+ clouds/);

  const files = unzipSync(new Uint8Array(await readFile((await download.path())!)));
  const pngs = Object.keys(files).filter((n) => n.endsWith('.png'));
  const pcds = Object.keys(files).filter((n) => n.endsWith('.pcd'));
  expect(pngs.length).toBeGreaterThanOrEqual(11);
  expect(pngs.length).toBeLessThanOrEqual(14);
  expect(pcds.length).toBeGreaterThan(5);
  expect(Array.from(files[pngs[0]!]!.subarray(1, 4))).toEqual([0x50, 0x4e, 0x47]);

  const rows = new TextDecoder().decode(files['frames.csv']).split('\r\n').filter(Boolean);
  expect(rows[0]).toBe('file,topic,timestamp_ns,header_stamp_ns,label,cloud_file,cloud_dt_ns,note');
  expect(rows.length - 1).toBe(pngs.length);
  // Every frame is inside the labelled range, so every row carries the label.
  expect(rows.slice(1).every((r) => r.split(',')[4] === 'left turn')).toBe(true);
  expect(errors).toEqual([]);
});

test('with no labels the dialog offers the whole bag and an honest estimate', async ({ page }) => {
  await openSample(page);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByLabel('Search commands').fill('export frames');
  await page.getByRole('dialog').getByText('Export frames as images').click();
  await expect(page.getByLabel('Range')).toHaveValue('');
  await page.getByLabel('Every Nth frame').fill('4');
  await expect(page.getByTestId('frame-estimate')).toContainText(/About 15 frames over 30\.0 s/);
});
