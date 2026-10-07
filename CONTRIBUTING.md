# Contributing to BAGEL

Thanks for considering it. BAGEL is a fully static web app for exploring ROS bag
files, so there is no server, no backend, and no database to set up. If you can
run Node and a package manager, you can build the whole thing locally.

New to web development but new to ROS? Contributions are welcome and the
review process will help you through it.

## Quick start

```bash
git clone https://github.com/Hussain004/BAGEL.git
cd BAGEL
pnpm install
pnpm dev          # http://localhost:5173
```

`pnpm test:e2e` additionally needs a Chromium download (`pnpm exec playwright
install chromium`) on a fresh machine.

Requirements:

| Tool | Version | Notes |
|---|---|---|
| Node | **22** (see `.nvmrc`) | `nvm use` picks it up automatically |
| pnpm | **11** | `corepack enable` gets you the right version |

We use pnpm, not npm or yarn. Running `npm install` will produce a lockfile
mismatch that CI rejects.

## Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server with hot reload |
| `pnpm build` | `tsc -b` then a production bundle into `dist/` |
| `pnpm lint` | ESLint over the whole repo. Must exit 0 |
| `pnpm test` | The full Vitest suite. Run this before you push |
| `pnpm test:watch` | The same suite in watch mode |
| `pnpm test:e2e` | Playwright browser smoke test against a real build |
| `pnpm preview` | Serve the production build locally |

`pnpm build` runs `tsc -b` first, so **type errors fail the build**. There is
also an unused-code gate, so an import or exported symbol you stop using will
fail CI until you remove it.

## House style

These are the maintainer's standing rules. They are not personal preferences,
they keep the history diffable:

1. **No em dashes (U+2014) anywhere.** Not in code, comments, UI copy, docs,
   commit messages, or PR text. Rephrase, or use a hyphen, comma, parenthesis,
   semicolon, or a second sentence. A repo-wide sweep removed them once
   already; edits to older files tend to reintroduce them. Before committing:
   `grep -rn $'\u2014' src/`.
2. **No AI attribution.** Do not add Claude, Codex, OpenAI, Anthropic, or other
   AI co-author trailers to commits or PRs.
3. Comments should explain **why**, not restate what the line does. The existing
   code is commented fairly heavily for that reason; match it.
4. Keep panel chrome consistent: chrome text is sans, data text is mono, and
   nothing is below 11px. Shared states live in
   `src/components/panels/shared/`.

## Architecture

```
src/parsers/          format readers: mcap.ts, rosbag1.ts, db3.ts, pcd.ts,
                      ply.ts, splat.ts. core.ts dispatches by extension.
src/workers/          parser.worker.ts runs the parsers off the main thread;
                      parserClient.ts is the RPC layer the app talks to.
src/live/             Foxglove WebSocket client, decoder, ring buffer, recorder.
src/store/            zustand stores (layout, playhead, bags, per-panel settings).
src/components/
  landing/            the no-bag landing page.
  layout/             Toolbar, Timeline, PanelGrid: the workspace chrome.
  panels/<Kind>/      one folder per panel kind. PanelGrid.tsx dispatches on kind.
  panels/shared/      PanelStates, OverlayCard, CopyErrorButton: shared chrome.
  modals/             ModalShell plus the dialogs built on it.
src/utils/            pure helpers. Anything testable without React goes here.
                      panelOptions.ts maps a topic to the panel kinds it can
                      open in (shared by the sidebar buttons and the palette).
src/hooks/            cross-cutting React hooks.
tests/                mirrors src/. tests/fixtures/synth.ts builds in-memory bags.
```

Two conventions worth knowing up front, because breaking them causes bugs that
tests will not catch:

- **Never move parsing onto the main thread.** It is a worker per bag on
  purpose, and large bags will lock up the UI if you decode inline.
- **Zustand selectors must return a stable reference.** A selector that builds
  a fresh `[]` or `{}` on every call causes an infinite render loop. This has
  shipped as a real crash before: it passed the build and the whole test suite,
  and only appeared in a browser. When deriving a collection, memoize it, or use
  a module-level constant for empty results (see `EMPTY_TOPIC_LIST` in
  `Timeline.tsx`). `pnpm test:e2e` is the check for this class of bug.

