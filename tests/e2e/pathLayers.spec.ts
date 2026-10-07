/**
 * Path, PoseArray and polygon layers, exercised in a real browser.
 *
 * The extractors and THREE layers have unit tests. What is only provable here
 * is that a Path topic opens in the 3D panel at all (it used to fall through to
 * a blank "pose" scene), that something is actually drawn in the bag's colour,
 * and that a path can be added as an overlay on another panel.
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

const header = { stamp: { sec: 1, nanosec: 0 }, frame_id: 'map' };
const ident = { x: 0, y: 0, z: 0, w: 1 };

/** A radius-2 circle of poses, as a Path, and the same points as a PoseArray. */
function circle(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return { x: 2 * Math.cos(a), y: 2 * Math.sin(a), z: 0 };
  });
}

async function pathBag(): Promise<Buffer> {
  const pts = circle(60);
  return Buffer.from(
    await writeSyntheticMcap([
      {
        topic: '/plan',
        type: 'nav_msgs/msg/Path',
        messages: [
          {
            logTime: 1_000_000_000n,
            value: { header, poses: pts.map((p) => ({ header, pose: { position: p, orientation: ident } })) },
          },
        ],
      },
      {
        topic: '/particles',
        type: 'geometry_msgs/msg/PoseArray',
        messages: [
          { logTime: 1_000_000_000n, value: { header, poses: pts.map((p) => ({ position: p, orientation: ident })) } },
        ],
      },
    ]),
  );
}

/** Pixels in the (first-bag) blue the layers are drawn in, read back from the WebGL canvas. */
async function bluePixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const src = Array.from(document.querySelectorAll('canvas')).find((c) => c.width > 100 && c.height > 100);
    if (!src) return -1;
    const copy = document.createElement('canvas');
    copy.width = src.width;
    copy.height = src.height;
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const d = ctx.getImageData(0, 0, copy.width, copy.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i]! - 59) < 45 && Math.abs(d[i + 1]! - 130) < 45 && Math.abs(d[i + 2]! - 246) < 45) n++;
    }
    return n;
  });
}

async function loadAndOpen(page: Page, topic: string) {
  await page.goto('/');
  await page
    .locator('[data-testid="file-input"]')
    .setInputFiles({ name: 'paths.mcap', mimeType: 'application/octet-stream', buffer: await pathBag() });
  const row = page.locator('.topic-row', { hasText: topic }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.hover();
  await row.getByRole('button', { name: /Open 3D scene/ }).click();
}

for (const [topic, label] of [
  ['/plan', 'Path'],
  ['/particles', 'PoseArray'],
] as const) {
  test(`${topic} (${label}) opens in the 3D panel and is drawn`, async ({ page }) => {
    const problems = watchForErrors(page);
    await loadAndOpen(page, topic);
    await expect(page.getByText(`${label} layer`)).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => bluePixels(page), { timeout: 20_000 }).toBeGreaterThan(30);
    expect(problems).toEqual([]);
  });
}

test('a path can be added as an overlay on another 3D panel', async ({ page }) => {
  const problems = watchForErrors(page);
  await loadAndOpen(page, '/particles');
  await expect(page.getByText('PoseArray layer')).toBeVisible({ timeout: 30_000 });
  // /plan is offered as an overlay candidate for this panel.
  await page.getByRole('button', { name: /Display/ }).first().click();
  await page.getByText('Overlays', { exact: true }).first().click();
  await expect(page.getByText('/plan').first()).toBeVisible();
  expect(problems).toEqual([]);
});
