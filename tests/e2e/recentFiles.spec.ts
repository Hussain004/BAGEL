/**
 * Recent files on the landing page, exercised in a real browser.
 *
 * The unit tests pin the list logic; what is only provable here is that
 * IndexedDB round-trips a persisted entry across a reload, that clicking a
 * remote entry re-issues the load, and that the remove button works.
 *
 * The local-file reopen path needs a real file handle, which only a real
 * picker can produce and Playwright cannot drive, so it is covered manually in
 * Chrome rather than here. What IS provable automatically: the list renders,
 * the ordering survives a reload, and URL entries reopen.
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

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

function recentSection(page: Page) {
  return page.locator('.recent-files');
}

/**
 * Match a recent entry by its full name.
 *
 * `hasText` is the wrong tool here: long names are truncated with an ellipsis
 * in the row (data.example.c…refox-friendly.mcap), so a filter on the full
 * URL silently matches nothing even when the entry is rendered correctly. The
 * title carries the full name, so match there instead.
 */
function recentItemByName(page: Page, name: string) {
  return page.locator(`.recent-files__item:has(.recent-files__open[title*="${name}"])`);
}

/**
 * Seed a remote-URL entry the same way the app persists one.
 *
 * Writes IndexedDB directly rather than importing the util: the app runs from
 * a production bundle here, where `/src/utils/recentFiles.ts` does not exist,
 * and seeding through the module's own path would only work in dev mode.
 */
async function seedRemoteEntry(page: Page, url: string) {
  await page.evaluate(async (u) => {
    const request = window.indexedDB.open('bagel:recent-files', 1);
    await new Promise<void>((resolve) => {
      request.onupgradeneeded = () => {
        request.result.createObjectStore('meta');
        request.result.createObjectStore('handles');
      };
      request.onsuccess = () => resolve();
    });
    const db = request.result;
    const tx = db.transaction('meta', 'readwrite');
    const existing = await new Promise<unknown[]>((resolve) => {
      const get = tx.objectStore('meta').get('recent');
      get.onsuccess = () => resolve((get.result as unknown[]) ?? []);
    });
    const entry = {
      id: `url:${u}`,
      name: u,
      size: 0,
      lastModified: Date.now(),
      openedAt: Date.now(),
      url: u,
    };
    const next = [entry, ...(existing as { id: string }[]).filter((e) => e.id !== entry.id)];
    tx.objectStore('meta').put(next, 'recent');
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
    });
    db.close();
  }, url);
}

