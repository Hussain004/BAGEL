/**
 * Each bag format loads through the parser worker in the built app. The worker
 * is an ES module whose heavier dependencies (sql.js and its WASM for .db3, the
 * ROS 1 reader for .bag) load as separate chunks on demand, so this proves
 * those chunks resolve and run, not just that the parsers pass unit tests.
 */

import { test, expect } from '@playwright/test';
import { chatterBag, chatterDb3Bag, chatterRos1Bag } from '../fixtures/synth';

const cases = [
  { name: 'chatter.db3', make: chatterDb3Bag },
  { name: 'chatter.bag', make: chatterRos1Bag },
  { name: 'chatter.mcap', make: chatterBag },
];

for (const { name, make } of cases) {
  test(`${name} loads and its messages decode`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await page.locator('input[type="file"]').first().setInputFiles({
      name,
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(await make()),
    });
    await expect(page.getByLabel(/^\/chatter, .*String, 3 messages/)).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Open raw inspector' }).first().click();
    await expect(page.getByText(/hello|world/).first()).toBeVisible({ timeout: 60_000 });
    expect(errors).toEqual([]);
  });
}
