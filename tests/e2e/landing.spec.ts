/**
 * The start page: the three ways in (file, sample, remote or live source) are
 * all visible at once, each labelled and actionable without hunting for a tab.
 */

import { test, expect } from '@playwright/test';

test('every way to start is visible without clicking anything, and the page does not scroll', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('Drop a recording here')).toBeVisible();
  await expect(page.getByText('Choose files')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open a folder' })).toBeVisible();

  await expect(page.getByText('No recording handy?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore sample data' })).toBeVisible();

    await expect(page.getByLabel('Remote bag URL')).toBeVisible();
  await expect(page.getByLabel('Live robot WebSocket URL')).toBeVisible();

  // One screen, no scrolling, at common laptop sizes.
  for (const [width, height] of [[1440, 900], [1366, 768], [1280, 720]]) {
    await page.setViewportSize({ width: width!, height: height! });
    const overflow = await page.evaluate(() => {
      const intro = document.querySelector('.landing__intro') as HTMLElement;
      return { page: document.documentElement.scrollHeight - innerHeight, intro: intro.scrollHeight - intro.clientHeight };
    });
    expect(overflow, `${width}x${height}`).toEqual({ page: 0, intro: 0 });
  }
});

test('the URL and live robot boxes only enable their button for the right scheme', async ({ page }) => {
  await page.goto('/');
  const open = page.locator('form', { has: page.getByLabel('Remote bag URL') }).getByRole('button');
  const connect = page.locator('form', { has: page.getByLabel('Live robot WebSocket URL') }).getByRole('button');
  await expect(open).toBeDisabled();
  await expect(connect).toBeDisabled();

  await page.getByLabel('Remote bag URL').fill('ws://robot.local:8765');
  await expect(open).toBeDisabled(); // a WebSocket address is not a bag URL
  await page.getByLabel('Remote bag URL').fill('https://example.com/run.mcap');
  await expect(open).toBeEnabled();

  await page.getByLabel('Live robot WebSocket URL').fill('https://example.com');
  await expect(connect).toBeDisabled();
  await page.getByLabel('Live robot WebSocket URL').fill('ws://robot.local:8765');
  await expect(connect).toBeEnabled();
});

test('the folder button opens the folder picker, not the file picker', async ({ page }) => {
  await page.goto('/');
  // A folder input has webkitdirectory; choosing a folder fires its own change handler.
  await expect(page.getByTestId('folder-input')).toHaveAttribute('webkitdirectory', '');
  await expect(page.getByTestId('file-input')).not.toHaveAttribute('webkitdirectory', '');
});