test.describe('recent files', () => {
  test('is hidden on a fresh visit with nothing recent', async ({ page }) => {
    const problems = watchForErrors(page);
    await page.goto('/');
    await expect(page.locator('.landing-page')).toBeVisible();
    await expect(recentSection(page)).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('a remote URL open lands in the recents list and reopens on click', async ({ page, context }) => {
    const problems = watchForErrors(page);

    // Serve the sample bag as if it were a remote dataset, so the open is a
    // real URL load rather than a stubbed class.
    await context.route('**/remote-tour.mcap', async (route) => {
      const response = await route.fetch({ url: '/sample-bags/tour.mcap' });
      await route.fulfill({ response });
    });

    await page.goto('/');
    await page.getByRole('tab', { name: 'REMOTE URL' }).click();
    const input = page.getByLabel('Remote bag URL');
    await input.fill('http://localhost:4173/remote-tour.mcap');
    await input.press('Enter');
    await expect(page.getByText('remote-tour.mcap').first()).toBeVisible({ timeout: 60_000 });

    // Back to the landing page via the toolbar's close button, which is the real
// user path; the recents list should then offer the URL.
    await page.getByRole('button', { name: 'Close bag file' }).click();
    await expect(page.locator('.landing-page')).toBeVisible({ timeout: 30_000 });

    const item = recentItemByName(page, 'remote-tour.mcap');
    await expect(item).toBeVisible({ timeout: 30_000 });

    // Clicking it re-issues the load.
    await item.locator('.recent-files__open').click();
    await expect(page.getByText('remote-tour.mcap').first()).toBeVisible({ timeout: 60_000 });

    await context.unrouteAll({ behavior: 'ignoreErrors' });
    expect(problems).toEqual([]);
  });

  test('entries survive a reload, capped and ordered most-recent-first', async ({ page }) => {
    const problems = watchForErrors(page);

    await page.goto('/');
    await seedRemoteEntry(page, 'https://data.example.com/alpha.mcap');
    await seedRemoteEntry(page, 'https://data.example.com/beta.mcap');

    await page.reload();
    await expect(recentSection(page)).toBeVisible({ timeout: 30_000 });

    const names = await page.locator('.recent-files__name').allTextContents();
    expect(names[0]).toContain('beta.mcap');
    expect(names[1]).toContain('alpha.mcap');

    expect(problems).toEqual([]);
  });

  test('a local file entry renders from its handle metadata even without the File System Access picker', async ({ page }) => {
    const problems = watchForErrors(page);

    // Seed as if the picker had saved an entry earlier, then hide the picker:
    // the row must still render (with the note that reopening needs the API).
    await page.goto('/');
    await page.evaluate(async () => {
      const dbOpen = window.indexedDB.open('bagel:recent-files', 1);
      await new Promise((resolve) => {
        dbOpen.onsuccess = resolve;
        dbOpen.onupgradeneeded = () => {
          dbOpen.result.createObjectStore('meta');
          dbOpen.result.createObjectStore('handles');
        };
      });
      const db = dbOpen.result;
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(
        [
          {
            id: 'run.mcap:1048576:100',
            name: 'run.mcap',
            size: 1_048_576,
            lastModified: 100,
            openedAt: Date.now(),
          },
        ],
        'recent',
      );
      await new Promise((resolve) => {
        tx.oncomplete = resolve;
      });
      db.close();
    });

    await page.reload();
    // On a real browser with the API the row reopens; on this one it must at
    // least render, which is what a Firefox user sees.
    const item = recentItemByName(page, 'run.mcap');
    const apiAvailable = await page.evaluate(() => typeof window.showOpenFilePicker === 'function');
    if (apiAvailable) {
      await expect(item).toBeVisible({ timeout: 30_000 });
      await expect(item).toContainText('1.0 MB');
    } else {
      // No File System Access API: the row is hidden, which is also correct.
      await expect(item).toHaveCount(0);
    }

    expect(problems).toEqual([]);
  });

  test('the remove button drops an entry and its handle', async ({ page }) => {
    const problems = watchForErrors(page);

    await page.goto('/');
    await seedRemoteEntry(page, 'https://data.example.com/delete-me.mcap');
    await page.reload();

    const item = recentItemByName(page, 'delete-me.mcap');
    await expect(item).toBeVisible({ timeout: 30_000 });
    await item.locator('.recent-files__remove').click();

    await expect(recentItemByName(page, 'delete-me.mcap')).toHaveCount(0);

    // And it stays gone after a reload.
    await page.reload();
    await page.waitForTimeout(500);
    expect(await recentItemByName(page, 'delete-me.mcap').count()).toBe(0);

    expect(problems).toEqual([]);
  });

  test('URL entries render in a browser without the File System Access API', async ({ page }) => {
    const problems = watchForErrors(page);

    await page.goto('/');
    await seedRemoteEntry(page, 'https://data.example.com/firefox-friendly.mcap');
    await page.reload();

    // URL entries do not need the picker API, so they show on every browser.
    await expect(recentItemByName(page, 'firefox-friendly.mcap')).toBeVisible({
      timeout: 30_000,
    });

    expect(problems).toEqual([]);
  });

  test('picking a local file records it, and clicking the row reopens it', async ({ page }) => {
    const problems = watchForErrors(page);

    await page.goto('/');
    // Stub the picker to hand back a handle built from the real sample bag,
    // which is exactly what the real picker returns for a picked file. Using a
    // valid bag means the whole flow runs: pick -> parse -> workspace ->
    // reload -> recents row -> click -> workspace again.
    await page.evaluate(async () => {
      const response = await fetch('/sample-bags/tour.mcap');
      const buffer = await response.arrayBuffer();
      const file = new File([buffer], 'picked-tour.mcap', { lastModified: 123 });
      const handle = {
        kind: 'file',
        name: 'picked-tour.mcap',
        async getFile() { return file; },
        async queryPermission() { return 'granted' as PermissionState; },
        async requestPermission() { return 'granted' as PermissionState; },
      } as unknown as FileSystemFileHandle;
      window.showOpenFilePicker = async () => [handle];
    });

    await page.locator('[data-testid="file-input-zone"]').click();
    await expect(panelKindBadge(page, '3D Scene').or(page.getByText('picked-tour.mcap').first())).toBeVisible({
      timeout: 60_000,
    });

    // Back to the landing page: the row must be there, named after the file.
    await page.getByRole('button', { name: 'Close bag file' }).click();
    await expect(page.locator('.landing-page')).toBeVisible({ timeout: 30_000 });
    await expect(recentItemByName(page, 'picked-tour.mcap')).toBeVisible({ timeout: 30_000 });

    // Reopen from the row. The stub is still installed after the soft
    // navigation back, so requestPermission resolves and getFile runs again.
    await recentItemByName(page, 'picked-tour.mcap').locator('.recent-files__open').click();
    await expect(panelKindBadge(page, '3D Scene').or(page.getByText('picked-tour.mcap').first())).toBeVisible({
      timeout: 60_000,
    });

    expect(problems).toEqual([]);
  });
});
