/**
 * Labelled ranges on the timeline: make one by shift+drag and by [ and ], name
 * it, add a note, and export what a spreadsheet or training pipeline would read.
 */

import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openSample(page: Page) {
  await page.goto('/');
  await page.locator('button:has-text("EXPLORE SAMPLE DATA")').click();
  await expect(page.locator('#timeline-track')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Pause playback' }).click();
}

async function dragRange(page: Page, from: number, to: number) {
  const box = (await page.locator('#timeline-track').boundingBox())!;
  const y = box.y + box.height / 2;
  await page.keyboard.down('Shift');
  await page.mouse.move(box.x + box.width * from, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * ((from + to) / 2), y, { steps: 4 });
  await page.mouse.move(box.x + box.width * to, y, { steps: 4 });
  await expect(page.getByTestId('range-draft')).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up('Shift');
}

test('shift+drag makes a named range that exports with its note', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openSample(page);

  await dragRange(page, 0.2, 0.5);
  await expect(page.getByTestId('range-band')).toHaveCount(1);
  // The new range opens its name for editing, already selected.
  const name = page.getByPlaceholder('Bookmark name');
  await expect(name).toHaveValue('Range 1');
  await name.fill('sharp left');
  await name.press('Enter');

  // It travels in the link as start~end, and the note does not.
  await expect.poll(() => page.url()).toMatch(/bm=\d+\.\d{3}%7E\d+\.\d{3}%2Csharp/);

  await page.getByRole('button', { name: /Open labels \(1\)/ }).click();
  const row = page.getByTestId('label-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByLabel('Label')).toHaveValue('sharp left');
  await expect(row).toContainText(/to .* s \(\d+\.\d\d s\)/);
  await row.getByLabel('Note').fill('wheel slip, "dry" floor, see run 4');
  await row.getByLabel('Label').click(); // blur saves the note

  const [jsonDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()]);
  expect(jsonDownload.suggestedFilename()).toBe('bagel-tour-labels.json');
  const rows = JSON.parse(await readFile((await jsonDownload.path())!, 'utf8'));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ bag: 'bagel-tour.mcap', label: 'sharp left', note: 'wheel slip, "dry" floor, see run 4' });
  // 20% to 50% of a 30 s bag: three to fifteen seconds in, on the bag's own clock.
  const start = BigInt(rows[0].start_ns);
  const end = BigInt(rows[0].end_ns);
  expect(Number(end - start) / 1e9).toBeGreaterThan(8.5);
  expect(Number(end - start) / 1e9).toBeLessThan(9.5);
  expect(start).toBeGreaterThan(1_000_000_000_000_000_000n); // an epoch time, not an offset from zero

  const [csvDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export CSV' }).click()]);
  const csv = await readFile((await csvDownload.path())!, 'utf8');
  expect(csv.split('\r\n')[0]).toBe('bag,start_ns,end_ns,label,note');
  expect(csv).toContain('"wheel slip, ""dry"" floor, see run 4"');
  expect(errors).toEqual([]);
});

test('[ and ] mark a range from the keyboard, and a click that barely moves does not', async ({ page }) => {
  await openSample(page);

  await page.keyboard.press('Home');
  await page.keyboard.press('[');
  await expect(page.getByTestId('range-pending')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(']');
  await expect(page.getByTestId('range-pending')).toHaveCount(0);
  await expect(page.getByTestId('range-band')).toHaveCount(1);

  // `]` with no start set does nothing; shift+click without a drag makes no range.
  await page.keyboard.press(']');
  const box = (await page.locator('#timeline-track').boundingBox())!;
  await page.keyboard.down('Shift');
  await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
  await page.keyboard.up('Shift');
  await expect(page.getByTestId('range-band')).toHaveCount(1);

  await page.getByRole('button', { name: /Open labels \(1\)/ }).click();
  await page.getByRole('button', { name: /^Delete Range 1/ }).click();
  await expect(page.getByText('No labels yet')).toBeVisible();
  await expect(page.getByTestId('range-band')).toHaveCount(0);
});
