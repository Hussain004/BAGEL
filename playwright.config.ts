import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for BAGEL's browser smoke test.
 *
 * The suite is deliberately narrow: it checks that a real render of the built
 * app does not throw, using the bundled `tour.mcap`. It exists because a real
 * infinite-render-loop bug (a Zustand selector returning a fresh `[]` on every
 * call) passed `tsc -b` and the entire 749-test Vitest suite, and only
 * crashed when actually mounted. Nothing else in CI can catch that class of
 * bug.
 *
 * So: Chromium only, no pixel assertions, no visual diffing. WebGL under
 * SwiftShader is good enough for a "does not crash" check. The splat GPU sort
 * is known to render blank there, which is exactly the kind of thing a smoke
 * test must not assert on.
 */

export default defineConfig({
  testDir: './tests/e2e',
  // The build is served by `vite preview`, which needs a moment to bind.
  timeout: 120_000,
  // Parsing a real bag plus spinning up Three.js is slower than a unit test.
  expect: { timeout: 20_000 },
  // One worker: several tests share one preview server, and parallel WebGL
  // contexts in CI are a reliable way to run out of memory for no benefit.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    // The offline worker would sit between page.route() mocks and the network;
    // only pwa.spec.ts opts back in.
    serviceWorkers: 'block',
    // Deterministic viewport so a failure is reproducible locally.
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // `vite preview` serves the real production bundle, so the smoke test
    // exercises the same artifact users get rather than a dev-server
    // approximation of it.
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});