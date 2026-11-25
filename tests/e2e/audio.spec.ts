/**
 * An audio_common_msgs topic opens in the Audio panel: the format comes from
 * the AudioInfo topic, the waveform is drawn, clicking it seeks, and playing
 * with sound on runs Web Audio without errors. Decoding is unit-tested.
 */

import { test, expect } from '@playwright/test';
import { writeSyntheticMcap, type RosmsgDef } from '../fixtures/synth';

const DATA: RosmsgDef = { name: 'audio_common_msgs/AudioData', definitions: [{ name: 'data', type: 'uint8', isArray: true }] };
const STAMPED: RosmsgDef = {
  name: 'audio_common_msgs/AudioDataStamped',
  definitions: [{ name: 'header', type: 'std_msgs/Header', isComplex: true }, { name: 'audio', type: 'audio_common_msgs/AudioData', isComplex: true }],
};
const INFO: RosmsgDef = {
  name: 'audio_common_msgs/AudioInfo',
  definitions: [
    { name: 'channels', type: 'uint8' }, { name: 'sample_rate', type: 'uint32' }, { name: 'sample_format', type: 'string' },
    { name: 'bitrate', type: 'uint32' }, { name: 'coding_format', type: 'string' },
  ],
};

async function bag(): Promise<Buffer> {
  const rate = 8000, chunk = 400; // 50 ms chunks for 4 s, silent for the second half
  const messages = Array.from({ length: 80 }, (_, i) => {
    const b = Buffer.alloc(chunk * 2);
    for (let k = 0; k < chunk; k++) {
      const n = i * chunk + k;
      b.writeInt16LE(i < 40 ? Math.round(16000 * Math.sin((2 * Math.PI * 440 * n) / rate)) : 0, k * 2);
    }
    return { logTime: 1_000_000_000n + BigInt(i) * 50_000_000n, value: { header: { stamp: { sec: 1, nanosec: 0 }, frame_id: 'mic' }, audio: { data: new Uint8Array(b) } } };
  });
  return Buffer.from(await writeSyntheticMcap([
    { topic: '/audio/audio_info', type: 'audio_common_msgs/msg/AudioInfo', extraDefinitions: [INFO], messages: [{ logTime: 1_000_000_000n, value: { channels: 1, sample_rate: rate, sample_format: 'S16LE', bitrate: 0, coding_format: 'wave' } }] },
    { topic: '/audio/audio', type: 'audio_common_msgs/msg/AudioDataStamped', extraDefinitions: [STAMPED, DATA], messages },
  ]));
}

test('an audio topic shows its waveform and plays along with the bag', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'audio.mcap', mimeType: 'application/octet-stream', buffer: await bag() });
  await page.getByRole('button', { name: 'Open audio waveform and playback' }).first().click({ timeout: 60_000 });

  await expect(page.getByLabel('Audio format')).toHaveText('8,000 Hz, mono, 4.0 s', { timeout: 30_000 });
  // Sound in the first half only: the waveform's left half has ink, the right half none.
  const ink = await page.locator('canvas').first().evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let left = 0, right = 0;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i]! === 0) continue;
      const x = ((i - 3) / 4) % c.width;
      if (x < c.width * 0.45) left++;
      else if (x > c.width * 0.55) right++;
    }
    return { left, right };
  });
  expect(ink.left).toBeGreaterThan(ink.right * 20);

  const sound = page.getByRole('button', { name: 'Sound off' });
  await sound.click();
  await expect(page.getByRole('button', { name: 'Sound on' })).toHaveAttribute('aria-pressed', 'true');
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  await page.keyboard.press('Space');
  await page.getByLabel('Waveform, click to seek').click({ position: { x: 20, y: 20 } });
  expect(errors).toEqual([]);
});
