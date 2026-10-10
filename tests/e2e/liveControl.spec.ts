/**
 * Driving a robot from the browser, against a fake Foxglove bridge. The page
 * connects to ws://robot.test:8765, which Playwright answers: it sends
 * serverInfo and records every frame the page sends back.
 */

import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';

interface Bridge {
  ws: WebSocketRoute | null;
  texts: Array<Record<string, unknown>>;
  /** [channelId, bytes] for each client publish. */
  published: Array<[number, number[]]>;
}

async function fakeBridge(page: Page, info: object): Promise<Bridge> {
  const bridge: Bridge = { ws: null, texts: [], published: [] };
  await page.routeWebSocket('ws://robot.test:8765', (ws) => {
    bridge.ws = ws;
    ws.onMessage((m) => {
      if (typeof m === 'string') bridge.texts.push(JSON.parse(m) as Record<string, unknown>);
      else {
        const b = [...m];
        if (b[0] === 1) bridge.published.push([b[1]! | (b[2]! << 8) | (b[3]! << 16) | (b[4]! << 24), b.slice(5)]);
      }
    });
    ws.send(JSON.stringify({ op: 'serverInfo', name: 'fake bridge', capabilities: ['clientPublish'], supportedEncodings: ['json'], ...info }));
  });
  return bridge;
}

async function connect(page: Page) {
  await page.goto('/');
  await page.getByRole('tab', { name: /LIVE ROBOT/ }).click();
  await page.getByLabel('Live robot WebSocket URL').fill('ws://robot.test:8765');
  await page.getByRole('button', { name: 'CONNECT' }).click();
  await page.getByRole('button', { name: 'Robot control' }).click();
}

const twistOf = (bytes: number[]) => JSON.parse(String.fromCharCode(...bytes)) as { linear: { x: number }; angular: { z: number } };

test('control starts off, arms only on request, drives, and stops on release', async ({ page }) => {
  const bridge = await fakeBridge(page, {});
  await connect(page);
  const card = page.getByTestId('control-card');
  await expect(card).toBeVisible({ timeout: 30_000 });

  // Nothing is sent just for opening the card.
  await expect(card.getByRole('button', { name: 'Enable control' })).toBeVisible();
  expect(bridge.texts.filter((t) => t.op === 'advertise')).toEqual([]);
  expect(bridge.published).toEqual([]);

  await card.getByLabel('Top speed').fill('0.5');
  await card.getByRole('button', { name: 'Enable control' }).click();
  await expect(page.getByTestId('control-armed')).toContainText('CONTROL ON: sending to /cmd_vel');
  await expect.poll(() => bridge.texts.some((t) => t.op === 'advertise')).toBe(true);
  expect(bridge.texts.find((t) => t.op === 'advertise')).toMatchObject({ channels: [{ id: 1, topic: '/cmd_vel', encoding: 'json', schemaName: 'geometry_msgs/msg/Twist' }] });
  expect(bridge.published).toEqual([]); // armed, but not driving

  // Drag the stick fully forward.
  const pad = page.getByTestId('control-pad');
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 2, { steps: 4 });
  await expect.poll(() => bridge.published.length).toBeGreaterThan(2);
  const moving = twistOf(bridge.published[bridge.published.length - 1]![1]);
  expect(moving.linear.x).toBeGreaterThan(0.4);
  expect(moving.linear.x).toBeLessThanOrEqual(0.5);
  expect(moving.angular.z).toBeCloseTo(0, 1);

  await page.mouse.up();
  await expect.poll(() => twistOf(bridge.published[bridge.published.length - 1]![1]).linear.x).toBe(0);
  // After the stop and its tail, it goes quiet.
  await page.waitForTimeout(500);
  const settled = bridge.published.length;
  await page.waitForTimeout(500);
  expect(bridge.published.length).toBe(settled);
});

test('keys drive while the card is focused, and losing focus stops the robot', async ({ page }) => {
  const bridge = await fakeBridge(page, {});
  await connect(page);
  await page.getByRole('button', { name: 'Enable control' }).click();
  await page.getByTestId('control-pad').focus();

  await page.keyboard.down('w');
  await expect.poll(() => bridge.published.length).toBeGreaterThan(2);
  expect(twistOf(bridge.published[bridge.published.length - 1]![1]).linear.x).toBeCloseTo(0.2, 5);
  await page.keyboard.up('w');
  await expect.poll(() => twistOf(bridge.published[bridge.published.length - 1]![1]).linear.x).toBe(0);

  // Hold a key, then move focus away without releasing it.
  await page.keyboard.down('a');
  await expect.poll(() => twistOf(bridge.published[bridge.published.length - 1]![1]).angular.z).toBeCloseTo(0.5, 5);
  await page.getByRole('button', { name: 'Close control' }).focus(); // still inside the card: no stop
  await page.locator('body').click({ position: { x: 5, y: 5 } }); // outside: stop
  await expect.poll(() => twistOf(bridge.published[bridge.published.length - 1]![1]).angular.z).toBe(0);
  await page.keyboard.up('a');
});

test('Esc disarms and withdraws the channel; closing the card does too', async ({ page }) => {
  const bridge = await fakeBridge(page, {});
  await connect(page);
  await page.getByRole('button', { name: 'Enable control' }).click();
  await page.getByTestId('control-pad').focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Enable control' })).toBeVisible();
  await expect.poll(() => bridge.texts.some((t) => t.op === 'unadvertise')).toBe(true);

  await page.getByRole('button', { name: 'Enable control' }).click();
  await expect(page.getByTestId('control-armed')).toBeVisible();
  await page.getByRole('button', { name: 'Close control' }).click();
  await expect.poll(() => bridge.texts.filter((t) => t.op === 'unadvertise').length).toBe(2);
  await page.getByRole('button', { name: 'Robot control' }).click();
  await expect(page.getByRole('button', { name: 'Enable control' })).toBeVisible(); // reopened disarmed
});

test('a dropped connection disarms, and reconnecting does not resume', async ({ page }) => {
  const bridge = await fakeBridge(page, {});
  await connect(page);
  await page.getByRole('button', { name: 'Enable control' }).click();
  await page.getByTestId('control-pad').focus();
  await page.keyboard.down('w');
  await expect.poll(() => bridge.published.length).toBeGreaterThan(1);

  await bridge.ws!.close({ code: 1006, reason: 'gone' });
  await expect(page.getByText('Not connected. Control is off.')).toBeVisible({ timeout: 10_000 });
  // Reconnects on its own after the backoff; the key is still held, and nothing resumes.
  await expect(page.getByRole('button', { name: 'Enable control' })).toBeVisible({ timeout: 15_000 });
  const before = bridge.published.length;
  await page.waitForTimeout(1000);
  expect(bridge.published.length).toBe(before);
  expect(bridge.texts.filter((t) => t.op === 'advertise')).toHaveLength(1); // the new socket never advertised
  await page.keyboard.up('w');
});

test('a server without client publishing says so and offers no way to arm', async ({ page }) => {
  await fakeBridge(page, { capabilities: ['time'] });
  await connect(page);
  await expect(page.getByText(/does not let clients publish/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Enable control' })).toHaveCount(0);
});
