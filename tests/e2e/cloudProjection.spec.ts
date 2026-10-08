/**
 * LiDAR points projected onto the camera image, in a real browser.
 *
 * The projection geometry has exact unit tests. What is only provable here is
 * the wiring: the picker appears when a cloud topic and a CameraInfo exist, the
 * cloud is moved through the TF tree into the camera frame, dots land on the
 * pixels the maths says they should, and a missing TF path is reported rather
 * than drawn wrong.
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

const W = 160;
const H = 120;
const NS = 1_000_000_000n;
const stamp = { sec: 1, nanosec: 0 };

function floats(values: number[]): Uint8Array {
  const f = new Float32Array(values);
  return new Uint8Array(f.buffer);
}

/** Points in the 'lidar' frame, then a static transform placing the lidar 0.5 m along +x of the camera. */
async function bag(withTf: boolean): Promise<Buffer> {
  const topics = [
    {
      topic: '/image',
      type: 'sensor_msgs/msg/Image',
      messages: [
        {
          logTime: NS,
          value: {
            header: { stamp, frame_id: 'cam' },
            height: H,
            width: W,
            encoding: 'rgb8',
            is_bigendian: 0,
            step: W * 3,
            data: new Uint8Array(W * H * 3).fill(60),
          },
        },
      ],
    },
    {
      topic: '/camera_info',
      type: 'sensor_msgs/msg/CameraInfo',
      messages: [
        {
          logTime: NS,
          value: {
            header: { stamp, frame_id: 'cam' },
            height: H,
            width: W,
            distortion_model: 'plumb_bob',
            d: [0, 0, 0, 0, 0],
            k: [100, 0, 80, 0, 100, 60, 0, 0, 1],
            r: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            p: [100, 0, 80, 0, 0, 100, 60, 0, 0, 0, 1, 0],
            binning_x: 0,
            binning_y: 0,
            roi: { x_offset: 0, y_offset: 0, height: 0, width: 0, do_rectify: false },
          },
        },
      ],
    },
    {
      topic: '/lidar',
      type: 'sensor_msgs/msg/PointCloud2',
      messages: [
        {
          logTime: NS,
          value: {
            header: { stamp, frame_id: 'lidar' },
            height: 1,
            width: 3,
            fields: [
              { name: 'x', offset: 0, datatype: 7, count: 1 },
              { name: 'y', offset: 4, datatype: 7, count: 1 },
              { name: 'z', offset: 8, datatype: 7, count: 1 },
            ],
            is_bigendian: false,
            point_step: 12,
            row_step: 36,
            // (0,0,5) and (-0.5,0.2,2) are in front; (0,0,-4) is behind the camera.
            data: floats([0, 0, 5, -0.5, 0.2, 2, 0, 0, -4]),
            is_dense: true,
          },
        },
      ],
    },
  ];
  if (withTf) {
    topics.push({
      topic: '/tf_static',
      type: 'tf2_msgs/msg/TFMessage',
      messages: [
        {
          logTime: NS,
          value: {
            transforms: [
              {
                header: { stamp, frame_id: 'cam' },
                child_frame_id: 'lidar',
                transform: { translation: { x: 0.5, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
              },
            ],
          },
        },
      ],
    } as never);
  }
  return Buffer.from(await writeSyntheticMcap(topics as never));
}

async function openImage(page: Page, buffer: Buffer) {
  await page.goto('/');
  await page
    .locator('[data-testid="file-input"]')
    .setInputFiles({ name: 'proj.mcap', mimeType: 'application/octet-stream', buffer });
  const row = page.locator('.topic-row', { hasText: '/image' }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.hover();
  await row.getByRole('button', { name: /Open image viewer/ }).click();
  await expect(page.getByLabel('Project point cloud topic')).toBeVisible({ timeout: 30_000 });
}

/** Alpha of the overlay at an image pixel, taking the max over a 3x3 neighbourhood. */
async function alphaAt(page: Page, x: number, y: number): Promise<number> {
  return page.getByTestId('cloud-projection').evaluate((el, [px, py]) => {
    const c = el as HTMLCanvasElement;
    const data = c.getContext('2d')!.getImageData(px! - 1, py! - 1, 3, 3).data;
    let max = 0;
    for (let i = 3; i < data.length; i += 4) max = Math.max(max, data[i]!);
    return max;
  }, [x, y]);
}

test('points are carried through TF and land on the computed pixels', async ({ page }) => {
  const problems = watchForErrors(page);
  await openImage(page, await bag(true));
  await page.getByLabel('Project point cloud topic').selectOption('/lidar');

  await expect(page.getByTestId('cloud-projection-status')).toContainText('2 of 3 points', { timeout: 30_000 });
  await expect(page.getByTestId('cloud-projection-status')).toContainText('lidar → cam');

  // lidar x is shifted +0.5 into the camera frame: (0,0,5) -> u = 100 * 0.5/5 + 80 = 90, v = 60.
  expect(await alphaAt(page, 90, 60)).toBeGreaterThan(0);
  // (-0.5, 0.2, 2) -> (0, 0.2, 2): u = 80, v = 100 * 0.2/2 + 60 = 70.
  expect(await alphaAt(page, 80, 70)).toBeGreaterThan(0);
  // Without the translation the first point would have been at u = 80; nothing is drawn there.
  expect(await alphaAt(page, 80, 60)).toBe(0);

  await page.getByLabel('Project point cloud topic').selectOption('');
  await expect(page.getByTestId('cloud-projection')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('with no TF between the frames it says so instead of drawing the points', async ({ page }) => {
  await openImage(page, await bag(false));
  await page.getByLabel('Project point cloud topic').selectOption('/lidar');
  await expect(page.getByTestId('cloud-projection-status')).toContainText('no TF path from lidar to cam', { timeout: 30_000 });
  expect(await alphaAt(page, 90, 60)).toBe(0);
});
