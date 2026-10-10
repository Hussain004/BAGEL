/**
 * Guided tours, end to end: start one from the command palette, move through
 * its steps (the panels change under the text), end it with Esc; start one from
 * a `#tour=` link on a fresh page; and a broken tour file says what is wrong.
 */

import { test, expect } from '@playwright/test';

const badge = (page: import('@playwright/test').Page, name: string) =>
  page.locator('header[tabindex="0"] span.badge.badge-slate', { hasText: new RegExp(`^${name}$`) });

test('start a tour from the palette, step through it, end it with Escape', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('button:has-text("EXPLORE SAMPLE DATA")').click();
  await expect(badge(page, '3D Scene')).toBeVisible({ timeout: 60_000 });

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByLabel('Search commands').fill('guided tour');
  await page.getByRole('dialog').getByText('Guided tour: What is TF?').click();

  const card = page.getByTestId('tour-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('tour-step-title')).toHaveText('Every part of the robot has its own frame');
  await expect(page.getByTestId('tour-progress')).toHaveText('1 of 5');
  // Step 1's layout is a single TF panel.
  await expect(badge(page, 'TF Tree')).toBeVisible();
  await expect(badge(page, '3D Scene')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Back' })).toBeDisabled();

  await card.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('tour-progress')).toHaveText('2 of 5');
  // Step 2 adds the 3D view beside the TF tree and points at the timeline.
  await expect(badge(page, '3D Scene')).toBeVisible();
  await expect(page.locator('#timeline-track')).toHaveAttribute('data-tour-highlight', '');

  await card.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('tour-progress')).toHaveText('1 of 5');
  await expect(page.locator('#timeline-track')).not.toHaveAttribute('data-tour-highlight', '');

  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a #tour link on a fresh page opens the sample bag and starts the tour', async ({ page }) => {
  await page.goto('/#tour=timestamps');
  await expect(page.getByTestId('tour-card')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('tour-step-title')).toHaveText('Every sensor has its own rhythm');
  await expect(badge(page, 'Plot')).toBeVisible();
  await expect(badge(page, 'Image')).toBeVisible();
  // Last step finishes the tour.
  const card = page.getByTestId('tour-card');
  await card.getByRole('button', { name: 'Next' }).click();
  await card.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByTestId('tour-progress')).toHaveText('3 of 3');
  await card.getByRole('button', { name: 'Finish' }).click();
  await expect(card).toHaveCount(0);
});

test('a tour file that is wrong says what is wrong, and the app still works', async ({ page }) => {
  await page.route('**/tours/broken.json', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: 'Broken', steps: [{ title: 'ok' }, { title: 'bad', layout: 'nonsense' }] }) }),
  );
  await page.goto('/#tour=broken');
  await expect(page.getByRole('alert')).toContainText('Step 2: "layout" is not a valid layout', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('button:has-text("EXPLORE SAMPLE DATA")')).toBeVisible();
});
