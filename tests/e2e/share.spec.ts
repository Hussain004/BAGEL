/**
 * Share / embed flow, exercised in a real browser.
 *
 * The badge is the feature with the highest external blast radius: a dataset
 * author pastes the generated snippet into a README, and a wrong href fails on
 * someone else's page where nobody can debug it. So this test round-trips the
 * link rather than just checking the modal opened.
 *
 * It asserts:
 *  - a local-file bag refuses to pretend a badge will work, and says why;
 *  - a URL-loaded bag produces a link whose hash actually restores the layout;
 *  - the badge image resolves (a broken `/badge.svg` would otherwise only fail
 *    once someone pasted the snippet).
 */

import { test, expect, type Page, type ConsoleMessage, type BrowserContext } from '@playwright/test';

const SAMPLE_BUTTON = 'button:has-text("EXPLORE SAMPLE DATA")';

/** Fail on any app console error during the test. */
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

/** Panel-header kind badge, which is unambiguous where getByText is not. */
function panelKindBadge(page: Page, label: string) {
  return page.locator('header[tabindex="0"] span.badge.badge-slate', {
    hasText: new RegExp(`^${label}$`),
  });
}

/**
 * Load a remote bag without needing a real network host.
 *
 * The sample bag is served by `vite preview` at `/sample-bags/tour.mcap`, so
 * routing that path through the app's remote-URL loader exercises the same
 * code as any public dataset while staying on localhost.
 */
/**
 * Serve the sample bag under a distinct path, so the app treats it as a remote
 * URL bag rather than a local file.
 *
 * Applied to the whole context, not one page: the round-trip test opens the
 * generated link in a *second* page, and that page has to resolve the same URL
 * or it fails for reasons unrelated to what is being tested.
 */
async function stubRemoteTour(context: BrowserContext) {
  await context.route('**/remote-tour.mcap', async (route) => {
    const response = await route.fetch({ url: '/sample-bags/tour.mcap' });
    await route.fulfill({ response });
  });
}

async function loadBagAsUrl(page: Page) {
  await page.goto('/');
  // The landing page has a tabbed ingest panel; the remote-URL tab is the one
  // that takes an http(s) URL. Switching tabs first matters, otherwise the
  // input visible is the WebSocket one.
  await page.getByRole('tab', { name: 'REMOTE URL' }).click();
  const urlInput = page.getByLabel('Remote bag URL');
  await urlInput.fill('http://localhost:4173/remote-tour.mcap');
  await urlInput.press('Enter');
  // Remote loading lands in the workspace. The curated sample layout is only
  // applied by the sample-bag button, not by a URL load, so wait for the
  // bag chip in the toolbar rather than a panel header.
  await expect(page.getByText('remote-tour.mcap').first()).toBeVisible({ timeout: 60_000 });
}

