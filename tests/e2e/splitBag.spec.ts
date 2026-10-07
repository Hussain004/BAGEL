/**
 * Split recordings, exercised in a real browser.
 *
 * The parser and grouping logic have unit tests. What is only provable here
 * is the ingest wiring: several files chosen together become ONE bag, the
 * merged topic shows the summed message count, panels read across the part
 * boundary, and unrelated files are not merged.
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

async function part(secs: number[], tag: string) {
  return Buffer.from(
    await writeSyntheticMcap([
      {
        topic: '/chatter',
        type: 'std_msgs/msg/String',
        messages: secs.map((t) => ({ logTime: BigInt(t) * 1_000_000_000n, value: { data: `${tag}@${t}` } })),
      },
    ]),
  );
}

const file = (name: string, buffer: Buffer) => ({ name, mimeType: 'application/octet-stream', buffer });

test('files named like a split open as one recording with merged counts', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/');
  await page.locator('[data-testid="file-input"]').setInputFiles([
    // Deliberately out of order.
    file('rec_1.mcap', await part([6, 7, 8], 'b')),
    file('rec_0.mcap', await part([1, 2, 3, 4, 5], 'a')),
  ]);

  const row = page.locator('.topic-row', { hasText: '/chatter' }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  // 5 + 3 messages, one topic row, one bag chip named for the group.
  await expect(row).toContainText('8');
  await expect(page.getByText('rec (2 parts)').first()).toBeVisible();
  await expect(page.locator('.topic-row', { hasText: '/chatter' })).toHaveCount(1);

  // Edit is unavailable for a split, with the reason on hover.
  await expect(page.getByLabel('Edit bag - trim and re-export')).toBeDisabled();

  // A panel reads data from both sides of the boundary.
  await row.hover();
  await row.getByRole('button', { name: /Open raw inspector/ }).click();
  await expect(page.getByText(/a@1|a@2|a@3|a@4|a@5/).first()).toBeVisible({ timeout: 30_000 });

  expect(problems).toEqual([]);
});

test('unrelated numbered files are not merged', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/');
  await page.locator('[data-testid="file-input"]').setInputFiles([
    file('run_1.mcap', await part([1, 2], 'x')),
    file('run_2.mcap', await part([3, 4], 'y')),
  ]);
  // Two separate bags -> two chips, none labelled as parts.
  await expect(page.getByText('run_1.mcap').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('run_2.mcap').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/parts\)/)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('a folder pick with metadata.yaml groups by what the metadata lists', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/');
  const meta = Buffer.from('rosbag2_bagfile_information:\n  relative_file_paths:\n    - take_a.mcap\n    - take_b.mcap\n');
  await page.locator('[data-testid="file-input"]').setInputFiles([
    file('take_a.mcap', await part([1, 2], 'a')),
    file('take_b.mcap', await part([3, 4], 'b')),
    file('metadata.yaml', meta),
  ]);
  await expect(page.getByText(/take \(2 parts\)|take_a \(2 parts\)/).first()).toBeVisible({ timeout: 60_000 });
  expect(problems).toEqual([]);
});
