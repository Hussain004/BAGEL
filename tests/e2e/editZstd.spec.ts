/**
 * Editing a bag in the built app writes zstd chunks: the WASM encoder loads in
 * the parser worker (its own chunk), and the download re-opens with the
 * official chunk records naming zstd. The encoder's correctness is unit-tested
 * against libzstd; this proves the browser wiring.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { McapIndexedReader } from '@mcap/core';
import { decompress } from 'fzstd';

test('Edit & download writes a zstd-compressed MCAP', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('button:has-text("EXPLORE SAMPLE DATA")').click();
  await expect(page.getByRole('button', { name: 'Edit bag - trim and re-export' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Edit bag - trim and re-export' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Edit & download' }).click();
  const path = await (await download).path();
  const bytes = new Uint8Array(readFileSync(path!));
  const reader = await McapIndexedReader.Initialize({
    readable: { size: async () => BigInt(bytes.length), read: async (o, n) => bytes.subarray(Number(o), Number(o + n)) },
    decompressHandlers: { zstd: (b: Uint8Array) => decompress(b) },
  });
  expect(reader.chunkIndexes.length).toBeGreaterThan(1);
  expect(reader.chunkIndexes.some((c) => c.compression === 'zstd')).toBe(true);
  let n = 0;
  for await (const message of reader.readMessages()) if (message.data.length >= 0) n++;
  expect(n).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});
