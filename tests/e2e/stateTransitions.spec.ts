/**
 * State transitions panel, exercised in a real browser.
 *
 * Run-length encoding and field discovery have unit tests. What is only
 * provable here is the wiring: a String topic opens in the state panel (it
 * used to land on a plot with nothing to plot), the lane reports the right
 * number of changes, hovering a run describes it, and clicking a run seeks to
 * the moment that state began.
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

/** AUTO for 0-1 s, MANUAL for 2-3 s, AUTO for 4-5 s: two transitions over a 5 s bag. */
async function modeBag(): Promise<Buffer> {
  const modes = ['AUTO', 'AUTO', 'MANUAL', 'MANUAL', 'AUTO', 'AUTO'];
  return Buffer.from(
    await writeSyntheticMcap([
      {
        topic: '/mode',
        type: 'std_msgs/msg/String',
        messages: modes.map((m, i) => ({ logTime: 1_000_000_000n + BigInt(i) * 1_000_000_000n, value: { data: m } })),
      },
    ]),
  );
}

async function openState(page: Page) {
  await page.goto('/');
  await page
    .locator('[data-testid="file-input"]')
    .setInputFiles({ name: 'mode.mcap', mimeType: 'application/octet-stream', buffer: await modeBag() });
  const row = page.locator('.topic-row', { hasText: '/mode' }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.hover();
  await row.getByRole('button', { name: /Open state timeline/ }).click();
  await expect(page.getByTestId('state-canvas')).toBeVisible({ timeout: 30_000 });
}

test('a String topic opens as state lanes with the right change count', async ({ page }) => {
  const problems = watchForErrors(page);
  await openState(page);
  await expect(page.getByText('2 state changes')).toBeVisible();
  const summary = page.locator('table.sr-only tr', { hasText: 'data' }).last();
  await expect(summary).toContainText('2');
  await expect(summary).toContainText('AUTO');
  expect(problems).toEqual([]);
});

test('hovering a run describes it, and clicking seeks to when that state began', async ({ page }) => {
  const problems = watchForErrors(page);
  await openState(page);
  const canvas = page.getByTestId('state-canvas');
  const box = (await canvas.boundingBox())!;
  const labelW = 150;
  const plotW = box.width - labelW - 8;
  // t = 3 s is inside MANUAL (2 s to 4 s) on a 0 to 5 s axis.
  const x = box.x + labelW + (3 / 5) * plotW;
  const y = box.y + 19;
  await page.mouse.move(x, y);
  await expect(page.getByTestId('state-tooltip')).toContainText('MANUAL');
  await expect(page.getByTestId('state-tooltip')).toContainText('2.00s to 4.00s');

  await page.mouse.click(x, y);
  // Seeks to the START of the run (2 s), not to the click position (3 s).
  await expect(page.getByText('2.000s').first()).toBeVisible();
  expect(problems).toEqual([]);
});
