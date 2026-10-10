/**
 * Foxglove annotations in a real browser: ImageAnnotations drawn over a camera
 * image, and a SceneUpdate drawn in the 3D view, from a JSON-encoded MCAP.
 */

import { test, expect } from '@playwright/test';
import { writeJsonMcap } from '../fixtures/jsonMcap';

const T = (s: number) => BigInt(s) * 1_000_000_000n;
const stamp = (sec: number, nsec = 0) => ({ sec, nsec });
const RED = { r: 1, g: 0, b: 0, a: 1 };
const GREEN = { r: 0, g: 1, b: 0, a: 1 };
const CLEAR = { r: 0, g: 0, b: 0, a: 0 };

const W = 64;
const H = 48;
const image = (sec: number) => ({ timestamp: stamp(sec), frame_id: 'camera', width: W, height: H, encoding: 'rgb8', step: W * 3, data: Buffer.alloc(W * H * 3, 90).toString('base64') });

const annotations = (sec: number, nsec = 0) => ({
  circles: [
    { timestamp: stamp(sec, nsec), position: { x: 20, y: 20 }, diameter: 12, thickness: 2, fill_color: CLEAR, outline_color: RED },
    { timestamp: stamp(sec, nsec), position: { x: 40, y: 30 }, diameter: 8, thickness: 1, fill_color: GREEN, outline_color: CLEAR },
  ],
  points: [{ timestamp: stamp(sec, nsec), type: 3, points: [{ x: 5, y: 5 }, { x: 30, y: 10 }, { x: 50, y: 40 }], outline_color: GREEN, thickness: 2 }],
  texts: [{ timestamp: stamp(sec, nsec), position: { x: 8, y: 44 }, text: 'pedestrian', font_size: 6, text_color: RED, background_color: CLEAR }],
});

const cube = (i: number) => ({ pose: { position: { x: i * 2, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }, size: { x: 1, y: 1, z: 1 }, color: RED });
const entity = (id: string, n: number, sec: number) => ({ timestamp: stamp(sec), frame_id: 'map', id, lifetime: stamp(0), cubes: Array.from({ length: n }, (_, i) => cube(i)) });

async function bag() {
  return Buffer.from(
    await writeJsonMcap([
      { topic: '/camera', schemaName: 'foxglove.RawImage', messages: [1, 2, 3].map((s) => ({ logTime: T(s), value: image(s) })) },
      {
        topic: '/annotations',
        schemaName: 'foxglove.ImageAnnotations',
        messages: [
          { logTime: T(1), value: annotations(1) },
          { logTime: T(2), value: annotations(2) },
          { logTime: T(3), value: annotations(3, 500_000_000) }, // half a second after its frame
        ],
      },
      {
        topic: '/scene',
        schemaName: 'foxglove.SceneUpdate',
        messages: [
          { logTime: T(1), value: { entities: [entity('boxes', 4, 1)] } },
          { logTime: T(2), value: { entities: [entity('boxes', 2, 2)] } }, // replaces, does not add
        ],
      },
    ]),
  );
}

test('annotations draw over the image, go away when stale, and 3D shows the scene update', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('[data-testid="file-input"]').setInputFiles({ name: 'annotated.mcap', mimeType: 'application/octet-stream', buffer: await bag() });
  for (const t of ['/camera', '/annotations', '/scene']) await expect(page.locator('.topic-row', { hasText: t }).first()).toBeVisible({ timeout: 60_000 });

  // The annotations topic itself opens as raw data, not an empty plot.
  const arow = page.locator('.topic-row', { hasText: '/annotations' }).first();
  await arow.click();
  await expect(page.locator('header[tabindex="0"]', { hasText: '/annotations' }).first()).toBeVisible({ timeout: 30_000 });

  await page.locator('.topic-row', { hasText: '/camera' }).first().click();
  const select = page.getByLabel('Annotations topic');
  await expect(select).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('image-annotations')).toHaveCount(0); // off until chosen
  await select.selectOption('/annotations');

  const svg = page.getByTestId('image-annotations');
  await expect(svg).toBeVisible();
  await expect(svg.locator('circle')).toHaveCount(2);
  await expect(svg.locator('polyline')).toHaveCount(1);
  await expect(svg.locator('text')).toHaveText('pedestrian');
  await expect(page.getByText('4 annotations')).toBeVisible();
  // Drawn in image pixels: the red circle's radius is half its 12 px diameter.
  await expect(svg.locator('circle').first()).toHaveAttribute('r', '6');

  // At the end the annotation is half a second off its frame, so it is hidden rather than painted on the wrong picture.
  await page.keyboard.press('End');
  await expect(page.getByText(/annotations hidden: 500 ms off/)).toBeVisible();
  await expect(svg).toHaveCount(0);

  // 3D: open the scene update.
  await page.keyboard.press('Home');
  const srow = page.locator('.topic-row', { hasText: '/scene' }).first();
  await srow.hover();
  await srow.getByTitle('Open 3D scene').click();
  await expect(page.getByText('4 markers')).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('End');
  await expect(page.getByText('2 markers')).toBeVisible({ timeout: 30_000 }); // replaced, not accumulated
  expect(errors).toEqual([]);
});
