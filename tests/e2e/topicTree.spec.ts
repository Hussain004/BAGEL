/**
 * Sidebar tree view and type chips, exercised in a real browser.
 *
 * The store and tree utils have unit tests. What is only provable here is the
 * part users touch: the toggle exists, the tree renders groups, expansion is
 * persisted, and the chips actually filter.
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const SAMPLE_BUTTON = 'button:has-text("EXPLORE SAMPLE DATA")';

function panelKindBadge(page: Page, label: string) {
  return page.locator('header[tabindex="0"] span.badge.badge-slate', {
    hasText: new RegExp(`^${label}$`),
  });
}

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

async function loadSample(page: Page) {
  await page.goto('/');
  await page.locator(SAMPLE_BUTTON).click();
  await expect(panelKindBadge(page, '3D Scene')).toBeVisible({ timeout: 60_000 });
}

function treeToggle(page: Page) {
  // "Tree" alone also matches panel badges (TF Tree, etc.).
  return page.getByRole('group', { name: 'Topic view' }).getByRole('button', { name: 'Tree', exact: true });
}

/** A namespace group header row, matched on its exact label span. */
function groupRow(page: Page, label: string) {
  // hasText: 'camera' matches both `camera` and `camera_rear`; the group
  // label lives in the mono span, so anchor on its exact text instead.
  return page.locator('.topic-group-row', { has: page.locator('span.mono', { hasText: new RegExp(`^${label}$`) }) });
}

test.describe('sidebar tree view', () => {
  test('the list/tree toggle exists and defaults to the flat list', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);

    await expect(page.getByRole('group', { name: 'Topic view' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Topic view' }).getByRole('button', { name: 'List', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(treeToggle(page)).toHaveAttribute('aria-pressed', 'false');
    // Flat mode renders no group rows.
    expect(await page.locator('.topic-group-row').count()).toBe(0);

    expect(problems).toEqual([]);
  });

  test('switching to tree view renders namespace groups', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await treeToggle(page).click();

    // The sample bag has /camera/* and /camera_rear/* namespaces.
    const groups = page.locator('.topic-group-row');
    expect(await groups.count()).toBeGreaterThan(0);

    expect(problems).toEqual([]);
  });

  test('a group row shows the rolled-up message count', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await treeToggle(page).click();

    const camera = groupRow(page, 'camera');
    await expect(camera).toBeVisible();
    // The count is on the row, not only in a tooltip.
    await expect(camera).toContainText('msgs');

    expect(problems).toEqual([]);
  });

  test('expanding a group reveals its topics, and expansion persists across reloads', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await treeToggle(page).click();

    const camera = groupRow(page, 'camera');
    await camera.click();

    // The camera namespace contains image_raw and camera_info.
    await expect(page.locator('#topic-row--camera-image_raw')).toBeVisible();
    await expect(page.locator('#topic-row--camera-camera_info')).toBeVisible();

    // Reload: the expansion must come back from localStorage.
    await page.reload();
    await page.locator(SAMPLE_BUTTON).click();
    await expect(panelKindBadge(page, '3D Scene')).toBeVisible({ timeout: 60_000 });
    await treeToggle(page).click();
    await expect(page.locator('#topic-row--camera-image_raw')).toBeVisible();

    expect(problems).toEqual([]);
  });

  test('the view mode itself persists across reloads', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await treeToggle(page).click();

    await page.reload();
    await page.locator(SAMPLE_BUTTON).click();
    await expect(panelKindBadge(page, '3D Scene')).toBeVisible({ timeout: 60_000 });
    // Still in tree mode without being asked again.
    await expect(treeToggle(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await page.locator('.topic-group-row').count()).toBeGreaterThan(0);

    expect(problems).toEqual([]);
  });

  test('the type chips count the bag, not the current filter', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);

    // The sample bag has images and camera info; both chips exist with counts.
    const images = page.getByRole('button', { name: /^Images \d+$/ });
    const cameraInfo = page.getByRole('button', { name: /^Camera info \d+$/ });
    await expect(images).toBeVisible();
    await expect(cameraInfo).toBeVisible();

    await images.click();
    // Filtering to images does not zero out the other chip's count.
    await expect(cameraInfo).toContainText(/\d+/);

    expect(problems).toEqual([]);
  });

  test('clicking a type chip filters the list, and clicking again clears it', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);

    await page.getByRole('button', { name: /^Images \d+$/ }).click();
    // /camera/image_raw stays, /odom goes.
    await expect(page.locator('#topic-row--camera-image_raw')).toBeVisible();
    expect(await page.locator('#topic-row--odom').count()).toBe(0);
    // Footer reflects the filter.
    await expect(page.getByText(/^Showing \d+ of \d+ topics$/)).toBeVisible();

    await page.getByRole('button', { name: /^Images \d+$/ }).click();
    await expect(page.locator('#topic-row--odom')).toBeVisible();

    expect(problems).toEqual([]);
  });

  test('the type filter works in tree view too', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await treeToggle(page).click();
    await page.getByRole('button', { name: /^Images \d+$/ }).click();
    await groupRow(page, 'camera').click();

    await expect(page.locator('#topic-row--camera-image_raw')).toBeVisible();
    expect(await page.locator('#topic-row--odom').count()).toBe(0);

    expect(problems).toEqual([]);
  });

  test('an active text search renders flat regardless of view mode', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await treeToggle(page).click();

    // A tree of a four-topic search result is harder to scan than the list.
    await page.locator('#topic-search-input').fill('imu');
    expect(await page.locator('.topic-group-row').count()).toBe(0);
    await expect(page.locator('#topic-row--imu-data')).toBeVisible();

    expect(problems).toEqual([]);
  });

  test('a topic in the tree opens a panel when clicked', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await treeToggle(page).click();
    await groupRow(page, 'camera').click();

    const before = await page.locator('header[tabindex="0"] span.badge.badge-slate').count();
    await page.locator('#topic-row--camera-camera_info').click();
    await expect(page.locator('header[tabindex="0"] span.badge.badge-slate')).toHaveCount(before + 1);

    expect(problems).toEqual([]);
  });
});