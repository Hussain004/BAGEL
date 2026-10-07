/**
 * Browser smoke test.
 *
 * The point of this file is narrow and specific: mount the real, built app in
 * a real browser and fail if anything throws or logs an error. It exists
 * because of a bug that got all the way to `main` through green CI.
 *
 * That bug was a Zustand selector returning a fresh `[]` on every call, which
 * React treats as a changed value forever. It caused an infinite render loop.
 * `tsc -b` passed (the types were correct). All 749 Vitest tests passed (the
 * suite is logic-only and never mounts React). Lint passed. The app simply
 * froze the moment you clicked "Try a sample bag". Nothing short of actually
 * rendering it would have caught that.
 *
 * So the assertions here are deliberately about *absence of failure*:
 * console errors, page errors, and panels that fail to mount. There are no
 * pixel assertions and no visual snapshots. WebGL under SwiftShader renders,
 * but the splat GPU sort is known to come up blank there, and a smoke test
 * that asserts on rendering would start failing for reasons that have nothing
 * to do with the app.
 *
 * If this test fails, read the attached trace before changing the test. A
 * genuine app bug looks like a repeat of the error; tooling flakiness looks
 * like a timeout with an empty log.
 */

import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Collects everything that should not happen. Attached before any navigation
 * so nothing during first paint escapes.
 */
