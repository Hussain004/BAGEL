/**
 * A large remote .db3 opens through the page reader: HTTP Range reads of the
 * SQLite pages it needs, never one download of the whole file. Built at 50 MB,
 * just past the URL threshold, from mostly blob bytes, as a camera bag is.
 */

import { test, expect } from '@playwright/test';
import { MessageWriter } from '@foxglove/rosmsg2-serialization';
import { collectMessageDefinitions, writeSyntheticDb3 } from '../fixtures/synth';

test('a 50 MB remote .db3 streams by Range and shows a message', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const w = new MessageWriter(collectMessageDefinitions('std_msgs/msg/String'));
  const messages = Array.from({ length: 250 }, (_, i) => ({
    timestampNs: 1_000_000_000n + BigInt(i) * 100_000_000n,
    data: w.writeMessage({ data: `frame ${i} ` + 'x'.repeat(210_000) }),
  }));
  const bytes = Buffer.from(await writeSyntheticDb3([{ topic: '/camera/blob', type: 'std_msgs/msg/String', messages }]));
  expect(bytes.length).toBeGreaterThan(50 * 1024 * 1024);

  let whole = 0;
  let served = 0;
  await page.context().route('http://bags.test/**', async (route) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Range',
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
      'Accept-Ranges': 'bytes',
    };
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'Content-Length': String(bytes.length) } });
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers()['range'] ?? '');
    if (!m) {
      whole++;
      return route.fulfill({ status: 200, headers: cors, body: bytes });
    }
    const start = Number(m[1]);
    const end = Math.min(bytes.length - 1, m[2] ? Number(m[2]) : bytes.length - 1);
    served += end - start + 1;
    return route.fulfill({ status: 206, headers: { ...cors, 'Content-Range': `bytes ${start}-${end}/${bytes.length}` }, body: bytes.subarray(start, end + 1) });
  });

  await page.goto(`/#b=${encodeURIComponent('http://bags.test/big.db3')}`);
  await expect(page.getByLabel(/^\/camera\/blob, .*String, 250 messages/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Open raw inspector' }).first().click();
  await expect(page.getByText(/frame \d+/).first()).toBeVisible({ timeout: 60_000 });
  expect(whole).toBe(0);
  expect(served).toBeLessThan(bytes.length / 4);
  expect(errors).toEqual([]);
});
