/**
 * XY (field vs field) plot, exercised in a real browser.
 *
 * The geometry has unit tests. What is only provable here is what the user sees:
 * switching the x axis swaps the chart, a circle in the data is a circle on
 * screen under "equal scale" (measured from real pixels), and clicking a point
 * moves the playhead to its time.
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { writeSyntheticMcap } from '../fixtures/synth';

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

/** A radius-2 circle sampled 100 times at 10 Hz: (x, y) = (2 cos a, 2 sin a), a = 2 pi i / 100. */
async function circleBag(): Promise<Buffer> {
  const messages = Array.from({ length: 100 }, (_, i) => {
    const a = (i / 100) * Math.PI * 2;
    return { logTime: 1_000_000_000n + BigInt(i) * 100_000_000n, value: { x: 2 * Math.cos(a), y: 2 * Math.sin(a), z: 0 } };
  });
  return Buffer.from(await writeSyntheticMcap([{ topic: '/pos', type: 'geometry_msgs/msg/Vector3', messages }]));
}

async function openPlot(page: Page) {
  await page.goto('/');
  await page
    .locator('[data-testid="file-input"]')
    .setInputFiles({ name: 'circle.mcap', mimeType: 'application/octet-stream', buffer: await circleBag() });
  const row = page.locator('.topic-row', { hasText: '/pos' }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.hover();
  await row.getByRole('button', { name: /Open time-series plot/ }).click();
  await expect(page.getByLabel('X axis')).toBeVisible({ timeout: 30_000 });
}

/** Bounding box of the saturated (dot-coloured) pixels, in CSS pixels, plus the canvas origin. */
async function dotBox(page: Page) {
  return page.getByTestId('xy-canvas').evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!;
    const { width, height } = c;
    const d = ctx.getImageData(0, 0, width, height).data;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!, a = d[i + 3]!;
        // Turbo dots are strongly saturated; grid lines and text are grey. The time colour
        // bar in the top-right corner is saturated too but is not data, so skip that corner.
        const inLegendCorner = x > width - 140 * (window.devicePixelRatio || 1) && y < 40 * (window.devicePixelRatio || 1);
        if (!inLegendCorner && a > 200 && Math.max(r, g, b) - Math.min(r, g, b) > 90) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    const dpr = window.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    return { x0: x0 / dpr, x1: x1 / dpr, y0: y0 / dpr, y1: y1 / dpr, left: r.left, top: r.top };
  });
}

test('choosing an x axis swaps the time chart for an XY chart, and back', async ({ page }) => {
  const problems = watchForErrors(page);
  await openPlot(page);
  await expect(page.locator('.u-over')).toBeVisible();
  await expect(page.getByTestId('xy-canvas')).toHaveCount(0);

  await page.getByLabel('X axis').selectOption('x');
  await expect(page.getByTestId('xy-canvas')).toBeVisible();
  await expect(page.locator('.u-over')).toBeHidden();
  // SVG export is for the time axis.
  await expect(page.getByRole('button', { name: 'svg', exact: true })).toBeDisabled();

  await page.getByLabel('X axis').selectOption('');
  await expect(page.locator('.u-over')).toBeVisible();
  await expect(page.getByTestId('xy-canvas')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('a circle is a circle with equal scale, and an ellipse without it', async ({ page }) => {
  const problems = watchForErrors(page);
  await openPlot(page);
  await page.getByLabel('X axis').selectOption('x');
  await expect(page.getByTestId('xy-canvas')).toBeVisible();

  // Hide z (a flat line at 0) so only y vs x is drawn.
  await page.getByRole('button', { name: 'z', exact: true }).click();

  await page.getByLabel('equal scale').uncheck();
  await expect.poll(async () => { const b = await dotBox(page); return b.x1 - b.x0; }).toBeGreaterThan(50);
  const free = await dotBox(page);
  // The plot area is wider than it is tall, so without equal scale the circle is stretched.
  expect((free.x1 - free.x0) / (free.y1 - free.y0)).toBeGreaterThan(1.3);

  await page.getByLabel('equal scale').check();
  await expect.poll(async () => { const b = await dotBox(page); return Math.abs((b.x1 - b.x0) - (b.y1 - b.y0)); }).toBeLessThan(6);
  expect(problems).toEqual([]);
});

test('clicking a point seeks to its time', async ({ page }) => {
  const problems = watchForErrors(page);
  await openPlot(page);
  await page.getByLabel('X axis').selectOption('x');
  await page.getByRole('button', { name: 'z', exact: true }).click();
  await page.getByLabel('equal scale').check();
  await expect.poll(async () => { const b = await dotBox(page); return b.x1 - b.x0; }).toBeGreaterThan(50);

  // The topmost point of the circle is angle 90 degrees = sample 25 = t 2.5 s.
  const b = await dotBox(page);
  await page.mouse.click(b.left + (b.x0 + b.x1) / 2, b.top + b.y0 + 2);
  await expect(page.getByText('2.500s').first()).toBeVisible({ timeout: 10_000 });
  expect(problems).toEqual([]);
});
