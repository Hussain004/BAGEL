/**
 * "Find when" over a topic's messages, exercised in a real browser.
 *
 * The predicate scanner has unit tests. What is only provable here is the
 * wiring: the panel opens from a topic, a real streamed scan finds the right
 * moments, a hit seeks the playhead, and the hits can be marked on the
 * timeline.
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

/** Battery %, one sample a second: dips below 20 at t=5 (stays for t=6), recovers, dips again at t=9 (t=10). */
const BATTERY = [100, 80, 60, 40, 25, 19, 18, 30, 40, 15, 10, 50];
const MODES = ['AUTO', 'AUTO', 'MANUAL', 'MANUAL', 'AUTO', 'AUTO', 'ESTOP', 'ESTOP', 'AUTO', 'AUTO', 'AUTO', 'AUTO'];

async function bag(): Promise<Buffer> {
  const at = (i: number) => 1_000_000_000n + BigInt(i) * 1_000_000_000n;
  return Buffer.from(
    await writeSyntheticMcap([
      { topic: '/battery', type: 'std_msgs/msg/Float64', messages: BATTERY.map((v, i) => ({ logTime: at(i), value: { data: v } })) },
      { topic: '/mode', type: 'std_msgs/msg/String', messages: MODES.map((v, i) => ({ logTime: at(i), value: { data: v } })) },
    ]),
  );
}

async function openFind(page: Page, topic: string) {
  await page.goto('/');
  await page
    .locator('[data-testid="file-input"]')
    .setInputFiles({ name: 'run.mcap', mimeType: 'application/octet-stream', buffer: await bag() });
  const row = page.locator('.topic-row', { hasText: topic }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.hover();
  await row.getByRole('button', { name: /Find when a field meets a condition/ }).click();
  await expect(page.getByLabel('Condition', { exact: true })).toBeVisible({ timeout: 30_000 });
}

test('finds where a value drops below a threshold, once per crossing', async ({ page }) => {
  const problems = watchForErrors(page);
  await openFind(page, '/battery');
  await page.getByLabel('Condition', { exact: true }).selectOption('<');
  await page.getByLabel('Value', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Find', exact: true }).click();

  await expect(page.getByTestId('search-summary')).toContainText('2 matches in 12 messages', { timeout: 30_000 });
  const rows = page.getByTestId('search-results').locator('li button');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('5.000s');
  await expect(rows.nth(0)).toContainText('19');
  await expect(rows.nth(1)).toContainText('9.000s');

  // Clicking a hit moves the playhead there.
  await rows.nth(1).click();
  await expect(page.getByText('9.000s').first()).toBeVisible();

  // With edges off every matching sample is reported (t=5,6,9,10).
  await page.getByLabel('only when it starts').uncheck();
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(page.getByTestId('search-summary')).toContainText('4 matches', { timeout: 30_000 });
  expect(problems).toEqual([]);
});

test('hits can be marked on the timeline and cleared', async ({ page }) => {
  const problems = watchForErrors(page);
  await openFind(page, '/battery');
  await page.getByLabel('Condition', { exact: true }).selectOption('<');
  await page.getByLabel('Value', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(page.getByTestId('search-summary')).toContainText('2 matches', { timeout: 30_000 });

  await page.getByRole('button', { name: 'Mark on timeline' }).click();
  await expect(page.locator('div.bg-accent-rose\\/70')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear timeline marks' }).click();
  await expect(page.locator('div.bg-accent-rose\\/70')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('finds each change of a text field, and reports honestly when nothing matches', async ({ page }) => {
  const problems = watchForErrors(page);
  await openFind(page, '/mode');
  await page.getByLabel('Condition', { exact: true }).selectOption('changes');
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  // AUTO>MANUAL, MANUAL>AUTO, AUTO>ESTOP, ESTOP>AUTO
  await expect(page.getByTestId('search-summary')).toContainText('4 matches', { timeout: 30_000 });

  await page.getByLabel('Condition', { exact: true }).selectOption('==');
  await page.getByLabel('Value', { exact: true }).fill('"DOES NOT EXIST"');
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(page.getByText(/No message matched/)).toBeVisible({ timeout: 30_000 });
  expect(problems).toEqual([]);
});
