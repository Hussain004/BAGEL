/**
 * An empty panel should say why and offer the next step. A plot opened on a
 * String topic (restored from a link, since the sidebar does not offer it)
 * has no numeric field; the empty state points at the views that can show it,
 * and the buttons actually open them.
 */

import { test, expect } from '@playwright/test';
import { writeSyntheticMcap } from '../fixtures/synth';

test('a plot on a text topic explains itself and offers working alternatives', async ({ page }) => {
  const bytes = Buffer.from(
    await writeSyntheticMcap([
      {
        topic: '/mode',
        type: 'std_msgs/msg/String',
        messages: ['AUTO', 'MANUAL', 'AUTO'].map((m, i) => ({ logTime: BigInt(i + 1) * 1_000_000_000n, value: { data: m } })),
      },
    ]),
  );
  await page.goto('/#p=plot:/mode');
  await page
    .locator('[data-testid="file-input"]')
    .setInputFiles({ name: 'mode.mcap', mimeType: 'application/octet-stream', buffer: bytes });

  await expect(page.getByText('No numeric fields found in this message type.')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/holds text or flags/)).toBeVisible();

  // The sidebar has buttons with the same titles; the empty state's are plain text buttons.
  const empty = page.getByText(/holds text or flags/).locator('..');
  await empty.getByRole('button', { name: 'Open raw inspector' }).click();
  await expect(page.locator('header[tabindex="0"] span.badge.badge-slate', { hasText: /^Raw$/ })).toBeVisible();
  await empty.getByRole('button', { name: 'Open state timeline' }).click();
  await expect(page.getByTestId('state-canvas')).toBeVisible();
});
