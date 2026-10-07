/**
 * Detection boxes on the image viewer, exercised in a real browser.
 *
 * The parser and freshness rules have unit tests. What is only provable here
 * is the wiring: the picker lists Detection2DArray topics, matched boxes draw
 * with their class and score, and a detection whose header stamp does not
 * match the image is hidden with a visible reason instead of drawn on the
 * wrong frame.
 */

import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { writeSyntheticMcap, type RosmsgDef } from '../fixtures/synth';

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

/** vision_msgs, Humble layout. Not in the bundled registry, so described here. */
const VISION: RosmsgDef[] = [
  {
    name: 'vision_msgs/Detection2DArray',
    definitions: [
      { type: 'std_msgs/Header', name: 'header', isComplex: true },
      { type: 'vision_msgs/Detection2D', name: 'detections', isArray: true, isComplex: true },
    ],
  },
  {
    name: 'vision_msgs/Detection2D',
    definitions: [
      { type: 'std_msgs/Header', name: 'header', isComplex: true },
      { type: 'vision_msgs/ObjectHypothesisWithPose', name: 'results', isArray: true, isComplex: true },
      { type: 'vision_msgs/BoundingBox2D', name: 'bbox', isComplex: true },
      { type: 'string', name: 'id' },
    ],
  },
  {
    name: 'vision_msgs/ObjectHypothesisWithPose',
    definitions: [
      { type: 'vision_msgs/ObjectHypothesis', name: 'hypothesis', isComplex: true },
      { type: 'geometry_msgs/PoseWithCovariance', name: 'pose', isComplex: true },
    ],
  },
  {
    name: 'vision_msgs/ObjectHypothesis',
    definitions: [
      { type: 'string', name: 'class_id' },
      { type: 'float64', name: 'score' },
    ],
  },
  {
    name: 'vision_msgs/BoundingBox2D',
    definitions: [
      { type: 'vision_msgs/Pose2D', name: 'center', isComplex: true },
      { type: 'float64', name: 'size_x' },
      { type: 'float64', name: 'size_y' },
    ],
  },
  {
    name: 'vision_msgs/Pose2D',
    definitions: [
      { type: 'vision_msgs/Point2D', name: 'position', isComplex: true },
      { type: 'float64', name: 'theta' },
    ],
  },
  {
    name: 'vision_msgs/Point2D',
    definitions: [
      { type: 'float64', name: 'x' },
      { type: 'float64', name: 'y' },
    ],
  },
];

const W = 160;
const H = 120;
const zeroPose = {
  pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
  covariance: new Array(36).fill(0),
};

function box(x: number, y: number, w: number, h: number, cls: string, score: number) {
  return {
    header: { stamp: { sec: 1, nanosec: 0 }, frame_id: 'cam' },
    results: [{ hypothesis: { class_id: cls, score }, pose: zeroPose }],
    bbox: { center: { position: { x, y }, theta: 0 }, size_x: w, size_y: h },
    id: '',
  };
}

/** One image at t=1s; one detection array whose header stamp is `detNanosec` after it. */
async function bag(detNanosec: number): Promise<Buffer> {
  const stamp = { sec: 1, nanosec: 0 };
  return Buffer.from(
    await writeSyntheticMcap([
      {
        topic: '/image',
        type: 'sensor_msgs/msg/Image',
        messages: [
          {
            logTime: 1_000_000_000n,
            value: {
              header: { stamp, frame_id: 'cam' },
              height: H,
              width: W,
              encoding: 'rgb8',
              is_bigendian: 0,
              step: W * 3,
              data: new Uint8Array(W * H * 3).fill(90),
            },
          },
        ],
      },
      {
        topic: '/dets',
        type: 'vision_msgs/msg/Detection2DArray',
        extraDefinitions: VISION,
        messages: [
          {
            logTime: 1_000_001_000n,
            value: {
              header: { stamp: { sec: 1, nanosec: detNanosec }, frame_id: 'cam' },
              detections: [box(80, 60, 40, 60, 'person', 0.91), box(30, 30, 20, 20, 'car', 0.75)],
            },
          },
        ],
      },
    ]),
  );
}

async function openImage(page: Page, buffer: Buffer) {
  await page.goto('/');
  await page
    .locator('[data-testid="file-input"]')
    .setInputFiles({ name: 'det.mcap', mimeType: 'application/octet-stream', buffer });
  const row = page.locator('.topic-row', { hasText: '/image' }).first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.hover();
  await row.getByRole('button', { name: /Open image viewer/ }).click();
  await expect(page.getByLabel('Detection boxes topic')).toBeVisible({ timeout: 30_000 });
}

test('matched detections draw with class and score, and can be switched off', async ({ page }) => {
  const problems = watchForErrors(page);
  await openImage(page, await bag(50_000_000)); // 50 ms off: within tolerance
  await page.getByLabel('Detection boxes topic').selectOption('/dets');

  const svg = page.getByTestId('detection-boxes');
  await expect(svg).toBeVisible({ timeout: 20_000 });
  await expect(svg.locator('polygon')).toHaveCount(2);
  await expect(svg.getByText('person 91%')).toBeVisible();
  await expect(svg.getByText('car 75%')).toBeVisible();
  await expect(page.getByText('2 boxes')).toBeVisible();

  // First box: centred (80,60), 40x60 -> top-left corner (60,30).
  const points = await svg.locator('polygon').first().getAttribute('points');
  expect(points?.split(' ')[0]).toBe('60,30');

  await page.getByLabel('Detection boxes topic').selectOption('');
  await expect(page.getByTestId('detection-boxes')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('a detection from a different frame is hidden, with the reason shown', async ({ page }) => {
  const problems = watchForErrors(page);
  await openImage(page, await bag(600_000_000)); // 600 ms off: outside tolerance
  await page.getByLabel('Detection boxes topic').selectOption('/dets');
  await expect(page.getByText(/boxes hidden: 600 ms off/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('detection-boxes')).toHaveCount(0);
  expect(problems).toEqual([]);
});
