/**
 * Two teaching hints, on bags built to trigger them: a 3D view over a bag with
 * no /tf says so, and an image panel offers to pair a CameraInfo when the bag
 * has some but none matches the camera by name.
 */

import { test, expect } from '@playwright/test';
import { writeSyntheticMcap } from '../fixtures/synth';

const header = (frame: string) => ({ stamp: { sec: 1, nanosec: 0 }, frame_id: frame });
const T = (s: number) => BigInt(s) * 1_000_000_000n;
const file = (name: string, buffer: Buffer) => ({ name, mimeType: 'application/octet-stream', buffer });

test('a 3D view over a bag with no /tf says it is drawn in its own frame', async ({ page }) => {
  const f32 = new Float32Array([1, 2, 3, -1, 0, 2, 0, 1, 1]);
  const cloud = {
    header: header('velodyne'),
    height: 1,
    width: 3,
    fields: ['x', 'y', 'z'].map((name, i) => ({ name, offset: i * 4, datatype: 7, count: 1 })),
    is_bigendian: false,
    point_step: 12,
    row_step: 36,
    data: new Uint8Array(f32.buffer),
    is_dense: true,
  };
  const bytes = await writeSyntheticMcap([{ topic: '/points', type: 'sensor_msgs/msg/PointCloud2', messages: [1, 2, 3].map((s) => ({ logTime: T(s), value: cloud })) }]);
  await page.goto('/');
  await page.locator('[data-testid="file-input"]').setInputFiles(file('notf.mcap', Buffer.from(bytes)));
  await page.locator('.topic-row', { hasText: '/points' }).first().click();
  await expect(page.getByTestId('no-tf-note')).toHaveText('no /tf in this bag: drawn in its own frame', { timeout: 60_000 });
});

test('an image panel offers to pair a CameraInfo when none matches by name', async ({ page }) => {
  const image = { header: header('cam'), height: 2, width: 2, encoding: 'rgb8', is_bigendian: 0, step: 6, data: new Uint8Array(12).fill(100) };
  const info = (frame: string) => ({
    header: header(frame),
    height: 2,
    width: 2,
    distortion_model: 'plumb_bob',
    d: [0, 0, 0, 0, 0],
    k: [1, 0, 1, 0, 1, 1, 0, 0, 1],
    r: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    p: [1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0],
    binning_x: 0,
    binning_y: 0,
    roi: { x_offset: 0, y_offset: 0, height: 0, width: 0, do_rectify: false },
  });
  const mk = (topic: string, type: string, value: object) => ({ topic, type, messages: [1, 2, 3].map((s) => ({ logTime: T(s), value })) });
  const bytes = await writeSyntheticMcap([
    mk('/cam_front/image', 'sensor_msgs/msg/Image', image),
    mk('/calib/front_info', 'sensor_msgs/msg/CameraInfo', info('front')),
    mk('/calib/rear_info', 'sensor_msgs/msg/CameraInfo', info('rear')),
  ]);
  await page.goto('/');
  await page.locator('[data-testid="file-input"]').setInputFiles(file('calib.mcap', Buffer.from(bytes)));
  await page.locator('.topic-row', { hasText: '/cam_front/image' }).first().click();

  const offer = page.getByTestId('camera-info-offer');
  await expect(offer).toContainText('This bag has 2 CameraInfo topics, but none matches this camera by name.', { timeout: 60_000 });
  await offer.getByRole('button', { name: 'Choose one' }).click();
  // The picker takes its place, listing both.
  await expect(offer).toHaveCount(0);
  const select = page.locator('select', { has: page.locator('option', { hasText: '/calib/front_info' }) });
  await expect(select).toBeVisible();
  await select.selectOption('/calib/front_info');
  // With a pair chosen, the overlay shows its focal length (k has fx = 1, fy = 1).
  await expect(page.getByText(/f = \(1\.0, 1\.0\) px/)).toBeVisible();
});

test('a bag whose CameraInfo does match shows no offer', async ({ page }) => {
  const image = { header: header('cam'), height: 2, width: 2, encoding: 'rgb8', is_bigendian: 0, step: 6, data: new Uint8Array(12).fill(100) };
  const info = {
    header: header('cam'), height: 2, width: 2, distortion_model: 'plumb_bob', d: [0, 0, 0, 0, 0], k: [1, 0, 1, 0, 1, 1, 0, 0, 1], r: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    p: [1, 0, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0], binning_x: 0, binning_y: 0, roi: { x_offset: 0, y_offset: 0, height: 0, width: 0, do_rectify: false },
  };
  const mk = (topic: string, type: string, value: object) => ({ topic, type, messages: [1, 2, 3].map((s) => ({ logTime: T(s), value })) });
  const bytes = await writeSyntheticMcap([mk('/cam/image_raw', 'sensor_msgs/msg/Image', image), mk('/cam/camera_info', 'sensor_msgs/msg/CameraInfo', info), mk('/other/camera_info', 'sensor_msgs/msg/CameraInfo', info)]);
  await page.goto('/');
  await page.locator('[data-testid="file-input"]').setInputFiles(file('paired.mcap', Buffer.from(bytes)));
  await page.locator('.topic-row', { hasText: '/cam/image_raw' }).first().click();
  await expect(page.locator('header[tabindex="0"] span.badge.badge-slate', { hasText: /^Image$/ })).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('camera-info-offer')).toHaveCount(0);
});
