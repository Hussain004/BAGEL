/**
 * Zooming the timeline: wheel, pinch, buttons, keys and the overview strip.
 */

import { test, expect, type Page } from '@playwright/test';

async function openSample(page: Page) {
  await page.goto('/');
  await page.locator('button:has-text("EXPLORE SAMPLE DATA")').click();
  await expect(page.locator('#timeline-track')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Pause playback' }).click();
}

const track = (page: Page) => page.locator('#timeline-track');
const seconds = async (page: Page) => Number(await track(page).getAttribute('aria-valuenow'));
const rangeText = (page: Page) => page.getByTestId('timeline-zoom-range').textContent();

async function box(page: Page) {
  const b = (await track(page).boundingBox())!;
  return { ...b, y: b.y + b.height / 2 };
}

test('scroll zooms around the cursor, so a click there lands where it did before', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openSample(page);
  const b = await box(page);
  const x = b.x + b.width * 0.25;

  await expect(page.getByTestId('timeline-navigator')).toHaveCount(0);
  await expect(page.locator('#timeline-zoom-out')).toBeDisabled();
  await page.mouse.click(x, b.y);
  const before = await seconds(page);

  await page.mouse.move(x, b.y);
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -200);
  await expect(page.getByTestId('timeline-navigator')).toBeVisible();
  await expect(page.locator('#timeline-zoom-out')).toBeEnabled();
  expect(await rangeText(page)).toMatch(/\(x\d/);

  // The point under the cursor stayed put, and the far end is now much closer in time.
  await page.mouse.click(x, b.y);
  expect(Math.abs((await seconds(page)) - before)).toBeLessThan(0.7);
  await page.mouse.click(b.x + b.width * 0.75, b.y);
  const far = await seconds(page);
  // Four scroll steps leave about a fifth of the 30 s recording across the bar, so half the bar is about 3 s; unzoomed it would be 15 s.
  expect(far - before).toBeGreaterThan(2);
  expect(far - before).toBeLessThan(4.5);

  // Fit puts everything back.
  await page.locator('#timeline-zoom-fit').click();
  await expect(page.getByTestId('timeline-navigator')).toHaveCount(0);
  await page.mouse.click(b.x + b.width * 0.75, b.y);
  expect((await seconds(page)) - far).toBeGreaterThan(1);
  expect(errors).toEqual([]);
});

test('buttons and keys zoom, and the overview strip pans and jumps', async ({ page }) => {
  await openSample(page);
  await page.locator('#timeline-zoom-in').click();
  await page.locator('#timeline-zoom-in').click();
  await expect(page.getByTestId('timeline-navigator')).toBeVisible();
  const first = await rangeText(page);

  // Out by key, then in by key, with the bar focused.
  await track(page).focus();
  await page.keyboard.press('-');
  expect(await rangeText(page)).not.toEqual(first);
  await page.keyboard.press('+');
  expect(await rangeText(page)).toEqual(first);

  // Dragging the box in the overview pans the window without changing its width.
  const win = (await page.getByTestId('timeline-window').boundingBox())!;
  const widthBefore = win.width;
  await page.mouse.move(win.x + win.width / 2, win.y + win.height / 2);
  await page.mouse.down();
  await page.mouse.move(win.x + win.width / 2 + 80, win.y + win.height / 2, { steps: 5 });
  await page.mouse.up();
  const moved = (await page.getByTestId('timeline-window').boundingBox())!;
  expect(moved.x).toBeGreaterThan(win.x + 40);
  expect(Math.abs(moved.width - widthBefore)).toBeLessThan(2);
  expect(await rangeText(page)).not.toEqual(first);

  // Clicking outside the box centres the window there.
  const strip = (await page.getByTestId('timeline-navigator').locator('div.relative').boundingBox())!;
  await page.mouse.click(strip.x + 6, strip.y + strip.height / 2);
  const home = (await page.getByTestId('timeline-window').boundingBox())!;
  expect(home.x).toBeLessThan(moved.x);

  // Dragging an edge resizes it.
  const edge = (await page.getByTestId('timeline-window').boundingBox())!;
  await page.mouse.move(edge.x + edge.width, edge.y + edge.height / 2);
  await page.mouse.down();
  await page.mouse.move(edge.x + edge.width + 60, edge.y + edge.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await page.getByTestId('timeline-window').boundingBox())!.width).toBeGreaterThan(edge.width + 30);

  await track(page).focus();
  await page.keyboard.press('0');
  await expect(page.getByTestId('timeline-navigator')).toHaveCount(0);
});

test('two fingers pinch the window without moving the playhead', async ({ page, context }) => {
  await openSample(page);
  const b = await box(page);
  const start = await seconds(page);
  const cdp = await context.newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: Array<{ x: number; id: number }>) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: b.y, id: p.id })) });

  const mid = b.x + b.width / 2;
  await touch('touchStart', [{ x: mid - 20, id: 1 }]);
  await touch('touchStart', [{ x: mid - 20, id: 1 }, { x: mid + 20, id: 2 }]);
  for (let i = 1; i <= 8; i++) {
    await touch('touchMove', [{ x: mid - 20 - i * 12, id: 1 }, { x: mid + 20 + i * 12, id: 2 }]);
  }
  await touch('touchEnd', []);

  await expect(page.getByTestId('timeline-navigator')).toBeVisible();
  expect(await rangeText(page)).toMatch(/\(x\d/);
  // The first finger's touch-down had scrubbed the playhead; the second finger put it back.
  expect(Math.abs((await seconds(page)) - start)).toBeLessThan(0.05);
});

test('the window follows the playhead while it plays, and bookmarks off screen are not drawn', async ({ page }) => {
  await openSample(page);
  const b = await box(page);
  await page.mouse.click(b.x + 4, b.y); // near the start
  await page.keyboard.press('m'); // a bookmark here
  await expect(page.locator('#timeline-track .cursor-pointer').first()).toBeAttached();
  const ticks = page.locator('#timeline-track div.w-6');
  await expect(ticks).toHaveCount(1);

  // Zoom right in on the start, then play: the window must move on to keep the playhead in view.
  await page.mouse.move(b.x + 4, b.y);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -300);
  await expect(page.getByTestId('timeline-navigator')).toBeVisible();
  await expect(ticks).toHaveCount(1); // the bookmark is still in the window
  const before = await rangeText(page);
  await page.getByRole('button', { name: 'Start playback' }).click();
  await expect.poll(() => rangeText(page), { timeout: 20_000 }).not.toEqual(before);
  await page.getByRole('button', { name: 'Pause playback' }).click();
  await expect(ticks).toHaveCount(0); // playback carried the window past it
});
