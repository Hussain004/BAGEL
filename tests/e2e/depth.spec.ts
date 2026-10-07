/**
 * Depth image colormaps, exercised in a real browser.
 *
 * The colormap math has unit tests. What is only provable here is that a raw
 * 32FC1 / 16UC1 topic (previously "Unsupported image encoding") now decodes,
 * that the color bar and range controls appear, and that changing the
 * colormap re-renders without errors.
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

const W = 32;
const H = 24;

function depthImage(encoding: '32FC1' | '16UC1') {
  const bytes = encoding === '32FC1' ? 4 : 2;
  const data = new Uint8Array(W * H * bytes);
  const view = new DataView(data.buffer);
  for (let i = 0; i < W * H; i++) {
    // A ramp with a hole of invalid pixels in the top-left corner.
    const invalid = i % W < 4 && Math.floor(i / W) < 4;
    const t = (i % W) / W;
    if (encoding === '32FC1') view.setFloat32(i * 4, invalid ? NaN : 0.5 + t * 4, true);
    else view.setUint16(i * 2, invalid ? 0 : Math.round(500 + t * 4000), true);
  }
  return {
    header: { stamp: { sec: 1, nanosec: 0 }, frame_id: 'cam' },
    height: H,
    width: W,
    encoding,
    is_bigendian: 0,
    step: W * bytes,
    data,
  };
}

async function depthBag(): Promise<Buffer> {
  const bytes = await writeSyntheticMcap([
    {
      topic: '/depth_m',
      type: 'sensor_msgs/msg/Image',
      messages: [{ logTime: 1_000_000_000n, value: depthImage('32FC1') }],
    },
    {
      topic: '/depth_mm',
      type: 'sensor_msgs/msg/Image',
      messages: [{ logTime: 1_000_000_000n, value: depthImage('16UC1') }],
    },
  ]);
  return Buffer.from(bytes);
}

test.describe('depth image colormaps', () => {
  for (const [topic, unit] of [
    ['/depth_m', 'm'],
    ['/depth_mm', 'mm'],
  ] as const) {
    test(`${topic} renders with a colormap bar in ${unit}`, async ({ page }) => {
      const problems = watchForErrors(page);
      await page.goto('/');
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({ name: 'depth.mcap', mimeType: 'application/octet-stream', buffer: await depthBag() });

      const row = page.locator('.topic-row', { hasText: topic }).first();
      await expect(row).toBeVisible({ timeout: 60_000 });
      await row.hover();
      await row.getByRole('button', { name: /Open image viewer/ }).click();

      const bar = page.getByRole('img', { name: /Depth scale from/ });
      await expect(bar).toBeVisible({ timeout: 30_000 });
      await expect(bar).toHaveAttribute('aria-label', new RegExp(`${unit}$`));
      await expect(page.getByText('Could not decode frame')).toHaveCount(0);

      await page.getByLabel('colormap').selectOption('gray');
      await expect(bar).toBeVisible();
      await page.getByLabel(/Depth range maximum/).fill('2');
      await expect(page.getByRole('button', { name: 'auto range' })).toBeVisible();
      await page.getByRole('button', { name: 'auto range' }).click();
      await expect(page.getByRole('button', { name: 'auto range' })).toHaveCount(0);

      expect(problems).toEqual([]);
    });
  }
});
