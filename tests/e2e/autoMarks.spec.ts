/**
 * Health gaps as timeline marks, exercised in a real browser.
 *
 * The mark builder and store have unit tests. What is only provable here is
 * the wiring: the Health panel button adds ticks to the Timeline, a tick can
 * be pinned into a real bookmark, and Clear removes the marks again.
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

/** 10 Hz String topic for 10 s with a 3 s hole after t=4 s. */
async function gappyBag(): Promise<Buffer> {
  const messages: Array<{ logTime: bigint; value: Record<string, unknown> }> = [];
  for (let i = 0; i <= 100; i++) {
    const t = i / 10;
    if (t > 4 && t < 7) continue;
    messages.push({ logTime: 1_000_000_000n + BigInt(Math.round(t * 1e9)), value: { data: `m${i}` } });
  }
  return Buffer.from(await writeSyntheticMcap([{ topic: '/chatter', type: 'std_msgs/msg/String', messages }]));
}

test('Mark on timeline adds a tick, pin makes a bookmark, clear removes marks', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/');
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({ name: 'gappy.mcap', mimeType: 'application/octet-stream', buffer: await gappyBag() });

  await page.getByTitle(/Open Bag Health dashboard/).click({ timeout: 60_000 });
  const mark = page.getByRole('button', { name: 'Mark on timeline' });
  await expect(mark).toBeVisible({ timeout: 30_000 });
  await mark.click();
  await expect(page.getByRole('button', { name: /Clear timeline marks \(1\)/ })).toBeVisible();

  // The auto tick lives in the timeline track; hover reveals its pin action.
  const tick = page.locator('div.absolute.z-10.w-6', { has: page.locator('div.bg-accent-rose\\/70') }).first();
  await tick.hover();
  const pin = page.getByRole('button', { name: 'Pin as a bookmark' });
  await expect(pin).toBeVisible();
  await pin.click();
  // A pinned mark is now an ordinary amber bookmark tick.
  await expect(page.locator('div.bg-accent-amber\\/70').first()).toBeVisible();

  await page.getByRole('button', { name: /Clear timeline marks/ }).click();
  await expect(page.getByRole('button', { name: 'Mark on timeline' })).toBeVisible();
  await expect(page.locator('div.bg-accent-rose\\/70')).toHaveCount(0);

  expect(problems).toEqual([]);
});
