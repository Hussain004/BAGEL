/**
 * Plot range statistics and export, exercised in a real browser.
 *
 * The statistics and writers have unit tests. What is only provable here is the
 * wiring: the numbers describe the zoomed range (not the whole recording), and
 * the three download buttons produce real files with the right content.
 */

import { readFileSync } from 'node:fs';
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { writeSyntheticMcap } from '../fixtures/synth';

function watchForErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' && !/favicon|source ?map|GL Driver/i.test(m.text())) {
      problems.push(`console.error: ${m.text()}`);
    }
  });
  return problems;
}

/** /ramp: 100 samples at 10 Hz, value = index / 10, so 0.0 to 9.9 over ~10 s. */
async function rampBag(): Promise<Buffer> {
  const messages = Array.from({ length: 100 }, (_, i) => ({
    logTime: 1_000_000_000n + BigInt(i) * 100_000_000n,
    value: { data: i / 10 },
  }));
  return Buffer.from(await writeSyntheticMcap([{ topic: '/ramp', type: 'std_msgs/msg/Float64', messages }]));
}

async function openPlot(page: Page) {
  await page.goto('/');
  await page
    .locator('[data-testid="file-input"]')
    .setInputFiles({ name: 'ramp.mcap', mimeType: 'application/octet-stream', buffer: await rampBag() });
  const row = page.locator('.topic-row', { hasText: '/ramp' }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.hover();
  await row.getByRole('button', { name: /Open time-series plot/ }).click();
  await expect(page.getByRole('button', { name: 'stats', exact: true })).toBeVisible({ timeout: 30_000 });
}

test('stats describe the visible range and follow a zoom', async ({ page }) => {
  const problems = watchForErrors(page);
  await openPlot(page);
  await page.getByRole('button', { name: 'stats', exact: true }).click();

  const table = page.getByTestId('plot-stats');
  const full = table.locator('tbody tr').first().locator('td');
  await expect(full.nth(1)).toHaveText('100');
  await expect(full.nth(2)).toHaveText('0');
  await expect(full.nth(3)).toHaveText('9.9');
  await expect(full.nth(4)).toHaveText('4.95');

  // Drag across the middle of the chart to zoom; the table must now describe only that span.
  const over = page.locator('.u-over');
  const box = (await over.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect.poll(async () => Number(await full.nth(1).innerText()), { timeout: 10_000 }).toBeLessThan(60);
  const n = Number(await full.nth(1).innerText());
  expect(n).toBeGreaterThan(10);
  expect(Number(await full.nth(2).innerText())).toBeGreaterThan(1); // min moved up from 0
  expect(Number(await full.nth(3).innerText())).toBeLessThan(9.9);
  expect(problems).toEqual([]);
});

test('csv, svg and png downloads contain the data', async ({ page }) => {
  const problems = watchForErrors(page);
  await openPlot(page);

  const csvDl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'csv', exact: true }).click();
  const csvFile = await csvDl;
  expect(csvFile.suggestedFilename()).toBe('ramp__ramp__plot.csv');
  const csv = readFileSync((await csvFile.path())!, 'utf8').trim().split('\n');
  expect(csv[0]).toBe('t_s,data');
  expect(csv).toHaveLength(101); // header + 100 samples
  expect(csv[1]).toBe('0,0');

  const svgDl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'svg', exact: true }).click();
  const svg = readFileSync(((await (await svgDl).path()))!, 'utf8');
  expect(svg.startsWith('<svg')).toBe(true);
  expect(svg).toContain('<polyline');
  expect(svg).toContain('>data</text>');

  const pngDl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'png', exact: true }).click();
  const png = readFileSync(((await (await pngDl).path()))!);
  expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect(png.length).toBeGreaterThan(500);
  expect(problems).toEqual([]);
});
