/**
 * Installable app: the service worker makes BAGEL open and load a bag with no
 * network, and offline responses must keep the COOP/COEP headers or
 * `crossOriginIsolated` silently turns off (the splat viewer depends on it).
 */

import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'allow' });

const SAMPLE_BUTTON = 'button:has-text("EXPLORE SAMPLE DATA")';

test('manifest is linked and declares file handlers', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await (await request.get(href!)).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.file_handlers[0].accept['application/octet-stream']).toEqual(expect.arrayContaining(['.mcap', '.bag', '.db3']));
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok(), icon.src).toBe(true);
});

test('works offline after a visit, with cross-origin isolation intact', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  // Reload so this page is controlled by the worker, then ask for the full precache.
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready.then((r) => r.active!.postMessage({ type: 'precache' })));
  await expect
    .poll(async () => page.evaluate(async () => (await (await caches.open('bagel-app-v1')).match('/sample-bags/tour.mcap')) !== undefined), { timeout: 60_000 })
    .toBe(true);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(SAMPLE_BUTTON)).toBeVisible();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  await page.locator(SAMPLE_BUTTON).click();
  await expect(page.locator('#timeline-track')).toBeVisible({ timeout: 60_000 });
});
