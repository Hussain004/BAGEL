/**
 * Vitest config for BAGEL.
 *
 * The test suite runs in Node — most of BAGEL's parsers + utils are
 * deliberately framework-agnostic (the worker layer is the only React/DOM
 * touchpoint and we test below it). Node 20+ provides `File`, `Blob`, and
 * `fetch` natively so we can build a `BagSource` and exercise the same code
 * the browser runs.
 *
 * Coverage is scoped to `src/parsers/**` and `src/utils/**` — the React
 * panels are tested manually (and via the `verify` skill) since the panel
 * surface is still moving and the v0.9 mocking overhead would outweigh the
 * value. Tests are kept under `tests/` rather than co-located beside source
 * so editing a panel doesn't accidentally trigger a 200-file test re-run.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Per-test timeout. Real-bag integration tests open multi-MB fixtures
    // through the same code paths as the browser, which can take a few
    // seconds when sql.js initialises its WASM blob on the first call.
    testTimeout: 30_000,
    // `forks` rather than `threads` because sql.js' WASM module has tripped
    // worker-thread serialization quirks in past Vitest versions. The
    // overhead is small (<100 ms per file) and isolation is cleaner.
    pool: 'forks',
    poolOptions: {
      forks: {
        // Tests share module state inside a single fork (which is fine — our
        // parsers cache their last-loaded source by key, and the cache key
        // diverges between fixtures so there's no cross-test pollution).
        singleFork: false,
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/parsers/**', 'src/utils/**'],
      exclude: [
        '**/*.d.ts',
        // Worker / browser-only modules: not exercised under node.
        'src/workers/**',
      ],
      reporter: ['text', 'json-summary'],
    },
  },
});