The 3D scene is Z-up, not Y-up. Raw `THREE.Spherical` math is wrong for it,
which is why the keyboard orbit code mirrors OrbitControls' quaternion approach.

## Tests

The suite is **logic-only**: pure functions and stores, no DOM. There is no
React component-test harness. So:

- Anything pure belongs in `src/utils/` **and** in `tests/utils/`.
- Store logic belongs in `tests/store/`.
- Panel components are verified by `pnpm build` and by clicking them.

Tests should cover realistic and deliberately awkward input, not just the happy
path. For parsers and codecs that means absent or inaccurate optional lengths and
sizes, sign-extended `int8` fields, and producer quirks. For stateful or WASM
dependencies in a hot path, make many varied sequential calls on one reused
instance rather than a handful of one-shot cases.

`test_files/` is gitignored, so the two real-bag suites
(`tests/integration/real-db3.test.ts`, `real-mcap.test.ts`) skip themselves in CI.
The synthetic fixtures in `tests/fixtures/synth.ts` and the committed
`public/sample-bags/tour.mcap` carry the coverage.

`tests/e2e/` is Playwright, not Vitest, and is excluded from `pnpm test` so the
two runners cannot collect each other's specs.

## The browser smoke test

`pnpm test` runs in Node and never mounts React, so it structurally cannot see
a render-time failure. `pnpm test:e2e` closes that gap: it builds the app, serves
it, loads the bundled `tour.mcap` in Chromium, and fails on any console error or
page exception.

This exists because of a real bug that reached `main` through a fully green CI.
A Zustand selector returned a fresh `[]` on every call, which React reads as a
changed value forever. `tsc -b` passed (the types were correct), all 749 Vitest
tests passed, lint passed, and the app froze the instant you clicked "Try a
sample bag". Only mounting it caught that.

If you are touching render-time state, run `pnpm test:e2e`. There are
deliberately no pixel assertions in it, so a failure means something real: read
the trace (`npx playwright show-trace test-results/.../trace.zip`) before you
assume the test is wrong.

## How to add support for a new message type

This is the most common contribution, and it touches four places. Say
`foo_msgs/Bar` as the example.

1. **Detect it.** Add an `isFooType(type: string)` predicate to
   `src/utils/messages.ts` alongside the existing `is*Type` functions. Match on
   the ROS 2 spelling with or without `/msg/`, the way `isOccupancyGridType`
   does. Cover both in `tests/utils/`.

2. **Give it a panel option.** Add the kind to `panelOptionsFor()` in
   `src/components/panels/TopicInspector/TopicRow.tsx`. That function decides
   which quick buttons appear on a topic row, and it falls back to
   `['plot', 'raw']` for anything it does not recognise.

3. **Render it.** Either handle the kind in the panel `PanelGrid.tsx` dispatches
   to, or extend an existing panel. If you need a new panel kind, add the folder
   under `src/components/panels/<Kind>/`, wrap it in `PanelShell`, and reuse
   `panels/shared/PanelStates.tsx` for loading, error, and empty states so it
   does not drift from the other panels.

4. **Prove it with a fixture.** Build a message in `tests/fixtures/synth.ts`,
   or drop a small bag in `public/sample-bags/` if it needs a real one. Add a
   test that exercises your detection and, if you wrote decoding logic, that it
   handles a malformed message without throwing.

If the type needs no custom decoding, you are probably done after step 2: the
generic Raw panel can already display it.

## Adding a badge to a dataset

If you host a bag somewhere with CORS enabled, anyone can link straight into a
visualization:

```
https://bagel-ros2.vercel.app/#b=https://example.com/your-bag.mcap
```

`docs/DATASET_HOSTING.md` covers the CORS headers the host needs.

## Pull requests

Keep the change focused, fill in the PR checklist, and make sure `pnpm lint`,
`pnpm exec tsc -b`, and `pnpm test` all pass locally first. If your change is
user-visible, add a line to `FEATURES.md`.

Looking for something to pick up? Issues labelled `good first issue` are scoped
deliberately small, and `ROADMAP_UPGRADES.md` lists larger items with the files
and tests each one would need.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).