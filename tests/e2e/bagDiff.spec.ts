/**
 * Two-bag comparison, exercised in a real browser.
 *
 * The comparison rules have unit tests. What is only provable here is the
 * wiring: two files picked together load as two bags, the Compare view appears
 * in Health, the rows say the right thing, and a row can open the topic.
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

const S = 1_000_000_000n;
const str = (n: number, stepMs: number, tag: string) =>
  Array.from({ length: n }, (_, i) => ({ logTime: S + BigInt(i * stepMs) * 1_000_000n, value: { data: `${tag}${i}` } }));
const T = 'std_msgs/msg/String';
const buf = async (topics: Parameters<typeof writeSyntheticMcap>[0]) => Buffer.from(await writeSyntheticMcap(topics));
const file = (name: string, buffer: Buffer) => ({ name, mimeType: 'application/octet-stream', buffer });

/** Both bags span 10 s. A has /shared at 10 Hz and /lost; B has /shared at 5 Hz and /new. */
async function goodBag() {
  return buf([
    { topic: '/shared', type: T, messages: str(100, 100, 'a') },
    { topic: '/lost', type: T, messages: str(1, 0, 'l') },
  ]);
}
async function badBag() {
  return buf([
    { topic: '/shared', type: T, messages: str(50, 200, 'b') },
    { topic: '/new', type: T, messages: [{ logTime: S + 9_900_000_000n, value: { data: 'n' } }] },
  ]);
}

async function openCompare(page: Page, a: Buffer, b: Buffer) {
  await page.goto('/');
  await page.locator('[data-testid="file-input"]').setInputFiles([file('good.mcap', a), file('bad.mcap', b)]);
  await expect(page.getByText('bad.mcap').first()).toBeVisible({ timeout: 60_000 });
  await page.getByTitle(/Open Bag Health dashboard/).click();
  await page.getByRole('group', { name: 'Health view' }).getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByTestId('bag-diff')).toBeVisible({ timeout: 30_000 });
}

test('compare lists topics missing from either side and a changed rate', async ({ page }) => {
  const problems = watchForErrors(page);
  await openCompare(page, await goodBag(), await badBag());

  const row = (name: string) => page.locator('tbody tr').filter({ has: page.getByText(name, { exact: true }) });
  await expect(row('/lost')).toContainText('Only in A');
  await expect(row('/new')).toContainText('Only in B');
  await expect(row('/shared')).toContainText('Rate differs');
  await expect(row('/shared')).toContainText('lower in B');
  // The matching count shows as an opt-in, not clutter.
  await expect(page.getByRole('checkbox')).toBeVisible();

  // A row opens the topic from the chosen bag; the missing side is disabled.
  await expect(page.getByRole('button', { name: 'Open /lost from B' })).toBeDisabled();
  await page.getByRole('button', { name: 'Open /shared from A' }).click();
  await expect(page.locator('header[tabindex="0"]').filter({ hasText: '/shared' }).first()).toBeVisible();
  expect(problems).toEqual([]);
});

test('identical bags report no differences', async ({ page }) => {
  const problems = watchForErrors(page);
  const same = await goodBag();
  await openCompare(page, same, same);
  await expect(page.getByTestId('diff-empty')).toContainText('No differences across 2 shared topics');
  expect(problems).toEqual([]);
});
