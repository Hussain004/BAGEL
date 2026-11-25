/**
 * Importing a PlotJuggler layout from the Presets menu replaces the layout and
 * opens the plot with only the fields the layout named, plus a field from a
 * second topic. The mapping is unit-tested; this proves the menu, the layout
 * store and the plot's one-time field filter work together.
 */

import { test, expect } from '@playwright/test';
import { writeSyntheticMcap } from '../fixtures/synth';

async function bag(): Promise<Buffer> {
  const imu = Array.from({ length: 20 }, (_, i) => ({
    logTime: 1_000_000_000n + BigInt(i) * 100_000_000n,
    value: {
      header: { stamp: { sec: 1, nanosec: i * 100_000_000 }, frame_id: 'imu' },
      orientation: { x: 0, y: 0, z: 0, w: 1 },
      orientation_covariance: new Array(9).fill(0),
      angular_velocity: { x: 0, y: 0, z: i * 0.1 },
      angular_velocity_covariance: new Array(9).fill(0),
      linear_acceleration: { x: i * 0.5, y: 0, z: 9.8 },
      linear_acceleration_covariance: new Array(9).fill(0),
    },
  }));
  const cmd = Array.from({ length: 20 }, (_, i) => ({
    logTime: 1_000_000_000n + BigInt(i) * 100_000_000n,
    value: { linear: { x: i * 0.1, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } },
  }));
  return Buffer.from(await writeSyntheticMcap([
    { topic: '/imu', type: 'sensor_msgs/msg/Imu', messages: imu },
    { topic: '/cmd_vel', type: 'geometry_msgs/msg/Twist', messages: cmd },
  ]));
}

const LAYOUT = `<?xml version='1.0' encoding='UTF-8'?>
<root>
 <tabbed_widget parent="main_window" name="Main Window">
  <Tab containers="1" tab_name="IMU">
   <Container>
    <DockSplitter orientation="-" sizes="1" count="1">
     <DockArea name="...">
      <plot mode="TimeSeries">
       <curve name="/imu/linear_acceleration/x" color="#1f77b4"/>
       <curve name="/cmd_vel/linear/x" color="#d62728"/>
      </plot>
     </DockArea>
    </DockSplitter>
   </Container>
  </Tab>
 </tabbed_widget>
</root>`;

test('a PlotJuggler layout opens its plot with just the named fields', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'imu.mcap', mimeType: 'application/octet-stream', buffer: await bag() });

  await page.getByRole('button', { name: 'Layout presets' }).click({ timeout: 60_000 });
  await page.getByLabel('Layout file to import').setInputFiles({ name: 'imu.xml', mimeType: 'application/xml', buffer: Buffer.from(LAYOUT) });
  await expect(page.getByRole('status')).toContainText('Imported everything.');
  await page.keyboard.press('Escape');

  const chip = (name: string) => page.getByRole('button', { name, exact: true });
  await expect(chip('linear_acceleration.x')).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  await expect(chip('cmd_vel.linear.x')).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  for (const hidden of ['linear_acceleration.z', 'angular_velocity.z', 'orientation.w']) {
    await expect(chip(hidden)).toHaveAttribute('aria-pressed', 'false');
  }
  expect(errors).toEqual([]);
});
