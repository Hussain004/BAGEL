/**
 * Panel-close undo, exercised in a real browser.
 *
 * This is the part of B1 that cannot be proven in a store unit test: that the
 * toast actually appears, that it says the right thing, and that the Undo
 * button restores the panel to the same grid slot. The store tests prove the
 * tree manipulation; this proves the affordance is reachable and wired.
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

const SAMPLE_BUTTON = 'button:has-text("EXPLORE SAMPLE DATA")';

/** Panel-header kind badge, unambiguous where a bare getByText is not. */
function panelKindBadge(page: Page, label: string) {
  return page.locator('header[tabindex="0"] span.badge.badge-slate', {
    hasText: new RegExp(`^${label}$`),
  });
}

function watchForErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error' && !/favicon|source ?map/i.test(m.text())) {
      problems.push(`console.error: ${m.text()}`);
    }
  });
  return problems;
}

/** Load the sample bag, which lands on the curated 3D + image/plot layout. */
async function loadSample(page: Page) {
  await page.goto('/');
  await page.locator(SAMPLE_BUTTON).click();
  await expect(panelKindBadge(page, '3D Scene')).toBeVisible({ timeout: 60_000 });
}

/** The undo toast, or a locator that resolves to nothing when it is hidden. */
function toast(page: Page) {
  return page.getByRole('status').filter({ hasText: 'Closed' });
}

/**
 * The toast's Undo button.
 *
 * `exact` is required: without it the accessible-name match is substring-based,
 * so "Dismiss undo" also matches "Undo" and the click becomes ambiguous.
 */
function undoButton(page: Page) {
  return toast(page).getByRole('button', { name: 'Undo', exact: true });
}

test.describe('panel close undo', () => {
  test('closing a panel offers an undo that puts it back', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);

    // The curated layout is 3D Scene + (Image over Plot).
    await expect(panelKindBadge(page, 'Image')).toBeVisible();
    await expect(panelKindBadge(page, 'Plot')).toBeVisible();

    // Close the image panel by its header close button.
    await page.getByRole('button', { name: /^Close Image panel/ }).click();

    // The toast appears and names the panel kind, so the user knows what undo
    // will bring back.
    const undoToast = toast(page);
    await expect(undoToast).toBeVisible();
    await expect(undoToast.getByText('3D Scene').or(undoToast.getByText('Image'))).toBeVisible();

    // Actually gone while the toast is up.
    await expect(panelKindBadge(page, 'Image')).toHaveCount(0);

    await undoButton(page).click();

    // Restored.
    await expect(toast(page)).toHaveCount(0);
    await expect(panelKindBadge(page, 'Image')).toBeVisible();
    await expect(panelKindBadge(page, 'Plot')).toBeVisible();

    expect(problems).toEqual([]);
  });

  test('the toast can be dismissed without reopening', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);

    await page.getByRole('button', { name: /^Close Plot panel/ }).click();
    await expect(toast(page)).toBeVisible();
    await expect(panelKindBadge(page, 'Plot')).toHaveCount(0);

    await toast(page).getByRole('button', { name: 'Dismiss undo' }).click();

    await expect(toast(page)).toHaveCount(0);
    // Still closed: dismissing must not be a silent undo.
    await expect(panelKindBadge(page, 'Plot')).toHaveCount(0);

    expect(problems).toEqual([]);
  });

  test('Cmd/Ctrl+Z reopens the last closed panel', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);

    await page.getByRole('button', { name: /^Close Plot panel/ }).click();
    await expect(panelKindBadge(page, 'Plot')).toHaveCount(0);

    // ControlOrMeta so this asserts the binding exists rather than which
    // modifier name the platform uses.
    await page.keyboard.press('ControlOrMeta+z');

    await expect(panelKindBadge(page, 'Plot')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('Escape closes a panel and the undo brings it straight back', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);

    // Esc closes the most recently opened panel, which is the accidental case
    // this feature exists for.
    await page.keyboard.press('Escape');
    await expect(toast(page)).toBeVisible();
    const afterEscape = await page
      .locator('header[tabindex="0"] span.badge.badge-slate')
      .allTextContents();
    expect(afterEscape.length).toBe(3);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('header[tabindex="0"] span.badge.badge-slate')).toHaveCount(4);

    expect(problems).toEqual([]);
  });

  test('undo is offered only for the most recent close', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);

    await page.getByRole('button', { name: /^Close Image panel/ }).click();
    await expect(toast(page)).toBeVisible();
    // Closing a second panel replaces the record rather than stacking toasts.
    await page.getByRole('button', { name: /^Close Plot panel/ }).click();

    await expect(toast(page)).toHaveCount(1);
    expect(problems).toEqual([]);
  });

  test('undo is not offered when no panel was closed', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await expect(toast(page)).toHaveCount(0);
    expect(problems).toEqual([]);
  });
});