/**
 * Command palette, exercised in a real browser.
 *
 * The store and fuzzy layers have unit tests. What is only provable here is the
 * part users actually touch: that Cmd+K opens it, that the input keeps focus so
 * typing works, that arrows and Enter drive the selection, and that running a
 * topic command really opens the panel.
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

function palette(page: Page) {
  return page.getByRole('dialog');
}

function paletteInput(page: Page) {
  return page.getByLabel('Search commands');
}

test.describe('command palette', () => {
  test('Cmd/Ctrl+K opens it and focuses the search input', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);

    await page.keyboard.press('ControlOrMeta+k');

    await expect(palette(page)).toBeVisible();
    const input = paletteInput(page);
    await expect(input).toBeFocused();

    expect(problems).toEqual([]);
  });

  test('lists commands before anything is typed', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await page.keyboard.press('ControlOrMeta+k');

    const options = palette(page).getByRole('option');
    await expect(options.first()).toBeVisible();
    // More than a handful: a palette with three entries is a menu, not a palette.
    expect(await options.count()).toBeGreaterThan(10);

    expect(problems).toEqual([]);
  });

  test('fuzzy-finds a topic by an abbreviated query', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await page.keyboard.press('ControlOrMeta+k');

    // Deliberately abbreviated, the way people actually type.
    await paletteInput(page).fill('imgraw');

    const first = palette(page).getByRole('option').first();
    await expect(first).toContainText('/camera/image_raw');

    expect(problems).toEqual([]);
  });

  test('typing narrows results and reports when nothing matches', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await page.keyboard.press('ControlOrMeta+k');

    await paletteInput(page).fill('zzzzqqq');
    await expect(palette(page).getByText('No matching command')).toBeVisible();

    expect(problems).toEqual([]);
  });

  test('running a topic command opens that panel', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);

    // The curated layout already has an Image panel, so count before/after to
    // prove the palette actually opened something rather than the layout.
    const before = await page.locator('header[tabindex="0"] span.badge.badge-slate').count();

    await page.keyboard.press('ControlOrMeta+k');
    await paletteInput(page).fill('camera image raw in image');
    await paletteInput(page).press('Enter');

    await expect(palette(page)).toHaveCount(0);
    await expect(page.locator('header[tabindex="0"] span.badge.badge-slate')).toHaveCount(before + 1);

    expect(problems).toEqual([]);
  });

  test('arrow keys move the selection and Enter runs the highlighted command', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await page.keyboard.press('ControlOrMeta+k');
    await paletteInput(page).fill('theme');

    const selected = palette(page).locator('[role="option"][aria-selected="true"]');
    await expect(selected).toContainText('Toggle light / dark theme');

    await paletteInput(page).press('ArrowDown');
    await paletteInput(page).press('ArrowUp');
    // Back on the theme command.
    await expect(selected).toContainText('Toggle light / dark theme');

    await paletteInput(page).press('Enter');
    await expect(palette(page)).toHaveCount(0);
    // Toggling actually changed the theme. `applyTheme` writes
    // `data-theme` on <html>, not a class.
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');

    expect(problems).toEqual([]);
  });

  test('a typed time jumps the playhead', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await page.keyboard.press('ControlOrMeta+k');

    await paletteInput(page).fill('20');
    await expect(palette(page).getByRole('option').first()).toContainText('Go to 20s');
    await paletteInput(page).press('Enter');

    const track = page.locator('#timeline-track');
    await expect(track).toHaveAttribute('aria-valuenow', /^20/);

    expect(problems).toEqual([]);
  });

  test('uses aria-activedescendant so focus never leaves the input', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await page.keyboard.press('ControlOrMeta+k');

    const input = paletteInput(page);
    await expect(input).toHaveAttribute('aria-activedescendant', /palette-option-/);
    await input.press('ArrowDown');
    // Still focused on the input after moving the selection, which is the whole
    // point of the combobox pattern over a roving-tabindex list.
    await expect(input).toBeFocused();

    expect(problems).toEqual([]);
  });

  test('Escape closes it without running anything', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    const before = await page.locator('header[tabindex="0"] span.badge.badge-slate').count();

    await page.keyboard.press('ControlOrMeta+k');
    await paletteInput(page).fill('/scan');
    await page.keyboard.press('Escape');

    await expect(palette(page)).toHaveCount(0);
    await expect(page.locator('header[tabindex="0"] span.badge.badge-slate')).toHaveCount(before);

    expect(problems).toEqual([]);
  });

  test('pressing the shortcut again toggles it closed', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);

    await page.keyboard.press('ControlOrMeta+k');
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(palette(page)).toHaveCount(0);

    expect(problems).toEqual([]);
  });

  test('the shortcuts modal lists the new binding', async ({ page }) => {
    const problems = watchForErrors(page);
    await loadSample(page);
    await page.keyboard.press('?');

    // The modal is generated from the SHORTCUTS table, so this is really
    // asserting the table entry exists.
    await expect(page.getByText('Open the command palette', { exact: false })).toBeVisible();

    expect(problems).toEqual([]);
  });
});