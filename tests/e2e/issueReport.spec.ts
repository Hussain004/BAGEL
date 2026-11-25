/**
 * The Share modal's issue report downloads one zip with a trimmed clip, the
 * link and a Health summary. The pieces are unit-tested; this proves the
 * worker edit, the health scan and the download wire up, and that the clip
 * is a real MCAP holding exactly the window.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { McapIndexedReader } from '@mcap/core';
import { decompress as zstdDecompress } from 'fzstd';
import { writeSyntheticMcap } from '../fixtures/synth';

/** 10 Hz String topic over 60 s with a 3 s hole after t=40 s. */
async function bag(): Promise<Buffer> {
  const messages: Array<{ logTime: bigint; value: Record<string, unknown> }> = [];
  for (let i = 0; i <= 600; i++) {
    const t = i / 10;
    if (t > 40 && t < 43) continue;
    messages.push({ logTime: 1_000_000_000n + BigInt(Math.round(t * 1e9)), value: { data: `m${i}` } });
  }
  return Buffer.from(await writeSyntheticMcap([{ topic: '/chatter', type: 'std_msgs/msg/String', messages }]));
}

test('the issue report zip holds a clip of the window, the link and health', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'run.mcap', mimeType: 'application/octet-stream', buffer: await bag() });
  await page.getByRole('button', { name: 'Share this view' }).click({ timeout: 60_000 });

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download issue report' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('run__issue-report.zip');
  await expect(page.getByRole('status')).toContainText('Saved');

  const files = unzipSync(new Uint8Array(readFileSync(await file.path())));
  expect(Object.keys(files).sort()).toEqual(['README.md', 'clip.mcap', 'health.md', 'link.txt']);
  expect(strFromU8(files['link.txt']!)).toContain('#');
  expect(strFromU8(files['health.md']!)).toMatch(/`\/chatter` \| 572 \| .* \| 1 \|/);

  // Playhead at the start: the clip is the first 10 s, t = 0.0 .. 10.0 inclusive.
  const clip = files['clip.mcap']!;
  const reader = await McapIndexedReader.Initialize({
    readable: { size: async () => BigInt(clip.length), read: async (o: bigint, n: bigint) => clip.subarray(Number(o), Number(o + n)) },
    // Edited bags are written with zstd chunks.
    decompressHandlers: { zstd: (data: Uint8Array) => zstdDecompress(data) },
  });
  let count = 0;
  let last = 0n;
  for await (const m of reader.readMessages()) {
    count++;
    last = m.logTime;
  }
  expect(count).toBe(101);
  expect(last).toBe(11_000_000_000n);
  expect(strFromU8(files['README.md']!)).toContain('101 messages from 0.000 s to 10.000 s');
  expect(errors).toEqual([]);
});
