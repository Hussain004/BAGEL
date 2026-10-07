/**
 * Roll / pitch / yaw from an IMU quaternion, exercised in a real browser.
 *
 * The expression maths has unit tests (round-trips, gimbal lock). What is only
 * provable here is the wiring: the button appears for a quaternion, adds three
 * series, and the plotted yaw really tracks the data.
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

const zeros = (n: number) => new Array(n).fill(0);

/** An IMU slowly yawing from 0 to 90 degrees about Z over 10 samples. */
async function imuBag(): Promise<Buffer> {
  const messages = Array.from({ length: 10 }, (_, i) => {
    const yaw = (i / 9) * (Math.PI / 2);
    return {
      logTime: 1_000_000_000n + BigInt(i) * 100_000_000n,
      value: {
        header: { stamp: { sec: 1, nanosec: i * 100_000_000 }, frame_id: 'imu' },
        orientation: { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) },
        orientation_covariance: zeros(9),
        angular_velocity: { x: 0, y: 0, z: 0 },
        angular_velocity_covariance: zeros(9),
        linear_acceleration: { x: 0, y: 0, z: 9.81 },
        linear_acceleration_covariance: zeros(9),
      },
    };
  });
  return Buffer.from(await writeSyntheticMcap([{ topic: '/imu', type: 'sensor_msgs/msg/Imu', messages }]));
}

test('roll/pitch/yaw button adds three series and yaw tracks the quaternion', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/');
  await page
    .locator('[data-testid="file-input"]')
    .setInputFiles({ name: 'imu.mcap', mimeType: 'application/octet-stream', buffer: await imuBag() });

  const row = page.locator('.topic-row', { hasText: '/imu' }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.hover();
  await row.getByRole('button', { name: /Open time-series plot/ }).click();

  const button = page.getByRole('button', { name: /roll\/pitch\/yaw/ });
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click();
  // Offered once: after adding, the button goes away.
  await expect(button).toHaveCount(0);

  for (const label of ['roll', 'pitch', 'yaw']) {
    await expect(page.locator('table.sr-only tr', { hasText: new RegExp(`^${label}`) })).toBeVisible();
  }
  const yaw = await page.locator('table.sr-only tr', { hasText: /^yaw/ }).locator('td').allInnerTexts();
  // columns: label, min, max, last
  expect(Number(yaw[1])).toBeCloseTo(0, 3);
  expect(Number(yaw[2])).toBeCloseTo(90, 3);
  const roll = await page.locator('table.sr-only tr', { hasText: /^roll/ }).locator('td').allInnerTexts();
  expect(Number(roll[2])).toBeCloseTo(0, 3);

  expect(problems).toEqual([]);
});
