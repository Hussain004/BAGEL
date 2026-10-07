/**
 * Embed mode, exercised the way it is actually used: a page on one origin
 * frames BAGEL (another origin), which loads a bag by URL from a third origin
 * over HTTP Range.
 *
 * Unit tests cover the parameter parsing. What is only provable here is that
 * the iframe is NOT cross-origin isolated yet still loads and plays a bag, that
 * the chrome is gone, that hostile keys do nothing, and that the embed flag
 * survives the app rewriting its own hash.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test, expect, type Page, type Frame, type ConsoleMessage } from '@playwright/test';
import { writeSyntheticMcap } from '../fixtures/synth';

// The host page is served by a REAL loopback server on another origin (127.0.0.1:<port> vs
// localhost:4173). A fake public hostname, or a route-fulfilled document, is classed as
// public by Chrome's Private Network Access and refused permission to frame localhost.
let hostServer: Server;
let HOST = '';
let hostHash = '';
test.beforeAll(async () => {
  hostServer = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      `<!doctype html><title>host</title><h1>My paper</h1><iframe id="b" src="http://localhost:4173/#${hostHash}" width="1100" height="640"></iframe>`,
    );
  });
  await new Promise<void>((resolve) => hostServer.listen(0, '127.0.0.1', resolve));
  HOST = `http://127.0.0.1:${(hostServer.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => hostServer.close(() => resolve()));
});
const BAGS = 'http://bags.test';

function watchForErrors(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m: ConsoleMessage) => {
    // The embed legitimately runs without cross-origin isolation.
    if (m.type() === 'error' && !/favicon|source ?map|GL Driver|SharedArrayBuffer/i.test(m.text())) {
      problems.push(`console.error: ${m.text()}`);
    }
  });
  return problems;
}

async function rampBag(): Promise<Buffer> {
  const messages = Array.from({ length: 100 }, (_, i) => ({
    logTime: 1_000_000_000n + BigInt(i) * 100_000_000n,
    value: { data: i / 10 },
  }));
  return Buffer.from(await writeSyntheticMcap([{ topic: '/ramp', type: 'std_msgs/msg/Float64', messages }]));
}

/** Serve `bytes` at `${BAGS}/ramp.mcap` with the CORS + Range headers a real dataset host needs. */
async function serveBag(page: Page, bytes: Buffer) {
  await page.context().route(`${BAGS}/**`, async (route) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
      'Accept-Ranges': 'bytes',
    };
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.method() === 'HEAD') {
      return route.fulfill({ status: 200, headers: { ...cors, 'Content-Length': String(bytes.length), 'Content-Type': 'application/octet-stream' } });
    }
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers()['range'] ?? '');
    if (!m) return route.fulfill({ status: 200, headers: cors, body: bytes });
    const start = Number(m[1]);
    const end = Math.min(bytes.length - 1, m[2] ? Number(m[2]) : bytes.length - 1);
    return route.fulfill({
      status: 206,
      headers: { ...cors, 'Content-Range': `bytes ${start}-${end}/${bytes.length}` },
      body: bytes.subarray(start, end + 1),
    });
  });
}

async function openHost(page: Page, hash: string): Promise<Frame> {
  await serveBag(page, await rampBag());
  hostHash = hash;
  await page.goto(`${HOST}/`);
  const handle = await page.waitForSelector('iframe#b');
  return (await handle.contentFrame())!;
}

const BAG_URL = encodeURIComponent(`${BAGS}/ramp.mcap`);

test('an embed shows panels and a timeline, with no app chrome, and loads without isolation', async ({ page }) => {
  const problems = watchForErrors(page);
  const frame = await openHost(page, `b=${BAG_URL}&p=Pplot%3A%2Framp&embed=1&theme=light`);

  await expect(frame.getByTestId('embed-root')).toBeVisible({ timeout: 60_000 });
  await expect(frame.locator('.u-over')).toBeVisible({ timeout: 60_000 });
  await expect(frame.getByRole('slider', { name: /Playhead/ })).toBeVisible();

  // No toolbar, sidebar, or landing page; panels cannot be closed.
  await expect(frame.getByTitle(/Open Bag Health dashboard/)).toHaveCount(0);
  await expect(frame.getByLabel('Topics')).toHaveCount(0);
  await expect(frame.getByRole('button', { name: /^Close .* panel/ })).toHaveCount(0);
  await expect(frame.getByLabel('Add timeline bookmark')).toHaveCount(0);

  // The host's theme applies to the frame, and it really is not isolated.
  expect(await frame.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  expect(await frame.evaluate(() => crossOriginIsolated)).toBe(false);

  // The corner link opens the SAME view without the embed flags.
  const href = await frame.getByRole('link', { name: 'Open in BAGEL' }).getAttribute('href');
  expect(href).toContain('b=');
  expect(href).toContain('p=');
  expect(href).not.toContain('embed');
  expect(href).not.toContain('theme');
  expect(problems).toEqual([]);
});

test('keys that would break an embed do nothing, and the flag survives scrubbing', async ({ page }) => {
  const problems = watchForErrors(page);
  const frame = await openHost(page, `b=${BAG_URL}&p=Pplot%3A%2Framp&embed=1`);
  await expect(frame.locator('.u-over')).toBeVisible({ timeout: 60_000 });

  await frame.locator('body').click({ position: { x: 5, y: 5 } });
  for (const key of ['o', 'Escape', 'Shift+Escape', '?', 'Control+k', 'm']) await page.keyboard.press(key);
  // Still there: O did not clear the bag, Esc did not close the panel.
  await expect(frame.locator('.u-over')).toBeVisible();
  await expect(frame.getByTestId('embed-root')).toBeVisible();

  // Scrub, which makes the app rewrite its hash; the embed flag must stay.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => frame.url(), { timeout: 10_000 }).toMatch(/t=0\.[0-9]*[1-9]/);
  expect(frame.url()).toContain('embed=1');
  expect(problems).toEqual([]);
});

test('autoplay and loop start playback by themselves', async ({ page }) => {
  const problems = watchForErrors(page);
  const frame = await openHost(page, `b=${BAG_URL}&p=Pplot%3A%2Framp&embed=1&autoplay=1&loop=1`);
  await expect(frame.getByRole('button', { name: 'Pause playback' })).toBeVisible({ timeout: 60_000 });
  await expect(frame.getByRole('button', { name: 'Disable loop playback' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('a link with no bag explains itself instead of showing the landing page', async ({ page }) => {
  await page.goto('/#embed=1');
  await expect(page.getByText(/no recording to show/i)).toBeVisible();
  await expect(page.getByText('EXPLORE SAMPLE DATA')).toHaveCount(0);
});

test('a bag that cannot be fetched shows the error, not a blank frame', async ({ page }) => {
  await page.context().route(`${BAGS}/**`, (route) => route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'nope' }));
  await page.goto(`/#b=${BAG_URL}&embed=1`);
  await expect(page.getByTestId('embed-root')).toBeVisible();
  await expect(page.locator('[role="status"]')).not.toContainText('Loading', { timeout: 30_000 });
  await expect(page.getByTestId('embed-root')).toContainText(/fail|error|could not|unreachable|404/i);
});
