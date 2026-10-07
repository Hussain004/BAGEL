/**
 * Multi-topic time-series plots, exercised in a real browser.
 *
 * Alignment and field reading have unit tests. What is only provable here is
 * the wiring: the picker lists the bag's topics and fields, an added series
 * becomes a chip and a column in the chart's data summary, a cross-topic
 * expression evaluates, and removing the series takes it away again.
 */

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

/** /fast at 10 Hz ramping 0..9, /slow at 1 Hz holding 100..109. Different rates, offset stamps. */
async function twoRateBag(): Promise<Buffer> {
  const fast = Array.from({ length: 100 }, (_, i) => ({
    logTime: 1_000_000_000n + BigInt(i) * 100_000_000n,
    value: { data: i / 10 },
  }));
  const slow = Array.from({ length: 10 }, (_, i) => ({
    logTime: 1_050_000_000n + BigInt(i) * 1_000_000_000n,
    value: { data: 100 + i },
  }));
  return Buffer.from(
    await writeSyntheticMcap([
      { topic: '/fast', type: 'std_msgs/msg/Float64', messages: fast },
      { topic: '/slow', type: 'std_msgs/msg/Float64', messages: slow },
    ]),
  );
}

test('add a series from another topic, use it in an expression, then remove it', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/');
  await page
    .locator('[data-testid="file-input"]')
    .setInputFiles({ name: 'rates.mcap', mimeType: 'application/octet-stream', buffer: await twoRateBag() });

  const row = page.locator('.topic-row', { hasText: '/fast' }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.hover();
  await row.getByRole('button', { name: /Open time-series plot/ }).click();
  await expect(page.getByRole('button', { name: 'data', exact: true })).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: '+ series' }).click();
  await page.getByLabel('Topic', { exact: true }).fill('/slow');
  await expect(page.getByLabel('Field', { exact: true })).toHaveValue('data', { timeout: 15_000 });
  // The default name is derived from the topic, so it cannot collide with the primary `data`.
  await expect(page.getByLabel('Name in expressions')).toHaveValue('slow_data');
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  await expect(page.getByRole('button', { name: 'slow_data', exact: true })).toBeVisible();
  // The chart's accessible summary lists a row for the new series with real numbers.
  const summary = page.locator('table.sr-only tr', { hasText: 'slow_data' });
  await expect(summary).toContainText('100');
  await expect(summary).toContainText('109');

  // A cross-topic expression: fast minus the held slow value.
  await page.getByRole('button', { name: /f\(x\)/ }).click();
  await page.getByPlaceholder(/sqrt/).fill('slow_data - data');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const exprRow = page.locator('table.sr-only tr', { hasText: 'slow_data - data' });
  await expect(exprRow).toBeVisible();
  // slow steps 100..109 once a second while fast ramps 0..9.9, so with slow held between its
  // samples, slow - fast peaks at exactly 100 (the row where slow just published and fast is
  // still on its previous sample) and never drops below ~99.
  const cells = await exprRow.locator('td').allInnerTexts();
  expect(Number(cells[2])).toBeCloseTo(100, 5);
  expect(Number(cells[1])).toBeGreaterThan(98.9);
  expect(Number(cells[1])).toBeLessThan(100);

  await page.getByRole('button', { name: 'Remove series slow_data' }).click();
  await expect(page.getByRole('button', { name: 'slow_data', exact: true })).toHaveCount(0);

  expect(problems).toEqual([]);
});

test('Escape closes the picker without closing the panel', async ({ page }) => {
  await page.goto('/');
  await page
    .locator('[data-testid="file-input"]')
    .setInputFiles({ name: 'rates.mcap', mimeType: 'application/octet-stream', buffer: await twoRateBag() });
  const row = page.locator('.topic-row', { hasText: '/fast' }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.hover();
  await row.getByRole('button', { name: /Open time-series plot/ }).click();
  await page.getByRole('button', { name: '+ series' }).click();
  await page.getByLabel('Topic', { exact: true }).press('Escape');
  await expect(page.getByLabel('Topic', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'data', exact: true })).toBeVisible();
});