function watchForErrors(page: Page): string[] {
  const problems: string[] = [];

  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`);
  });

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // Vite's dev overlay is bypassed because we test the production bundle,
    // but a failed favicon or source map request is not an app bug and should
    // not fail CI.
    if (/favicon|source ?map/i.test(text)) return;
    problems.push(`console.error: ${text}`);
  });

  return problems;
}

/**
 * Asserts no problems accumulated. Clearing the array is deliberate: a later
 * step in the same test can pass, and we do not want its earlier failure
 * masked by a failure that already reported.
 */
function expectClean(problems: string[], step: string): void {
  expect(problems, `${step} should not produce console or page errors`).toEqual([]);
}

/** The landing page's sample-bag button. */
const SAMPLE_BUTTON = 'button:has-text("EXPLORE SAMPLE DATA")';

/**
 * The kind badge inside an open panel's header.
 *
 * Scoped deliberately: the words "Image", "Plot", and "3D Scene" also appear in
 * the topic sidebar's quick-open buttons and in a panel's own readout, so a
 * bare `getByText('Image')` matches several elements and Playwright's strict
 * mode rejects it. `.badge-slate` is the panel-header kind chip and nothing
 * else, which makes this both unambiguous and a real check that the panel
 * chrome mounted.
 */
function panelKindBadge(page: Page, label: string) {
  return page.locator('header[tabindex="0"] span.badge.badge-slate', {
    hasText: new RegExp(`^${label}$`),
  });
}

/** Every mounted panel header. */
function panelHeaders(page: Page) {
  return page.locator('header[tabindex="0"]');
}

test('landing page renders without errors', async ({ page }) => {
  const problems = watchForErrors(page);

  await page.goto('/');
  await expect(page.locator('body')).toBeVisible();
  await expect(page.locator(SAMPLE_BUTTON)).toBeVisible();
  expectClean(problems, 'landing page load');
});

test('loading the sample bag mounts a curated layout without errors', async ({ page }) => {
  const problems = watchForErrors(page);

  await page.goto('/');
  await page.locator(SAMPLE_BUTTON).click();

  // The curated layout is H(3d, V(image, plot)): three panels, so three panel
  // headers. Waiting on all three is a much better signal than a fixed sleep,
  // because it means the layout store committed AND the panels mounted.
  await expect(panelKindBadge(page, '3D Scene')).toBeVisible({ timeout: 60_000 });
  await expect(panelKindBadge(page, 'Image')).toBeVisible();
  await expect(panelKindBadge(page, 'Plot')).toBeVisible();

  // The sample layout parks the playhead 3s in and starts playback, so the
  // scrub track should be interactive and reporting a non-zero position.
  const track = page.locator('#timeline-track');
  await expect(track).toBeVisible();
  await expect(track).toHaveAttribute('role', 'slider');
  const now = Number(await track.getAttribute('aria-valuenow'));
  expect(now).toBeGreaterThan(0);

  expectClean(problems, 'sample bag load');

  // Give the render loop a beat to settle, then re-check. An infinite loop
  // often surfaces a console error on a later tick rather than the first
  // render, and this is exactly the bug this file exists to catch.
  await page.waitForTimeout(2000);
  expectClean(problems, 'sample bag load, after settling');
});

test('every panel kind in the sample bag opens without errors', async ({ page }) => {
  const problems = watchForErrors(page);

  await page.goto('/');
  await page.locator(SAMPLE_BUTTON).click();
  await expect(panelKindBadge(page, '3D Scene')).toBeVisible({ timeout: 60_000 });

  // Open one panel of each remaining kind from the topic sidebar. The quick
  // buttons on a topic row are the real user path, and they exercise
  // panelOptionsFor() routing rather than the panel bodies alone.
  //
  // Which kinds are reachable depends on what tour.mcap publishes, so this
  // walks the buttons it can find rather than asserting an exact set. The
  // assertion that matters is the error log, not the count.
  const row = page.locator('.topic-row').first();
  await expect(row).toBeVisible();

  const quickButtons = row.locator('button[aria-label]');
  const count = await quickButtons.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    await quickButtons.nth(i).click();
    await page.waitForTimeout(400);
  }

  // Panels must actually mount. An empty panel grid after clicking every
  // button would be a silent failure that no error log would report.
  await expect(panelHeaders(page).first()).toBeVisible();
  expect(await panelHeaders(page).count()).toBeGreaterThan(1);

  expectClean(problems, 'opening panels from the topic list');

  await page.waitForTimeout(1000);
  expectClean(problems, 'opening panels, after settling');
});

test('timeline scrubbing works from the keyboard', async ({ page }) => {
  const problems = watchForErrors(page);

  await page.goto('/');
  await page.locator(SAMPLE_BUTTON).click();

  const track = page.locator('#timeline-track');
  await expect(track).toBeVisible({ timeout: 60_000 });

  // Pause first: the curated layout starts playback, and a moving playhead
  // would make the before/after comparison meaningless.
  const playPause = page.locator('#timeline-play-pause');
  await playPause.click();
  await expect(playPause).toHaveAttribute('aria-label', 'Start playback');

  const before = Number(await track.getAttribute('aria-valuenow'));
  expect(before).toBeGreaterThan(0);

  // Arrow keys are bound globally (useKeyboardShortcuts), which is why this
  // does not require focusing the track first.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);

  const after = Number(await track.getAttribute('aria-valuenow'));
  expect(after, 'arrow keys should move the playhead forward').toBeGreaterThan(before);

  await page.keyboard.press('Home');
  await page.waitForTimeout(300);
  expect(Number(await track.getAttribute('aria-valuenow'))).toBe(0);

  expectClean(problems, 'keyboard scrubbing');
});

test('theme toggle re-renders data surfaces without errors', async ({ page }) => {
  const problems = watchForErrors(page);

  await page.goto('/');
  await page.locator(SAMPLE_BUTTON).click();
  await expect(panelKindBadge(page, 'Plot')).toBeVisible({ timeout: 60_000 });

  // Light mode re-themes uPlot axes and the 3D clear color, which read CSS
  // variables at construction time. That path has no unit-test coverage and is
  // exactly the sort of thing that breaks silently.
  const toggle = page.getByRole('button', { name: /theme|light|dark/i }).first();
  await toggle.click();
  await page.waitForTimeout(1500);
  expectClean(problems, 'theme toggle');

  await toggle.click();
  await page.waitForTimeout(1500);
  expectClean(problems, 'theme toggle back');
});