/**
 * Phone / upright-tablet layout: one panel at a time, behind a tab strip, with
 * touch-sized controls. Desktop keeps the split tree.
 */

import { test, expect } from '@playwright/test';

const SAMPLE_BUTTON = 'button:has-text("EXPLORE SAMPLE DATA")';
const badge = (page: import('@playwright/test').Page, label: string) =>
  page.locator('header[tabindex="0"] span.badge.badge-slate', { hasText: new RegExp(`^${label}$`) });

test.describe('upright tablet', () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true });

  test('shows one panel behind tabs, switches by tab, and has a 44 px timeline', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await page.locator(SAMPLE_BUTTON).click();

    const tabs = page.getByTestId('compact-tabs');
    await expect(tabs).toBeVisible({ timeout: 60_000 });
    const tab = tabs.getByRole('tab');
    await expect(tab).toHaveCount(4);
    // Exactly one panel is mounted at a time.
    await expect(page.locator('header[tabindex="0"]')).toHaveCount(1);

    await tab.filter({ hasText: '3D scene' }).click();
    await expect(badge(page, '3D Scene')).toBeVisible();
    await expect(page.locator('header[tabindex="0"]')).toHaveCount(1);
    await expect(tab.filter({ hasText: '3D scene' })).toHaveAttribute('aria-selected', 'true');

    await tab.filter({ hasText: 'Plot' }).click();
    await expect(badge(page, 'Plot')).toBeVisible();

    // Touch targets: tabs and the timeline track are at least 44 px tall.
    expect((await tab.first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await page.locator('#timeline-track').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(errors).toEqual([]);
  });

  test('3D controls are visible without hovering', async ({ page }) => {
    await page.goto('/');
    await page.locator(SAMPLE_BUTTON).click();
    await page.getByTestId('compact-tabs').getByRole('tab', { name: /3D scene/ }).click();
    await expect(page.getByRole('button', { name: 'Fit', exact: true })).toBeVisible();
    // Poll: the controls fade in, and a reading taken mid-transition (0.95) is not "hidden".
    await expect
      .poll(() =>
        page.getByRole('button', { name: 'Fit', exact: true }).evaluate((el) => {
          let n: HTMLElement | null = el as HTMLElement;
          let min = 1;
          while (n) {
            min = Math.min(min, Number(getComputedStyle(n).opacity));
            n = n.parentElement;
          }
          return min;
        }),
      )
      .toBe(1);
  });
});

test('desktop keeps the split layout', async ({ page }) => {
  await page.goto('/');
  await page.locator(SAMPLE_BUTTON).click();
  await expect(badge(page, '3D Scene')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('compact-tabs')).toHaveCount(0);
  await expect(page.locator('header[tabindex="0"]')).toHaveCount(4);
});
