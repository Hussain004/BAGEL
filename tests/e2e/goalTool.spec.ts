/**
 * The 2D goal tool against a fake bridge that advertises a TF tree and a robot
 * pose: place a goal in the top-down view, confirm it, and check the PoseStamped
 * that reaches the bridge.
 */

import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';

const T = { sec: 100, nanosec: 0 };
const TF = { transforms: [{ header: { stamp: T, frame_id: 'map' }, child_frame_id: 'base_link', transform: { translation: { x: 1, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } } }] };
const POSE = { header: { stamp: T, frame_id: 'base_link' }, pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } };
const CHANNELS = [
  { id: 1, topic: '/tf', encoding: 'json', schemaName: 'tf2_msgs/msg/TFMessage', schema: '', schemaEncoding: 'jsonschema' },
  { id: 2, topic: '/robot_pose', encoding: 'json', schemaName: 'geometry_msgs/msg/PoseStamped', schema: '', schemaEncoding: 'jsonschema' },
];
const BODIES: Record<number, object> = { 1: TF, 2: POSE };

interface Bridge {
  ws: WebSocketRoute | null;
  texts: Array<Record<string, unknown>>;
  /** Client publishes as [channelId, decoded JSON]. */
  published: Array<[number, any]>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

async function fakeBridge(page: Page): Promise<Bridge> {
  const bridge: Bridge = { ws: null, texts: [], published: [] };
  await page.routeWebSocket('ws://robot.test:8765', (ws) => {
    bridge.ws = ws;
    const subs = new Map<number, number>();
    const push = () => {
      for (const [subId, channelId] of subs) {
        const body = Buffer.from(JSON.stringify(BODIES[channelId]));
        const head = Buffer.alloc(13);
        head[0] = 1;
        head.writeUInt32LE(subId, 1);
        head.writeBigUInt64LE(BigInt(Date.now()) * 1_000_000n, 5);
        ws.send(Buffer.concat([head, body]));
      }
    };
    ws.onMessage((m) => {
      if (typeof m === 'string') {
        const t = JSON.parse(m) as Record<string, unknown>;
        bridge.texts.push(t);
        if (t.op === 'subscribe') {
          for (const s of t.subscriptions as Array<{ id: number; channelId: number }>) subs.set(s.id, s.channelId);
          push();
          setInterval(push, 200);
        }
      } else if (m[0] === 1) {
        bridge.published.push([m.readUInt32LE(1), JSON.parse(m.subarray(5).toString())]);
      }
    });
    ws.send(JSON.stringify({ op: 'serverInfo', name: 'fake', capabilities: ['clientPublish'], supportedEncodings: ['json'] }));
    ws.send(JSON.stringify({ op: 'advertise', channels: CHANNELS }));
  });
  return bridge;
}

async function open3dTopDown(page: Page) {
  await page.goto('/');
  await page.getByRole('tab', { name: /LIVE ROBOT/ }).click();
  await page.getByLabel('Live robot WebSocket URL').fill('ws://robot.test:8765');
  await page.getByRole('button', { name: 'CONNECT' }).click();
  const row = page.locator('.topic-row', { hasText: '/robot_pose' }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.hover();
  await row.getByTitle('Open 3D scene').click();
  await expect(page.getByText(/base_link\s*→\s*map/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: '2D', exact: true }).click();
}

async function arm(page: Page) {
  await page.getByRole('button', { name: 'Robot control' }).click();
  await page.getByRole('button', { name: 'Enable control' }).click();
  await expect(page.getByTestId('control-armed')).toBeVisible();
}

test('place a goal, see it described, confirm it, and the bridge gets a PoseStamped in the fixed frame', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const bridge = await fakeBridge(page);
  await open3dTopDown(page);
  await arm(page);

  await page.getByRole('button', { name: 'Goal', exact: true }).click();
  const bar = page.getByTestId('goal-bar');
  await expect(bar).toContainText('Drag on the floor');

  const canvas = page.locator('canvas').first();
  const box = (await canvas.boundingBox())!;
  const from = { x: box.x + box.width * 0.4, y: box.y + box.height * 0.6 };

  // A plain click has no heading: nothing is placed.
  await page.mouse.click(from.x, from.y);
  await expect(page.getByTestId('goal-message')).toContainText('Drag from where');
  await expect(page.getByTestId('goal-text')).toHaveCount(0);

  // Drag to the right: a goal facing +x (0 degrees) in the top-down view.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 80, from.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('goal-text')).toContainText('facing 0 deg');

  // Placed, not sent.
  expect(bridge.published).toEqual([]);
  await bar.getByRole('button', { name: 'Send goal' }).click();
  await expect(page.getByTestId('goal-message')).toContainText('Sent to /goal_pose in frame map.');
  await expect.poll(() => bridge.published.length).toBe(1);

  const [channel, goal] = bridge.published[0]!;
  expect(channel).toBe(2);
  expect(goal.header.frame_id).toBe('map');
  expect(goal.pose.position.z).toBe(0);
  expect(goal.pose.orientation.z).toBeCloseTo(0, 6);
  expect(goal.pose.orientation.w).toBeCloseTo(1, 6);
  expect(Number.isFinite(goal.pose.position.x) && Number.isFinite(goal.pose.position.y)).toBe(true);
  const adv = bridge.texts.filter((t) => t.op === 'advertise');
  expect(adv.map((a) => (a.channels as Array<{ topic: string }>)[0]!.topic)).toEqual(['/cmd_vel', '/goal_pose']);

  // The tool leaves the camera alone while it is on, and Esc turns it off.
  await page.keyboard.press('Escape');
  await expect(bar).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('dragging up faces +y; Cancel discards without sending', async ({ page }) => {
  const bridge = await fakeBridge(page);
  await open3dTopDown(page);
  await arm(page);
  await page.getByRole('button', { name: 'Goal', exact: true }).click();
  const box = (await page.locator('canvas').first().boundingBox())!;
  const from = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.7 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 80, { steps: 6 }); // up the screen
  await page.mouse.up();
  await expect(page.getByTestId('goal-text')).toContainText('facing 90 deg');
  await page.getByTestId('goal-bar').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('goal-text')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(bridge.published).toEqual([]);
});

test('without Robot control enabled, the tool says so and cannot send', async ({ page }) => {
  const bridge = await fakeBridge(page);
  await open3dTopDown(page);
  await page.getByRole('button', { name: 'Goal', exact: true }).click();
  await expect(page.getByTestId('goal-bar')).toContainText('Turn on Robot control');
  const box = (await page.locator('canvas').first().boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 180, box.y + 100, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Send goal' })).toHaveCount(0);
  expect(bridge.published).toEqual([]);
});

test('the Goal button only appears in the top-down view of a live connection', async ({ page }) => {
  await fakeBridge(page);
  await open3dTopDown(page);
  await expect(page.getByRole('button', { name: 'Goal', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '3D', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Goal', exact: true })).toHaveCount(0);
});