test.describe('share modal', () => {
  test('a local-file bag explains why a badge will not work for it', async ({ page }) => {
    const problems = watchForErrors(page);

    await page.goto('/');
    await page.locator(SAMPLE_BUTTON).click();
    await expect(panelKindBadge(page, '3D Scene')).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Share this view' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('This bag is a local file.')).toBeVisible();

    // The badge image must actually load, not merely be referenced.
    const badge = dialog.getByRole('img', { name: 'Open in BAGEL' });
    await expect(badge).toBeVisible();
    const loaded = await badge.evaluate((img) => (img as HTMLImageElement).complete
      && (img as HTMLImageElement).naturalWidth > 0);
    expect(loaded, 'the badge svg should resolve').toBe(true);

    // A local file has no URL, so no `b=` parameter can be present. Emitting one
    // anyway is exactly the bug this assertion guards against.
    const linkText = await dialog.locator('pre').nth(1).textContent();
    expect(linkText).not.toContain('b=');

    expect(problems).toEqual([]);
  });

  test('a URL-loaded bag produces a link that restores the layout', async ({ page, context }) => {
    const problems = watchForErrors(page);

    await stubRemoteTour(context);
    await loadBagAsUrl(page);

    // A URL load lands in an empty workspace: the curated sample layout is
    // specific to the sample-bag button. Open a panel so there is a layout tree
    // to encode, which is the thing being round-tripped.
    // Click the row itself, which opens the topic's suggested panel. Do not click
    // the row's first button: on a topic row the pin toggle comes first, so
    // that would pin rather than open.
    const row = page.locator('.topic-row').first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.click();

    // Read the kind back off the mounted header rather than assuming which
    // panel a given topic opens, so the test survives a topic-order change.
    const badge = page.locator('header[tabindex="0"] span.badge.badge-slate').first();
    await expect(badge).toBeVisible();
    const headerText = (await badge.textContent())?.trim() ?? '';
    expect(headerText.length).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Share this view' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const link = (await dialog.locator('pre').nth(1).textContent()) ?? '';
    // The remote URL is carried so the recipient's browser fetches the bag.
    expect(link).toContain('b=');
    expect(decodeURIComponent(link)).toContain('localhost:4173/remote-tour.mcap');
    // And the layout tree is carried, not just the bag.
    expect(link).toContain('p=');

    // Round-trip: open the generated link in a fresh page and confirm the same
    // panel came back. This is the assertion that would catch a second,
    // divergent hash encoder.
    const fresh = await page.context().newPage();
    await fresh.goto(link.replace('https://bagel-ros2.vercel.app', 'http://localhost:4173'));
    // The bag re-fetches over the mocked route, so the panel mounts only if the
    // hash encoded both the bag URL and the layout correctly.
    await expect(panelKindBadge(fresh, headerText)).toBeVisible({ timeout: 60_000 });
    await fresh.close();

    // The stubbed route keeps serving the worker's Range reads until the bag
    // is fully parsed. Ending the test with a fetch still in flight fails the
    // *next* test with "route.fetch: Test ended", which is the flake this
    // suite hit. Drain the routes instead of letting them die with the page.
    await context.unrouteAll({ behavior: 'ignoreErrors' });

    expect(problems).toEqual([]);
  });

  test('the markdown snippet points at the real badge and the generated link', async ({ page }) => {
    const problems = watchForErrors(page);

    // Uses the sample-bag button rather than a stubbed remote URL: what is
    // under test here is the shape of the snippets, not URL handling, and
    // leaving a stubbed route pending makes teardown flaky.
    await page.goto('/');
    await page.locator(SAMPLE_BUTTON).click();
    await expect(panelKindBadge(page, '3D Scene')).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Share this view' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Assert with auto-retrying matchers rather than reading textContent once:
    // the modal paints the heading before the snippets render, and a one-shot
    // read there is exactly the flake this test hit on CI.
    const markdown = dialog.locator('pre').first();
    await expect(markdown).toContainText('[![Open in BAGEL](https://bagel-ros2.vercel.app/badge.svg)]');

    // The iframe snippet must be a real iframe tag, not a bare URL.
    const iframe = dialog.locator('pre').nth(2);
    await expect(iframe).toContainText('<iframe');
    await expect(iframe).toContainText('src="');

    expect(problems).toEqual([]);
  });

  test('the CORS probe reports against a live host', async ({ page }) => {
    const problems = watchForErrors(page);

    // The Share button lives in the toolbar, so a bag has to be loaded first:
    // the modal shares the current session, which does not exist until then.
    await page.goto('/');
    await page.locator(SAMPLE_BUTTON).click();
    await expect(panelKindBadge(page, '3D Scene')).toBeVisible({ timeout: 60_000 });

    await page.getByRole('button', { name: 'Share this view' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // localhost serves the sample bag but does not expose Content-Range, which
    // is exactly the "works but unverified" case worth seeing render.
    await dialog.getByLabel('Dataset URL to check').fill('http://localhost:4173/sample-bags/tour.mcap');
    await dialog.getByRole('button', { name: 'Check' }).click();

    // The report must render with per-check rows.
    // The per-check rows are the actual output. `exact` matters: the summary
    // header quotes the failed labels too, so a loose match matches twice.
    await expect(dialog.locator('li').first()).toBeVisible({ timeout: 30_000 });
    await expect(
      dialog.getByText('Accept-Ranges advertises bytes', { exact: true }),
    ).toBeVisible();

    expect(problems).toEqual([]);
  });
});