/**
 * A .spz (Niantic's gzip-compressed splat format) opens in the splat viewer.
 * Rendering is blank under SwiftShader (see smoke.spec.ts), so this asserts the
 * file is accepted, detected, loaded by the library and reported with its count.
 */

import { test, expect } from '@playwright/test';
import { gzipSync } from 'node:zlib';

function spz(n: number): Buffer {
  const raw = Buffer.alloc(16 + n * 19);
  raw.writeUInt32LE(0x5053474e, 0); // 'NGSP'
  raw.writeUInt32LE(2, 4); // version
  raw.writeUInt32LE(n, 8);
  raw[12] = 0; // SH degree
  raw[13] = 12; // fractional bits
  raw[14] = 0; // flags
  // Positions are signed 24-bit fixed point; spread the points so the bounds are real.
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) raw.writeIntLE(((i * (a + 3)) % 4000) - 2000, 16 + (i * 3 + a) * 3, 3);
  }
  const alphaAt = 16 + n * 9;
  raw.fill(200, alphaAt, alphaAt + n);
  raw.fill(128, alphaAt + n); // colours, scales, rotations
  return gzipSync(raw);
}

test('a .spz file opens as a splat scene with its count', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({
    name: 'room.spz',
    mimeType: 'application/octet-stream',
    buffer: spz(500),
  });
  // The topic list already shows the count read from the gzip header.
  await expect(page.getByLabel('/splat, gaussian/GaussianSplat, 500 messages')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Open gaussian splat viewer' }).click();
  await expect(page.getByText('500 splats')).toBeVisible({ timeout: 60_000 });
  expect(errors).toEqual([]);
});
