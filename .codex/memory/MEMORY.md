# BAGEL project memory

Curated, durable context that is slow to reconstruct from `git log`. Everything
here is a lead, not current truth: re-check the repository and `origin/main`
before relying on any specific claim. Newest verified 2026-10-07 against
`origin/main` = `ecfe27e` (README version badge v1.7.1).

## What the project is

BAGEL (BAG ExpLoration) is a fully static, client-side web app for exploring ROS
bag files (`.mcap`, `.db3`, `.bag`), point clouds (`.pcd`, `.ply`), and Gaussian
splat scenes. No server, no install, no account. MIT licensed. Deployed to Vercel
at `bagel-ros2.vercel.app`.

## Hard rules the maintainer cares about

These are preferences, not suggestions. Violating them is a real regression.

1. **Never use the em dash (U+2014)** in any repository content: code, comments,
   UI copy, docs, commit messages, PR text. Use a hyphen, comma, parenthesis,
   semicolon, or a second sentence. This was enforced by a repo-wide sweep
   (commit `b7c6c72`) and keeps getting reintroduced by edits to older files.
   To check, run `grep -rn $'\u2014' src/` before committing.
2. **No AI attribution.** No Claude/Codex/OpenAI/Anthropic co-author trailers on
   commits or PRs.
3. **Preserve unrelated user changes.** Never sweep pre-existing working-tree
   modifications into a task.
4. When the checkout is dirty, prefer a fresh worktree branched from the latest
   `origin/main` over editing in place.

## Environment facts that will bite you

- Node is pinned by `.nvmrc` (**22**); verified working on v22.23.1. Package
  manager is **pnpm** (11.x), not npm. A `pnpm-lock.yaml` and
  `pnpm-workspace.yaml` are tracked.
- `typescript` is `~6.0.2` and `eslint` is `^10`, both newer than most muscle
  memory expects. `build` runs `tsc -b` first, so **type errors block the
  build** and there is a strict type-checking / unused-code gate in CI.
- Test suite: **749 tests across 61 files**, run with `vitest run`. Two suites
  (`tests/integration/real-db3.test.ts`, `real-mcap.test.ts`) are intentionally
  skipped: they need real fixture bags that are not in the repo
  (`test_files/` is gitignored).
- Tests are **logic-only `.ts` files**. There is deliberately no React
  component-test harness (no jsdom, no testing-library, no React Testing
  Library dependency). Pure logic and stores are unit tested; UI is verified by
  building and by hand in a browser. This is a known, accepted gap, tracked as
  item G3 in `ROADMAP_UPGRADES.md`.
- `.claude/worktrees/` holds full nested checkouts and is excluded via
  `.git/info/exclude`, which is **local-only**. `eslint.config.js` therefore
  carries an explicit `globalIgnores(['dist', '.claude/worktrees'])` so a fresh
  clone that creates a worktree does not lint a second copy of the codebase.
- The demo video lives in `public/demo_videos/` and is linked from the README
  through the Vercel origin, **not** raw.githubusercontent (raw links were
  bandwidth-capped and failed). Do not "simplify" that back to a raw URL.

## Architecture worth knowing before editing

- **Parsing runs in a worker per bag.** `src/workers/` plus the parser modules.
  Never move heavy decoding onto the main thread; it was an explicit
  architecture decision.
- **Zustand stores are split by domain** under `src/store/`. Event handlers read
  state via `getState()` rather than closing over values, which is a deliberate
  discipline. Keep it.
- **A trap that already caused a crash:** a Zustand selector returning a fresh
  array (`[]`) or object on every call causes an infinite render loop. When
  adding a selector that derives a collection, memoize it (`shallow` or a
  `useMemo` outside the store) and re-check in a real browser. Build plus tests
  passing does **not** catch this class of bug; it only appeared on render.
- **3D scene is the largest surface.** `ThreeDScene/index.tsx` was ~3,254 lines
  and is being split (roadmap G1). Helpers already extracted: `clipBox.ts`
  (`buildAxisClip`), `sceneObjects.ts` (`pickFrameId`, `computeFit`,
  `setPoseAxesColor`), `useScene.ts` (`MIN_ZOOM_LEVEL` / `MAX_ZOOM_LEVEL`).
  Prefer extending those over re-inlining logic in the component.
- **Theme tokens live in `src/index.css` via Tailwind v4 `@theme`.** The
  light-theme override strategy (CSS variables flipped per theme) is considered
  the right architecture. Consumers that used to bypass it (uPlot axes, the
  Three.js clear color, the `theme-color` meta tag) were fixed via
  `src/utils/chartTheme.ts`. When adding a themed data surface, read
  `chartTheme.ts` rather than hardcoding hex, or light mode silently breaks.
- **Three.js scene is Z-up, not Y-up.** Raw `THREE.Spherical` math is wrong for
  it; the keyboard-orbit code deliberately mirrors OrbitControls' quaternion
  technique for this reason. Do not "simplify" it back.

## Local-only, untracked planning docs

`IMPROVEMENTS.md` and `IMPROVEMENTS_PROGRESS.md` are **gitignored** (added in
`a866b03`, and removed from the index in `7902f8e`) so they never reach the
public repo. `IMPROVEMENTS_PROGRESS.md` records **25/25 items done**; that work
shipped to `main` as PR #99 (`c911e39`) regardless of the docs staying local.
`ROADMAP_UPGRADES.md` **is** tracked and is the successor roadmap (items A1
through G4 plus a release plan). When asked to "work on IMPROVEMENTS.md",
check the progress file first: that review is complete and redoing it wastes
effort.

## Lessons from past work (do not relearn these)

- Browser screenshot tooling in this environment has had **coordinate-space
  mismatches** (captures rendered ~1447x840 while the real viewport was
  1858x1079), which caused many bogus "the click did not register" retries.
  Prefer element refs over raw coordinates when clicking.
- Deferred-close animations that wait on `animationend` need a `setTimeout`
  safety net, so the store never waits on an event that may not fire. The
  layout store must tolerate a close during a close.
- Persisted settings need a **default-merge** for previously stored state, or
  old localStorage entries lose new fields. The codebase already does this for
  `expressions` in the panel UI stores.
- Parser tests should cover deliberately varied producer output: absent or
  inaccurate optional lengths and sizes, sign-extended `int8` in
  `OccupancyGrid` data, and reused instances across many sequential calls for
  stateful/WASM dependencies.