/**
 * VP9 and AV1 CompressedVideo topics decode in the browser. Playwright's
 * Chromium ships both decoders (it has no H264 one), so this is a real
 * WebCodecs decode of streams from libvpx, libaom and SVT-AV1: the codec
 * string must be accepted and the frames must come out at the stream's size.
 */

import { test, expect } from '@playwright/test';
import { readIvf } from '../fixtures/video/ivf';
import { writeJsonMcap } from '../fixtures/jsonMcap';

for (const [name, format] of [['vp9_libvpx', 'vp9'], ['vp9_10bit', 'vp9'], ['av1_libaom', 'av1'], ['av1_svt', 'av1']] as const) {
  test(`${name} plays in the image viewer`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const { frames } = readIvf(name);
    const bytes = await writeJsonMcap([{
      topic: '/cam/video',
      schemaName: 'foxglove.CompressedVideo',
      messages: frames.map((f, i) => ({
        logTime: 1_000_000_000n + BigInt(i) * 100_000_000n,
        value: { timestamp: { sec: 1, nsec: i * 100_000_000 }, frame_id: 'cam', data: Buffer.from(f).toString('base64'), format },
      })),
    }]);

    await page.goto('/');
    await page.locator('input[type="file"]').first().setInputFiles({ name: `${name}.mcap`, mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
    await page.getByRole('button', { name: 'Open image viewer' }).first().click({ timeout: 60_000 });
    // The footer shows the decoded frame's size and codec once WebCodecs has produced a frame.
    await expect(page.getByText('96×64')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(format, { exact: true })).toBeVisible();

    // Jump to the end: decoding restarts at the last keyframe and runs through its
    // delta frames. The test pattern moves, so the picture must change.
    const canvas = page.locator('canvas').first();
    const pixels = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
    const first = await pixels();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('End');
    await expect.poll(pixels, { timeout: 30_000 }).not.toBe(first);
    await expect(page.getByText('Failed to load data')).toHaveCount(0);
    await expect(page.getByText('96×64')).toBeVisible();
    expect(errors).toEqual([]);
  });
}
