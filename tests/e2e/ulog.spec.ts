/**
 * A PX4 flight log opened in a real browser: the topics list, the logged text
 * lands in the Log panel, the GPS track opens as a path, and attitude plots.
 */

import { test, expect } from '@playwright/test';
import {
  ATTITUDE_FORMAT, GPS_FORMAT, addLogged, attitude, concatAll, data, flagBitsFull, format, gps, header, logText, paramF, infoString,
} from '../fixtures/ulog';

function flight(): Buffer {
  const US = 1_000_000;
  const parts = [header(0), flagBitsFull(), infoString('sys_name', 'PX4'), paramF('MC_ROLL_P', 6.5), format(ATTITUDE_FORMAT), format(GPS_FORMAT), addLogged(0, 0, 'vehicle_attitude'), addLogged(0, 1, 'sensor_gps')];
  for (let i = 0; i < 1000; i++) {
    const t = i * 20_000; // 50 Hz for 20 s
    const roll = Math.sin(i / 40) * 0.5;
    parts.push(data(0, attitude(t, [Math.cos(roll / 2), Math.sin(roll / 2), 0, 0], roll)));
    if (i % 10 === 0) parts.push(data(1, gps(t, 47.3977 + Math.sin(i / 100) * 1e-3, 8.5456 + Math.cos(i / 100) * 1e-3, 488)));
    if (i === 100) parts.push(logText(6, t, 'Armed by RC'));
    if (i === 600) parts.push(logText(4, t, 'Low battery warning'));
  }
  parts.push(logText(6, 20 * US - 1, 'Disarmed'));
  return Buffer.from(concatAll(parts));
}

test('a PX4 ULog opens: topics, log panel, GPS path and attitude plot', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|source ?map|GL Driver|tile\./i.test(m.text())) errors.push(m.text());
  });
  await page.goto('/');
  await page.locator('[data-testid="file-input"]').setInputFiles({ name: 'flight.ulg', mimeType: 'application/octet-stream', buffer: flight() });

  await expect(page.getByText('flight.ulg').first()).toBeVisible({ timeout: 60_000 });
  for (const name of ['/vehicle_attitude', '/sensor_gps', '/rosout', '/parameters']) {
    await expect(page.locator('.topic-row', { hasText: name }).first()).toBeVisible();
  }
  // The format badge names it.
  await expect(page.getByText('ULOG', { exact: true }).first()).toBeVisible();

  // Logged text opens in the Log panel.
  await page.locator('.topic-row', { hasText: '/rosout' }).first().click();
  await expect(page.getByText('Low battery warning').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Armed by RC').first()).toBeVisible();

  // The GPS topic opens a panel (NavSatFix is also what the path view reads).
  await page.locator('.topic-row', { hasText: '/sensor_gps' }).first().click();
  await expect(page.locator('header[tabindex="0"]', { hasText: '/sensor_gps' }).first()).toBeVisible({ timeout: 30_000 });

  // Attitude plots (a plot panel gets opened by default for a custom message).
  await page.locator('.topic-row', { hasText: '/vehicle_attitude' }).first().click();
  await expect(page.locator('header[tabindex="0"]', { hasText: '/vehicle_attitude' }).first()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});
