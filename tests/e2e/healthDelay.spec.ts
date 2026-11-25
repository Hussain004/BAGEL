/**
 * Health's Delay column decodes a sample of a topic in the parser worker and
 * shows log time minus header.stamp. The statistics are unit-tested; this
 * proves the worker round trip and the cell.
 */

import { test, expect } from '@playwright/test';
import { writeSyntheticMcap } from '../fixtures/synth';

/** 10 Hz PoseStamped for 5 s, stamped 5 ms before logging, with three 40 ms stragglers. */
async function lateBag(): Promise<Buffer> {
  const messages = Array.from({ length: 50 }, (_, i) => {
    const logTime = 1_000_000_000n + BigInt(i) * 100_000_000n;
    const delayNs = [10, 20, 30].includes(i) ? 40_000_000n : 5_000_000n;
    const stamp = logTime - delayNs;
    return {
      logTime,
      value: {
        header: { stamp: { sec: Number(stamp / 1_000_000_000n), nanosec: Number(stamp % 1_000_000_000n) }, frame_id: 'map' },
        pose: { position: { x: i, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      },
    };
  });
  return Buffer.from(await writeSyntheticMcap([{ topic: '/goal', type: 'geometry_msgs/msg/PoseStamped', messages }]));
}

test('measuring a topic shows its p50 / p95 delay', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'late.mcap', mimeType: 'application/octet-stream', buffer: await lateBag() });

  await page.getByTitle(/Open Bag Health dashboard/).click({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Measure delay of /goal' }).click();
  await expect(page.getByLabel(/^Delay of \/goal: p50 5\.0ms, p95 40\.0ms/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('5.0ms / 40.0ms')).toBeVisible();
  expect(errors).toEqual([]);
});
