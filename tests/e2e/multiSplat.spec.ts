/**
 * More than one splat file in a panel: add by button and by drop, move a scene,
 * remove it, reject a non-splat file. Rendering is blank under SwiftShader (see
 * smoke.spec.ts), so this asserts what the library reports: counts and scenes.
 */

import { test, expect, type Page } from '@playwright/test';

/** A `.splat` file: 32 bytes per splat (xyz f32, scale f32 x3, rgba u8 x4, rotation u8 x4). */
function splat(n: number, seed: number): Buffer {
  const buf = Buffer.alloc(n * 32);
  for (let i = 0; i < n; i++) {
    const o = i * 32;
    buf.writeFloatLE(((i * 7 + seed) % 40) / 10 - 2, o);
    buf.writeFloatLE(((i * 11 + seed) % 40) / 10 - 2, o + 4);
    buf.writeFloatLE(((i * 13 + seed) % 40) / 10 - 2, o + 8);
    for (let k = 0; k < 3; k++) buf.writeFloatLE(0.05, o + 12 + k * 4);
    buf.set([200, 120, 80, 255, 255, 128, 128, 128], o + 24);
  }
  return buf;
}

async function openRoom(page: Page) {
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'room.splat', mimeType: 'application/octet-stream', buffer: splat(500, 1) });
  await page.getByRole('button', { name: 'Open gaussian splat viewer' }).click();
  await expect(page.getByText('500 splats')).toBeVisible({ timeout: 60_000 });
}

test('add a second splat, move it, then remove it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openRoom(page);
  const scenes = page.getByTestId('splat-scenes');
  await expect(scenes).toContainText('1 scene');

  await page.getByTestId('splat-add-input').setInputFiles({ name: 'kitchen.splat', mimeType: 'application/octet-stream', buffer: splat(300, 5) });
  await expect(page.getByText('800 splats')).toBeVisible({ timeout: 60_000 });
  await expect(scenes).toContainText('2 scenes');
  const list = scenes.getByRole('list', { name: 'Splat scenes' });
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('listitem').nth(1)).toContainText('kitchen.splat');

  // Select the new scene and move it; the fields show what the viewer holds.
  await list.getByRole('button', { name: /^kitchen\.splat \d/ }).click();
  const group = scenes.getByLabel('Active scene position and scale');
  await group.getByLabel('x').fill('3.5');
  await expect(group.getByLabel('x')).toHaveValue('3.5');
  await group.getByLabel('scale').fill('2');
  await expect(group.getByLabel('scale')).toHaveValue('2');
  // Switching away and back keeps the transform: it lives on the scene.
  await list.getByRole('button', { name: /^room\.splat \d/ }).click();
  await expect(group.getByLabel('x')).toHaveValue('0');
  await list.getByRole('button', { name: /^kitchen\.splat \d/ }).click();
  await expect(group.getByLabel('x')).toHaveValue('3.5');

  // The first scene is the bag's own and cannot be removed here.
  await expect(scenes.getByRole('button', { name: /Remove room\.splat/ })).toHaveCount(0);
  await scenes.getByRole('button', { name: 'Remove kitchen.splat' }).click();
  await expect(page.getByText('500 splats')).toBeVisible();
  await expect(scenes).toContainText('1 scene');
  expect(errors).toEqual([]);
});

test('a dropped splat file is added, and a non-splat file is refused', async ({ page }) => {
  await openRoom(page);
  const drop = async (name: string, buffer: Buffer) => {
    const dt = await page.evaluateHandle(
      ({ name, bytes }) => {
        const d = new DataTransfer();
        d.items.add(new File([new Uint8Array(bytes)], name));
        return d;
      },
      { name, bytes: [...buffer] },
    );
    await page.getByTestId('splat-scenes').locator('xpath=ancestor::div[contains(@class,"min-h-[260px]")][1]').dispatchEvent('drop', { dataTransfer: dt });
  };
  await drop('porch.splat', splat(200, 9));
  await expect(page.getByText('700 splats')).toBeVisible({ timeout: 60_000 });

  await drop('notes.txt', Buffer.from('hello'));
  await expect(page.getByRole('alert')).toContainText('notes.txt is not a splat file');
  await expect(page.getByText('700 splats')).toBeVisible();
});
