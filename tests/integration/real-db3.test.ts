/**
 * Integration test against the real DB3 fixture in test_files/db3/.
 *
 * Goes through the unified `parseBag` entry (with format detection) to
 * confirm the .db3 branch dispatches correctly and the sql.js mock from
 * tests/parsers/db3.test.ts isn't required here — the unified entry takes
 * a BagSource, hits `detectFormat`, and dispatches into the same db3.ts
 * path that test mocks via vi.mock.
 *
 * Why the mock isn't needed: vi.mock is hoisted to the top of *each* test
 * file. The db3 unit tests register it; this file is separate so it picks
 * up the real `sql.js` module — but we still need the WASM to resolve.
 * Node's default sql.js loader uses `node_modules/sql.js/dist/sql-wasm.wasm`
 * via `require.resolve`, which works in this Vitest fork environment.
 *
 * The wrinkle: db3.ts hard-codes `locateFile: () => '/sql-wasm.wasm'`,
 * which fails in Node. So we still need the mock — we just import it
 * inline here as well, keeping the assertions oriented around the unified
 * entry rather than the parsers/db3.ts internals.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('sql.js', async () => {
  const actual = await vi.importActual<typeof import('sql.js')>('sql.js');
  const init = actual.default;
  return {
    default: () => init(),
    __esModule: true,
  };
});

const { parseBag, disposeParserCaches } = await import('../../src/parsers/core');
const { createFileSource } = await import('../../src/parsers/source');

const FIXTURE_PATH = join(
  process.cwd(),
  'test_files',
  'db3',
  'sample.625-2.bag2_0.db3',
);
const FIXTURE_AVAILABLE = existsSync(FIXTURE_PATH);

function fixtureSource() {
  const bytes = readFileSync(FIXTURE_PATH);
  return createFileSource(new File([new Uint8Array(bytes)], 'sample.db3'));
}

beforeEach(() => disposeParserCaches());
afterAll(() => disposeParserCaches());

const describeWithFixture = FIXTURE_AVAILABLE ? describe : describe.skip;

describeWithFixture('integration/real-db3 — parseBag against a real .db3', () => {
  it('detects .db3 via extension and dispatches to the DB3 parser', async () => {
    const summary = await parseBag(fixtureSource());
    expect(summary.format).toBe('db3');
    expect(summary.fileName).toBe('sample.db3');
  });

  it('returns a non-empty topic list', async () => {
    const summary = await parseBag(fixtureSource());
    expect(summary.topics.length).toBeGreaterThan(0);
    expect(summary.totalMessageCount).toBeGreaterThan(0);
  });

  it('produces a positive duration with start <= end', async () => {
    const summary = await parseBag(fixtureSource());
    expect(summary.duration).toBeGreaterThan(0);
    expect(summary.startTime <= summary.endTime).toBe(true);
  });
});
