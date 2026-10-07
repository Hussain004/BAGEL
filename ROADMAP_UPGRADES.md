# BAGEL Upgrade Roadmap

A working guide for the next round of BAGEL improvements: visual polish, new features, new audiences, and the engineering work that keeps it all maintainable. Each item explains **why** it matters, **what** to build, **which files** to touch, and **how to test it**, written so another engineer can pick up any item and start.

Grounded in the source as of `origin/main` at v1.7.1 (PR #109). Two notes before starting:

- **Already done; don't redo:** everything in the earlier local UX review, `IMPROVEMENTS.md` / `IMPROVEMENTS_PROGRESS.md` (untracked since 7902f8e, so those links only resolve in a local checkout; 25/25: self-hosted fonts, copy-link, light-theme data surfaces, density strip, panel maximize, layout presets, per-topic lanes, focus trap, docking keyboard path, and more). This document starts where that review stopped.
- **Already on the README's "Possible future directions" list:** fisheye undistortion, Collada textures, zstd edit output, plugin panels, cloud share links, `.db3` Range streaming, xacro. They're referenced here only where they connect to something new.

Item format: **Why** / **What** / **How** / **Files** / **Tests** / **Effort** (S = under a day, M = 2 to 5 days, L = 1 to 3 weeks).

---

## 0. Priority overview

| # | Item | Area | Impact | Effort |
|---|------|------|--------|--------|
| A1 | CONTRIBUTING, issue/PR templates, good-first-issues | Community | High | S |
| A2 | Make CI lint blocking + Playwright smoke test | Community / Health | High | S-M |
| A3 | "Open in BAGEL" badge + link builder for dataset authors | Community | High | S |
| A4 | Slim the README, move history to CHANGELOG.md | Community | Medium | S |
| B1 | Undo toast for closed panels | UX | Medium | S |
| B2 | Command palette (Ctrl/Cmd+K) | UX | High | M |
| B3 | Namespace tree + type filter in the topic sidebar | UX | High | M |
| B4 | Recent files (File System Access handles) | UX | Medium | M |
| B5 | Per-panel empty states that teach | UX | Medium | S |
| B6 | Touch/tablet viewing mode | UX | Medium | M |
| C1 | Multi-topic time-series plots | Feature | Very high | M-L |
| C2 | XY (field vs field) plot mode | Feature | High | S-M |
| C3 | `nav_msgs/Path`, `PoseArray`, `PolygonStamped` 3D layers | Feature | High | M |
| C4 | IMU orientation + acceleration visual | Feature | Medium | S-M |
| C5 | `vision_msgs` detections (2D boxes on images, 3D boxes in scene) | Feature | Very high | M |
| C6 | LiDAR-to-camera projection overlay | Feature | High | M |
| C7 | 3D measure tool + point inspector | Feature | High | M |
| C8 | State-transition panel (enums, booleans, strings) | Feature | High | M |
| C9 | Depth image colormaps | Feature | Medium | S |
| D1 | Message search / "find when" query | Analysis | Very high | M-L |
| D2 | Anomalies become timeline bookmarks | Analysis | Medium | S |
| D3 | Plot range statistics and export (CSV / PNG / SVG) | Analysis | Medium | S-M |
| D4 | Two-bag diff report | Analysis | High | M |
| E1 | Split recordings (`_0.mcap`, `_1.mcap`, `metadata.yaml`) | Data access | Very high | M |
| E2 | Installable PWA with `file_handlers` | Data access | High | M |
| E3 | Embed mode (`#embed=1`) for docs, papers, and dataset pages | Data access | Very high | M |
| E4 | `.spz` splats + multiple splats per panel | Data access | Low-Med | S-M |
| F1 | Dataset publishers (builds on A3 + E3) | Audience | Very high | - |
| F2 | Educators and students: guided tours | Audience | High | M |
| F3 | ML / perception engineers: labelling and frame export | Audience | High | M-L |
| F4 | CI / QA: headless `bagel-check` CLI + GitHub Action | Audience | High | M |
| F5 | Live robot operators: publish, teleop, service calls | Audience | High | L |
| F6 | PX4 / drone community: ULog support | Audience | High | L |
| G1 | Split `ThreeDScene/index.tsx` (3,254 lines) and `Toolbar.tsx` (1,146) | Health | High | M |
| G2 | Panel registry (prerequisite for plugin panels) | Health | High | M |
| G3 | Component test harness for the React layer | Health | Medium | S-M |
| G4 | Performance benchmarks + bundle budget in CI | Health | Medium | M |

**Suggested order:** do A1-A4 first (each is about a day, and they turn visitors into contributors). Then E1 + C1 + C5 (what real users hit most), then E3 + F1 (the biggest growth lever), then the rest.

---

## A. Community and credibility

At 49 stars, the project is at the point where people who arrive need to be able to contribute without asking. Right now the repo has no `CONTRIBUTING.md`, no `CODE_OF_CONDUCT.md`, no `CHANGELOG.md`, and no `.github/ISSUE_TEMPLATE/`. Every item below is cheap and compounds.

### A1. CONTRIBUTING, templates, good-first-issues

**Why:** A star turns into a contributor only if there's a documented path. Robotics people are often first-time web contributors, so "how do I run this and where do things live" is the main barrier.

**What:**
- `CONTRIBUTING.md`: setup (`pnpm i`, `pnpm dev`, Node version from `.nvmrc`, commit it), architecture map (below), test expectations, and the house style rules (no em dashes, no AI co-author trailers).
- `.github/ISSUE_TEMPLATE/bug_report.yml`: fields for bag format, ROS distro, file size, browser, the "copy error details" text that `actionableError.ts` already produces, and whether the bag can be shared.
- `.github/ISSUE_TEMPLATE/feature_request.yml` and `new_message_type.yml` ("I want BAGEL to visualize `foo_msgs/Bar`": ask for the `.msg` definition and a tiny sample bag).
- `.github/pull_request_template.md`: checklist (tests added, `pnpm lint`, `tsc -b`, FEATURES.md entry if user-facing).
- Label 5-10 issues `good first issue`. Candidates in this doc: B1, B5, C4, C9, D2, E4.

**How (architecture map to put in CONTRIBUTING):**
```
src/parsers/      format readers (mcap.ts, bag.ts, db3.ts, pcd.ts, ply.ts, splat.ts), dispatch in core.ts
src/workers/      parser.worker.ts runs parsers off-thread; parserClient.ts is the RPC
src/live/         Foxglove WebSocket client, decoder, ring buffer, recorder
src/store/        zustand stores (layout, playhead, bags, per-panel settings)
src/components/panels/<Kind>/   one folder per panel kind; dispatched in layout/PanelGrid.tsx
src/utils/        pure helpers; anything testable without React lives here
tests/            mirrors src/; tests/fixtures/synth.ts builds in-memory bags
```
Add a short "How to add support for a new message type" walkthrough (detector in `utils/messages.ts` -> button in `TopicInspector/TopicRow.tsx` `panelOptionsFor` -> render path -> test with a `synth.ts` fixture). That's the most common contribution people will want to make.

**Status: done** (`CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, three issue templates, a PR checklist, `config.yml`).

**Files:** new `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 verbatim), `.github/ISSUE_TEMPLATE/*.yml`, `.github/pull_request_template.md`, commit `.nvmrc`.
**Tests:** none. Have someone unfamiliar with the repo follow CONTRIBUTING on a clean clone.
**Effort:** S

### A2. Make lint blocking; add a browser smoke test to CI

**Why:** `.github/workflows/ci.yml` still has `continue-on-error: true` on lint, with a comment saying the react-hooks v7 cleanup was pending. PR #109 did that cleanup, so the reason for the exception is gone. Separately, `IMPROVEMENTS_PROGRESS.md` records a real infinite-render-loop bug (a zustand selector returning a fresh `[]`) that passed build and tests and only showed up in a browser. A smoke test catches that class of bug.

**What / How:**
1. Confirm `pnpm lint` exits 0 on a fresh `origin/main` checkout (main has moved since #109), then remove `continue-on-error: true` from the lint step and delete the stale comment.
2. Add `@playwright/test` as a dev dependency and a `tests/e2e/smoke.spec.ts` that:
   - runs against `pnpm build && pnpm preview`
   - clicks "Try a sample bag" (it loads `public/sample-bags/tour.mcap`), waits for the curated layout from item 16, and asserts that zero `console.error` messages were logged (`page.on('console')`)
   - opens one panel of every kind from the topic list and checks for no errors
   - scrubs the timeline with the keyboard (arrow keys) and checks the playhead text changes
3. New CI job `e2e` running `npx playwright install --with-deps chromium` then the spec. Use Chromium only; WebGL under SwiftShader is enough for a "doesn't crash" check (FEATURES.md notes the splat GPU sort is blank there, so skip pixel asserts on splats).

**Status: done** (lint is a hard gate; `tests/e2e/smoke.spec.ts` runs against `pnpm preview` on Chromium in a new `e2e` CI job). Verified the smoke test catches the bug it was written for: reintroducing a `.slice()` into the pinned-topics selector in `Timeline.tsx` fails the e2e job while all 749 Vitest tests still pass.

**Files:** `.github/workflows/ci.yml`, `package.json` (`test:e2e` script), `playwright.config.ts`, `tests/e2e/smoke.spec.ts`, `vitest.config.ts` (exclude `tests/e2e`).
**Tests:** The spec is the test. Check that it catches the bug: temporarily reintroduce a selector returning a fresh `[]` and confirm the run fails.
**Effort:** S (lint) + M (Playwright)

### A3. "Open in BAGEL" badge and link builder

**Why:** `useUrlState.ts` already accepts `#b=<https url>`, which loads a remote bag through HTTP Range. Any dataset page can therefore deep-link straight into a visualization today; nobody knows it. Dataset READMEs (M2DGR, Newer College, Hilti, university labs) are where BAGEL's target users already are. A badge in someone else's README is free, permanent distribution.

**What:**
- A small "Share / embed" modal (or a section in the existing About modal) that takes the current state and generates three snippets:
  1. Markdown badge: `[![Open in BAGEL](https://bagel-ros2.vercel.app/badge.svg)](https://bagel-ros2.vercel.app/#b=...&p=...)`
  2. Plain link
  3. `<iframe>` snippet (once E3 lands)
- `public/badge.svg`: a static shields-style badge.
- A `docs/DATASET_HOSTING.md` page explaining the one thing that trips people up: the bag host needs CORS headers allowing `Range` and exposing `Content-Range` / `Accept-Ranges` / `Content-Length`. Give copy-paste configs for S3, GCS, Cloudflare R2, and nginx. For hosts you can't configure (Hugging Face, Zenodo, GitHub Releases), run the CORS probe below against each one and document what it actually reports; don't assume. `actionableError.ts` already classifies CORS/Range failures; link that error message to this doc.

**How:** The link builder reuses the serializer `useUrlState.ts` already uses to write the hash (around line 310). If the current bag is a local file, disable the snippet and explain why ("upload the bag somewhere with CORS, paste its URL here, and we'll build the link"). Add a URL input that validates by issuing a `HEAD` plus a `Range: bytes=0-15` request and reports exactly which header is missing.

**Status: done** (`ShareModal` + `public/badge.svg` + `docs/DATASET_HOSTING.md` + `utils/corsProbe.ts`, 17 unit tests and 4 browser tests). The hosting doc's host table is from real probe runs, not assumptions: **Hugging Face works** (302 to a CDN, then `206` with `Content-Range`), **Zenodo does not** (answers a Range request with `200` and the full body, no `Accept-Ranges`, `Content-Range` not exposed).

**Files:** new `src/components/modals/ShareModal.tsx`, register in `ModalHost.tsx`, button in `Toolbar.tsx` next to Copy link, `public/badge.svg`, `docs/DATASET_HOSTING.md`, `src/utils/actionableError.ts` (doc link).
**Tests:** unit-test the CORS probe classifier with mocked `fetch` responses: no `Accept-Ranges`, 200 instead of 206, `Content-Range` not exposed, opaque CORS failure.
**Effort:** S

### A4. Slim the README; add CHANGELOG.md

**Why:** The README has grown into a full release history (every v0.x to v1.7 entry, the long roadmap paragraph). A first-time visitor needs about 30 seconds of content: what it is, a GIF, the live demo link, the supported formats table, and how to run it. The deep material already lives in FEATURES.md.

**What:** Keep: hero, demo video, "Why BAGEL" table, condensed format and panel tables, quick start, contributing link. Move "Earlier version highlights" and the roadmap paragraph into `CHANGELOG.md` (Keep a Changelog format, one short entry per version linking to the FEATURES.md anchor). Turn "Possible future directions" into GitHub issues labelled `roadmap` and link the filtered issue list; that also gives contributors something to pick up.

**Status: done** (README 59 KB to 29 KB; `CHANGELOG.md` added; the seven "future directions" became roadmap issues #119-#125 with a `roadmap` label).

**Files:** `README.md`, new `CHANGELOG.md`.
**Effort:** S

---

## B. UX polish

### B1. Undo toast for closed panels

**Why:** Deferred from IMPROVEMENTS item 4. Esc ordering is fixed, but closing a carefully configured 3D panel (frame, clip box, overlays, accumulation) is still permanent.

**How:**
1. In `src/store/layoutStore.ts`, before `closePanel` removes a leaf, record `{ leaf, parentSplitId, siblingId, index, orientation }` in a `lastClosed` field. Clear it on `closeAll` / `restoreLayout`.
2. Add `reopenLastClosed()`: if the sibling still exists, call the existing `dockPanel(leaf, siblingId, edge)` with the edge implied by `index` + `orientation`. Otherwise call `openPanel(leaf)`.
3. Per-panel settings survive automatically: `threeDPanelStore` and `panelUiStores` key by panel id and aren't purged synchronously on close. Check this; if they are purged, delay the purge until the toast expires.
4. Toast: a small fixed element (`role="status"`, `aria-live="polite"`) shown for 6 s. `Ctrl/Cmd+Z` triggers undo while it's visible (wire it in `useKeyboardShortcuts.ts`).

**Status: done** (`lastClosed` + `reopenLastClosed` in `layoutStore`, `UndoToast`, `Cmd/Ctrl+Z`, 13 store tests and 6 browser tests). The record stores the sibling and the side the panel sat on, so undo restores the panel to its original grid slot via `dockPanel` rather than appending it to the end. Deliberately **no** Escape-to-undo: a second window keydown listener would race the global Escape handler and one keypress would both reopen the closed panel and close the next.

**Files:** `layoutStore.ts`, new `components/layout/UndoToast.tsx`, `App.tsx`, `useKeyboardShortcuts.ts`.
**Tests:** `tests/store/layoutStore.test.ts`: close then reopen restores the same tree shape (deep-equal the serialized tree); reopen after the sibling was also closed falls back to `openPanel`; `closeAll` clears `lastClosed`.
**Effort:** S

### B2. Command palette (Ctrl/Cmd+K)

**Why:** BAGEL now has a lot of actions spread across a toolbar, modals, per-panel cards, and around 30 single-key shortcuts. A palette makes all of them discoverable and keyboard-fast. Users of VS Code and Foxglove already expect one.

**What:** One fuzzy-searchable list over:
- **Topics:** "Open /camera/image_raw in Image", one entry per `panelOptionsFor()` result
- **Actions:** open bag, connect live, edit bag, export clip, toggle theme, add bookmark, apply preset X, load URDF, health dashboard
- **Navigation:** jump to bookmark X, go to time `12.5s` (parse numbers typed into the palette)

**How:**
- Build a `commands` array from existing store actions; no new behaviour. Each entry is `{ id, label, group, keywords, run }`.
- Fuzzy matching: a ~30-line subsequence scorer in `src/utils/fuzzy.ts`. Don't add a dependency.
- Render using `ModalShell.tsx` (it already has the focus trap). Use an `aria-activedescendant` listbox pattern for the result list.
- Register `mod+k` in `useKeyboardShortcuts.ts`, and add it to `ShortcutsModal.tsx`.

**Status: done** (`utils/fuzzy.ts`, `utils/commands.ts`, `CommandPalette`, `Cmd/Ctrl+K`, 20 fuzzy tests, 20 command tests, 11 browser tests). The fuzzy scorer is a small DP over (query position, target position), **not** a greedy scan: greedy matching takes the `r` in "ca**r**a" when scoring `raw` against `/camera/image_raw`, so it ties with a scattered `mra` instead of finding "ima**r**ew". `panelOptionsFor` / `suggestPanelKind` moved out of `TopicRow.tsx` into `utils/panelOptions.ts` so the palette and the sidebar quick buttons share one mapping rather than two that drift. `Cmd/Ctrl+K` is bound above the `typing` guard, next to Escape, because the palette's search field holds focus for the whole interaction and a binding below that guard would be dead exactly when it is needed.

**Files:** new `components/modals/CommandPalette.tsx`, `utils/fuzzy.ts`, `ModalHost.tsx`, `useKeyboardShortcuts.ts`, `ShortcutsModal.tsx`.
**Tests:** `tests/utils/fuzzy.test.ts`: ranking (prefix > word-start > subsequence), case-insensitivity, `/` and `_` in topic names, empty query.
**Effort:** M

### B3. Namespace tree and type filter in the topic sidebar

**Why:** Real robot bags have 100 to 400 topics (`/robot1/sensors/lidar/front/points`...). A flat list with text search works for people who know the name, but not for exploring an unfamiliar bag, which is BAGEL's core use case.

**What:**
- A toggle between flat and tree views. The tree view groups topics by namespace segment, collapsing single-child chains (`/robot1/sensors/lidar` shown as one node).
- Type chips above the list ("Images 4", "Point clouds 2", "TF", "Diagnostics"...) built from the same `is*Type` detectors in `utils/messages.ts`. Click a chip to filter.
- Show message count and Hz on group nodes (summed / max), so a dead namespace is obvious.
- Persist the view mode and expanded nodes in `uiStore`.

**How:** Write a pure `buildTopicTree(topics)` in `src/utils/topicTree.ts` returning nested nodes. Keep `TopicRow.tsx` unchanged as the leaf renderer. The existing `content-visibility` optimization on `.topic-row` still applies. Flatten the visible tree before rendering, so a single virtualized/flat list stays.

**Status: done** (`utils/topicTree.ts` + `utils/topicCategory.ts` with 25 unit tests, tree/list toggle and 11 category chips in the sidebar, 10 browser tests). Two decisions: single-child chains collapse (`/robot1/sensors/lidar` is one row), and an active text search always renders flat, since a tree of a four-topic search result is harder to scan than the list it replaces. Also fixed a latent flake in `tests/e2e/share.spec.ts`: the URL round-trip test left its stubbed route serving worker Range reads when the test ended, and the un-drained route failed the *next* test with `route.fetch: Test ended`.

**Files:** `components/panels/TopicInspector/index.tsx`, new `utils/topicTree.ts`, `store/uiStore.ts`.
**Tests:** `topicTree.test.ts`: chain collapsing, root-level topics (`/tf`), topics that are both a leaf and a namespace prefix (`/odom` and `/odom/filtered`), multi-bag topic lists, 1,000-topic input performance (under 10 ms).
**Effort:** M

### B4. Recent files

**Why:** Re-opening the same 2 GB bag means navigating the file picker every time. Chromium browsers can persist a `FileSystemFileHandle` in IndexedDB and re-open it after one permission click, with no copy and no upload.

**How:**
- In `DropZone.tsx` / `FileIngestPanel.tsx`: when `window.showOpenFilePicker` exists, use it instead of `<input type=file>` and keep the handle. For drag-and-drop, `DataTransferItem.getAsFileSystemHandle()` returns one too.
- Store `{ handle, name, size, lastModified, openedAt }` in IndexedDB (a raw `indexedDB` wrapper of ~40 lines in `src/utils/recentFiles.ts`; no `idb` dependency needed).
- On the landing page, show "Recent" (max 8). Clicking calls `handle.requestPermission({ mode: 'read' })`, then `getFile()`, then the normal load path.
- Firefox and Safari don't have the API: hide the section, keep the input fallback. Remote URLs can be listed in the same "Recent" list without any of this.

**Status: done** (`utils/recentFiles.ts` + `landing/RecentFiles.tsx`, 9 unit tests and 7 browser tests). The File System Access picker and drag handles persist a `FileSystemFileHandle` per file in IndexedDB alongside the metadata list, so reopening is one click plus one permission prompt. Metadata and handles live in two stores keyed by the same id, since handles are not JSON-serialisable. The section hides when there is nothing to show, and on browsers without the API only URL entries render. The end-to-end reopen path (pick, reload, click, workspace again) is covered by a browser test with a stubbed picker returning a real bag.

**Files:** `DropZone.tsx`, `landing/FileIngestPanel.tsx`, `landing/LandingPage.tsx`, new `utils/recentFiles.ts`.
**Tests:** unit-test list ordering, dedupe by (name, size, lastModified), cap at 8. Test the permission flow manually in Chrome.
**Effort:** M

### B5. Per-panel empty states that teach

**Why:** `PanelStates` centralized the loading/error/empty chrome, but the empty copy is generic. Each empty state is a chance to say what the panel needs.

**What:** Per kind:
- 3D with no TF: "No /tf in this bag. Showing data in its own frame `velodyne`. Pick a fixed frame in Display > Coordinate frame."
- Image with a CameraInfo topic present: offer to pair it.
- Plot with no numeric fields: list the field types found and suggest Raw.
- Trajectory with a single message: "Only one pose; nothing to draw a path from."

**Files:** `components/panels/shared/PanelStates.tsx` (accept `hint` and `action` props), call sites per panel.
**Effort:** S

### B6. Touch / tablet viewing mode

**Why:** Field engineers review bags on tablets next to the robot. The narrow-viewport banner (IMPROVEMENTS item 11) tells them to go away. A read-mostly mode is enough.

**How:**
- Under `(pointer: coarse)` or below `768px`: a single-column stack instead of a split tree (render `PanelGrid` leaves in order, one maximized at a time with a swipeable tab strip; `maximizedId` already exists in `layoutStore`).
- Timeline: increase the thumb hit area to 44 px, add pinch-to-zoom of the time range.
- 3D: `OrbitControls` already handles touch; add a visible "Fit" button since there's no `F` key.
- Disable drag-to-dock on touch.

**Files:** `layout/PanelGrid.tsx`, `layout/Timeline.tsx`, `index.css`, `DropZone.tsx` (soften the banner).
**Tests:** a Playwright run at the iPad viewport (if A2 lands) loading the sample bag.
**Effort:** M

---

## C. Visualization features

### C1. Multi-topic time-series plots

**Why:** The most-requested feature in any bag tool. Today `TimeSeriesPlot` is bound to one topic (`PanelLeaf.topicName` is a single string), and math expressions only reference fields of that topic. "Commanded velocity vs measured velocity" (`/cmd_vel` vs `/odom`) is the canonical robotics debugging plot, and BAGEL can't draw it.

**What:** Add series from any topic (and any loaded bag) to an existing plot. Expressions can reference fields across topics (`odom.twist.twist.linear.x - cmd_vel.linear.x`).

**How:**
1. **Data model.** Keep `PanelLeaf.topicName` as the plot's *primary* topic for back-compat. Add plot-specific state in a per-panel store (same pattern as `threeDPanelStore`): `extraSeries: Array<{ bagId, topicName, fieldPath, alias }>`. Don't change the `PanelLeaf` shape, so old hashes and presets parse unchanged.
2. **URL (not done in the first cut).** Extra series live in the panel store like expressions do, not in the hash. If shareable series are wanted, encode them as a new hash param `ps=<panelId>~<bag>:<topic>:<field>|...` parsed in `useUrlState.ts`. Unknown params are already ignored, so old BAGEL builds won't break on new links.
3. **Loading.** The plot currently loads through `useTopicMessages`. Run one loader per distinct topic and merge.
4. **Time alignment.** Topics have different timestamps. uPlot needs one shared x array, so build the union of timestamps and fill gaps with `null` (uPlot draws gaps; set `spanGaps: true` per series). For expressions over different topics, sample each input at the expression's reference topic timestamps with zero-order hold (last value), which is what engineers expect. Put this in a pure `src/utils/alignSeries.ts`.
5. **Multi-bag.** Respect the existing time-alignment modes (`wall-clock`, `bag-start`, `anchor`) by applying the same offset function the timeline uses when merging.
6. **UI.** An "Add series" button in the plot header opens a field picker: topic search (reuse the B2 fuzzy matcher), then a field tree. Also support dragging a topic row from the sidebar onto a plot.
7. **Expressions.** `mathExpr.ts` resolves variable names from a flat dict. Extend the identifier grammar to allow dotted/aliased names (`odom.vx`) and pass the aligned dict in.

**Files:** `components/panels/TimeSeriesPlot/index.tsx`, `store/panelUiStores.ts` (or a new `plotPanelStore.ts`), `hooks/useUrlState.ts`, new `utils/alignSeries.ts`, `utils/mathExpr.ts`, `store/presetStore.ts` (store extra series as type-slots, like existing presets).
**Tests:** `alignSeries.test.ts` with realistic shapes: 100 Hz vs 10 Hz, identical timestamps, a topic with a 5 s gap, non-monotonic stamps (BAGEL already detects these in `anomalies.ts`, so they occur in real bags), one empty topic. `mathExpr.test.ts`: dotted identifiers. URL round-trip test including an old v0.7 hash with no `ps=`.
**Effort:** M-L

### C2. XY plot mode

**Why:** Plotting field vs field (not vs time) covers controller phase plots, `x` vs `y` of a position, current vs speed for motor characterization. It's small once C1's alignment exists.

**How:** A toggle in the plot header: X axis = time (default) or any series. uPlot supports this with `mode: 2` (scatter/xy) plus a `paths` builder for points. Color points by time with a sequential ramp (reuse `turboColor` from `utils/pointcloud.ts`) so direction is visible. Draw the current-playhead sample as a larger marker.

**Files:** `TimeSeriesPlot/index.tsx`, `utils/chartTheme.ts`.
**Tests:** a pure `buildXYData` test for x/y length mismatch after alignment and NaN dropping.
**Effort:** S-M (after C1)

### C3. `nav_msgs/Path`, `PoseArray`, `PolygonStamped` in the 3D scene

**Why:** Nav2 and MoveIt bags are full of these (`/plan`, `/local_plan`, `/particle_cloud`, footprints). Today they fall through to `panelOptionsFor()`'s last branch (`['plot', 'raw']`), and `detectKind()` in `ThreeDScene/sceneKind.ts` treats anything unknown as `'pose'`. Planned path vs actual odometry on top of the map is the single most common Nav2 debugging view.

**How:**
1. Detectors in `utils/messages.ts`: `isPathType`, `isPoseArrayType`, `isPolygonType`.
2. `panelOptionsFor()` in `TopicRow.tsx`: return `['3d', 'raw']` for them.
3. Rendering: Path is a line strip of `poses[].pose.position`; reuse the `LINE_STRIP` builder in `markerObjects.ts` (refactor it to accept a `Float32Array` of points if it currently takes a marker). PoseArray reuses the `ARROW` marker geometry with one `InstancedMesh` (particle clouds reach 5,000 poses). Polygon is a closed line loop.
4. **Most important:** add them to `getSpatialOverlayCandidates()` in `spatialOverlayTopics.ts` and give `spatialOverlay.tsx` a `PathOverlay` next to `CloudOverlay` / `MapOverlay` / `PoseOverlay`. That makes "map + scan + odom + global plan + local plan" one scene, using the TF composition that already exists.
5. Per-overlay color (the `spatialOverlayStyles.color` field already exists) so global vs local plans are distinguishable.

**Files:** `utils/messages.ts`, `TopicInspector/TopicRow.tsx`, `ThreeDScene/sceneKind.ts`, `ThreeDScene/markerObjects.ts`, `ThreeDScene/spatialOverlay.tsx`, `ThreeDScene/spatialOverlayTopics.ts`.
**Tests:** builder tests in `tests/components/` (vertex count, closed loop for polygon, empty path, 5,000-pose array uses one instanced mesh). Overlay candidate test in `tests/store/spatialOverlays.test.ts`. Add Path/PoseArray topics to `scripts/build-sample-bag.mjs` so the tour bag shows them.
**Effort:** M

### C4. IMU visual

**Why:** `sensor_msgs/Imu` is in nearly every bag. It already plots field by field through the generic plot path, but orientation as quaternion components is unreadable to humans.

**What:** In the plot panel, an "orientation as roll/pitch/yaw" derived-series preset (a one-click set of three expressions, if `mathExpr.ts` gains `atan2` and `asin`). In the 3D scene, an IMU kind showing an orientation triad plus an acceleration arrow, gravity-subtracted if a toggle is on.

**Files:** `utils/mathExpr.ts` (add `atan2`, `asin`, `deg`), `TimeSeriesPlot` header, `ThreeDScene/sceneKind.ts`.
**Tests:** quaternion-to-Euler test at gimbal-lock edges (pitch at +/-90 degrees) and identity.
**Effort:** S-M. Good first issue for the expressions half.

### C5. Detections: `vision_msgs` 2D boxes on images, 3D boxes in the scene

**Why:** Perception engineers are the fastest-growing ROS user group, and their first question about any bag is "what did the detector see on this frame?" `vision_msgs/Detection2DArray` and `Detection3DArray` (plus Foxglove's `ImageAnnotations` and `SceneUpdate`) cover most of it.

**How:**
1. **Image overlay.** `ImageViewer/index.tsx` already draws a CameraInfo overlay on its canvas and has zoom/pan transforms. Add an "Overlays" dropdown listing detection topics, auto-paired by namespace the same way `useCameraInfo.ts` pairs `/camera/image_raw` with `/camera/camera_info`. For each selected topic, `useMessageAtTime` fetches the detection nearest the image's header stamp. Use the **image's** stamp, not the playhead, or boxes visibly lag on fast motion. Draw boxes, class id/label, and score. Apply the same zoom/pan transform as the image.
2. **Undistort interaction.** If `undistort` is on, the box corners must go through the same remap as the pixels (`utils/imageRectify.ts`) or they'll be off at the edges. Transform the four corners and draw the warped quad.
3. **3D.** `Detection3DArray` boxes go into the scene as wireframe cubes (reuse the marker `CUBE` path with edges geometry), TF-placed via the header frame. Add as a spatial overlay kind.
4. **Class colors.** Hash class id to a stable palette (`utils/color.ts` already has a private `hashString`; export it).
5. **Not done in the first cut:** 3D `Detection3DArray` boxes in the scene, and `foxglove.ImageAnnotations`. `vision_msgs` is also not in the bundled `.db3` type registry, so a `.db3` bag with detections needs the existing paste-schema flow (`.mcap` and `.bag` carry their own schemas and work directly). Guessing a layout for `.db3` was rejected because the Humble and earlier layouts differ and a wrong guess decodes garbage.
6. **Foxglove schemas.** Map `foxglove.ImageAnnotations` in `foxgloveSchemas.ts` to the same internal shape, so both ecosystems work.

**Files:** `ImageViewer/index.tsx`, new `hooks/useDetections.ts`, `utils/messages.ts`, `parsers/foxgloveSchemas.ts`, `ThreeDScene/spatialOverlay.tsx`, `utils/imageRectify.ts` (export a point-remap function).
**Tests:** stamp-matching test (detections at 10 Hz, images at 30 Hz: pick nearest, never a future one beyond a tolerance), corner remap round-trip, older vs newer `vision_msgs` shapes (`results[].id` vs `results[].hypothesis.class_id`; `BoundingBox2D.center` as `Pose2D` with `x` vs `center.position.x`). Check the exact version boundaries against the vision_msgs changelog and fixture both shapes.
**Effort:** M

### C6. LiDAR-to-camera projection

**Why:** The best extrinsic-calibration sanity check there is: project points onto the image and see whether edges line up. BAGEL already has every input: point clouds, CameraInfo intrinsics + distortion, and TF between the frames.

**How:** In ImageViewer, a "Project point cloud" overlay picks a `PointCloud2` topic. For the cloud nearest the image stamp: transform points into the camera optical frame with the existing TF chain utility (the one `cameraFrustum` placement uses), keep `z > 0`, project with `K` (plus distortion via the plumb-bob forward model already in `imageRectify.ts`), and draw as 2 px dots colored by depth with `turboColor`. Do the projection in a worker or cap at 200k points; it's an embarrassingly parallel loop over a `Float32Array`.

**Files:** `ImageViewer/index.tsx`, new `utils/projectCloud.ts`, reuse `utils/pointcloud.ts`, TF helpers from `ThreeDScene`.
**Tests:** `projectCloud.test.ts`: a synthetic cube of points at known positions with identity extrinsics and a known K projects to known pixels; points behind the camera are dropped; distortion is applied in the right direction (compare against hand-computed values).
**Effort:** M

### C7. 3D measure tool and point inspector

**Why:** "How far is that obstacle?" and "what's the intensity of this return?" come up constantly. Shift+click already picks a pivot point, so the raycast plumbing exists.

**How:** A ruler toggle in the 3D header. While active, a click raycasts against point clouds (`THREE.Raycaster` with `params.Points.threshold` scaled by point size) and against the ground plane as a fallback. Two clicks give distance + delta xyz in the fixed frame. A hover tooltip on a point shows xyz, intensity, ring, and the source topic (read from the decoded buffer by the hit `index`). Esc clears (route through `useEscapeToClose`).

**Files:** `ThreeDScene/index.tsx` (after G1 splits it, this belongs in a new `ThreeDScene/measureTool.tsx`).
**Tests:** a pure `distanceReadout` formatter test. Check picking manually.
**Effort:** M

### C8. State-transition panel

**Why:** Robots are state machines: nav goal status, mode switches, `std_msgs/Bool` e-stop, `std_msgs/String` behaviour-tree node names. Plotting those as numbers is useless. A swimlane of colored segments with the value label is the right view. The `DiagnosticArray` panel already renders swimlanes.

**How:** New panel kind `state` (add to `PanelKind` in `layoutStore.ts`, dispatch in `PanelGrid.tsx`). Pick one or more fields of enum/bool/string/int type. Compress consecutive equal values into segments in a pure `buildSegments(values, times)`. Render on canvas like the DiagnosticArray swimlane (extract its drawing code into a shared helper rather than copying it). Click a segment to seek. Offer it in `panelOptionsFor()` for `std_msgs/Bool`, `String`, `Int*`, `UInt8` (common enum carrier), and `action_msgs/GoalStatusArray`.

**Files:** new `components/panels/StateTransitions/index.tsx`, `store/layoutStore.ts`, `layout/PanelGrid.tsx`, `TopicRow.tsx`, shared swimlane helper from `DiagnosticArray/`.
**Tests:** `buildSegments` with a single value, alternating values, a long run, and null/missing values.
**Effort:** M

### C9. Depth image colormaps

**Why:** `compressedDepth` is decoded (`utils/compressedDepth.ts`, `utils/png16.ts`) but shown as plain grayscale, which hides structure, and raw `16UC1` / `32FC1` images were not decoded at all (they threw "Unsupported image encoding"). Both are fixed together in this item.

**How:** A colormap select (gray / turbo / inverted) and min/max range inputs (auto from 1st/99th percentile) in the ImageViewer header for depth encodings. Map through `turboColor`, building a 256-entry LUT once. Show a small color bar with the metres scale.

**Files:** `ImageViewer/index.tsx`, `utils/color.ts`.
**Tests:** percentile auto-range with zeros (invalid depth) excluded; NaN in `32FC1`.
**Effort:** S. Good first issue.

---

## D. Analysis

### D1. Message search: "find when ..."

**Why:** The biggest gap between "viewer" and "debugger". Questions like "when did `/battery_state.percentage` drop below 0.2", "when did `/diagnostics` report ERROR", or "every `/rosout` line from `nav2_controller`" currently mean scrubbing by eye.

**What:** A search panel (or a palette mode, `?` prefix in B2) with predicate rows: `topic` + `field path` + operator (`< > == != contains changes`) + value. Results are a list of timestamps (click to seek) and are also drawn as ticks on the timeline. "Save as bookmarks" turns them into bookmarks via the existing `annotationStore`.

**How:**
- Evaluate in the parser worker, not the main thread. Add a `findMessages(topic, fieldPath, predicate)` RPC to `parser.worker.ts` / `parserClient.ts` that streams through `readDeserializedMessages` and returns only matching timestamps (cap at 10k, report truncation). This keeps a multi-GB scan off the UI thread and reuses every format reader.
- The predicate is serializable data (`{ path, op, value }`), not a function, because it crosses the worker boundary.
- `changes` (value differs from the previous message) is the most useful operator for state fields. Add an edge filter (rising/falling) for numeric thresholds so a noisy signal doesn't produce 10,000 hits.
- Progress + cancel: report scanned/total messages and support aborting with a request id.

**Files:** `workers/parser.worker.ts`, `workers/parserClient.ts`, new `utils/predicate.ts` (pure evaluator), new `components/panels/Search/index.tsx` or palette integration, `layout/Timeline.tsx` (result ticks), `store/annotationStore.ts`.
**Tests:** `predicate.test.ts` with nested paths, array indices (`ranges[0]`), type mismatches (string compared to a number gives no match, not a crash), and edge detection over noisy data. An integration test against the committed `tour.mcap`.
**Effort:** M-L

### D2. Anomalies become timeline bookmarks

**Why:** `utils/anomalies.ts` already detects non-monotonic stamps, and the health stats know gap events, but you only see them by opening the Health panel. Putting them on the timeline makes "something happened at 42 s" visible without being asked for.

**How:** A Health panel button "Mark on timeline" that adds anomaly/gap timestamps as a distinct bookmark category (a different tick color, or "auto" kind in `annotationStore`). Keep auto marks out of the URL hash unless pinned, so shared links don't fill with noise.

**Files:** `panels/BagHealth/index.tsx`, `store/annotationStore.ts`, `layout/Timeline.tsx`.
**Tests:** annotationStore test: auto marks don't serialize to `bm=`; pinned ones do.
**Effort:** S. Good first issue.

### D3. Plot range statistics and export

**Why:** After zooming into a plot region, people want numbers: mean, min, max, std, RMS, and the time span. Then they want the data in a spreadsheet or the figure in a paper.

**How:** A drag-selection (uPlot `select`) shows a small card with stats per visible series, computed with a single pass over the selected index range. Export buttons: CSV of the visible range (reuse `utils/export.ts`), PNG (uPlot canvas `toBlob`), and SVG for papers (re-render the visible series with a minimal SVG polyline writer; publication users want vector output).

**Files:** `TimeSeriesPlot/index.tsx`, `utils/export.ts`, new `utils/seriesStats.ts`.
**Tests:** `seriesStats` with nulls, a single sample, large values (use Welford for variance, not sum of squares).
**Effort:** S-M

### D4. Two-bag diff report

**Why:** "This run worked, that run didn't. What's different?" Multi-bag loading and the cross-bag health chips already exist; a structured diff is the natural next step and something no other browser tool offers.

**What:** With two bags loaded, a report listing: topics only in A / only in B, type mismatches, Hz differences beyond 10%, message-count deltas, TF frames present in one only, and duration. Each row links to opening both topics side by side (or as two series in one plot via C1).

**How:** Purely a function of the two `BagSummary` objects plus the cached health stats (`readAllMessageStats`). A pure `diffBags(a, b)` in `utils/bagDiff.ts` and a table panel (reuse the Health table component styling).

**Files:** new `utils/bagDiff.ts`, new panel or a mode of `BagHealth/index.tsx`.
**Tests:** `bagDiff.test.ts`: identical bags give an empty diff; renamed topics show as add + remove; ROS1 vs ROS2 type names (`sensor_msgs/Image` vs `sensor_msgs/msg/Image`) are normalized first and not reported as mismatches.
**Effort:** M

---

## E. Data access

### E1. Split recordings and ROS 2 bag directories

**Why:** `ros2 bag record` with `--max-bag-size` or `--max-bag-duration` (standard on real robots) produces a directory: `metadata.yaml` plus `name_0.mcap`, `name_1.mcap`... Today BAGEL opens one file at a time. Users either open a single fragment or give up. This is probably the most common real-world friction left.

**How:**
1. **Ingest.** Accept a folder drop (`DataTransferItem.webkitGetAsEntry()` / `getAsFileSystemHandle()`) or multi-select. If the files share a stem with `_N` suffixes, or a `metadata.yaml` lists them (`rosbag2_bagfile_information.relative_file_paths`), treat them as one logical bag. A tiny YAML subset parser is enough for that key; don't add a YAML dependency.
2. **Parser layer.** Add a composite source in `parsers/source.ts`: `{ kind: 'multi', parts: BagSource[] }`. Implement `parseBag` for it by parsing each part (they're independent, fully indexed files) and merging summaries: union topics, sum counts, min/max times. `readMessageAtTime` / `readRawMessages` route to the part(s) whose time range overlaps; for ranged reads, concatenate in time order.
3. **Bag identity.** `sourceKey()` for multi-sources must be stable (sorted part keys) so bookmarks and presets keyed by fingerprint keep working.
4. **Edit/export.** Not free: the edit pipelines (`edit.ts`, `editDb3.ts`, `editRos1.ts`) read a single source directly, so they refuse a split recording with a clear message and the Edit button is disabled. A real "merge split bag into one MCAP" needs a k-way merge writer over the parts; treat it as its own follow-up.
5. **`.db3` splits** follow the same pattern via `parsers/db3.ts`.

**Files:** `parsers/source.ts`, `parsers/core.ts`, new `parsers/multi.ts`, `DropZone.tsx`, `landing/FileIngestPanel.tsx`, `store/bagStore.ts`.
**Tests:** following the AGENTS.md testing principles, build fixtures with `tests/fixtures/synth.ts`: parts with overlapping time ranges (they do overlap at split boundaries), a topic present in only one part, a schema that changes id between parts (each MCAP file numbers its own channels and schemas, so never merge by id; merge by name + schema text), parts given out of order, and a missing middle part (warn, keep going).
**Effort:** M

### E2. Installable PWA with `file_handlers`

**Why:** Field use is offline. With a web app manifest + service worker, BAGEL installs as a desktop app, works without network after the first visit, and (with `file_handlers`) appears in the OS "Open with" menu for `.mcap` / `.bag` / `.db3`. That's a native-app experience at almost no cost, and it strengthens the "your data never leaves your machine" story.

**How:**
- `public/manifest.webmanifest` with icons (render the favicon SVG at 192/512), `display: standalone`, and `file_handlers: [{ action: "/", accept: { "application/octet-stream": [".mcap", ".bag", ".db3", ".pcd", ".ply"] } }]`.
- In `main.tsx`: `if ('launchQueue' in window) launchQueue.setConsumer(p => p.files[0].getFile().then(loadBag))`, routed into the same entry point the drop zone uses.
- Service worker: precache the built assets. Write a ~60-line `sw.js` that caches `dist` assets by hashed filename (Vite hashes them, so cache-first is safe), or use `vite-plugin-pwa` if a dependency is acceptable. Watch out for the COOP/COEP headers in `vercel.json`: responses served from the SW cache must keep them, or `crossOriginIsolated` turns false and the splat shared-memory path silently turns off. Store full `Response` objects, which keep headers, and verify `crossOriginIsolated === true` when offline.
- Add a small "Install app" button on the landing page (`beforeinstallprompt`).

**Files:** `public/manifest.webmanifest`, `index.html`, `src/main.tsx`, `public/sw.js` or `vite.config.ts`, `landing/LandingPage.tsx`.
**Tests:** Playwright: load, go offline (`context.setOffline(true)`), reload, sample bag still loads, `crossOriginIsolated` still true.
**Effort:** M

### E3. Embed mode

**Why:** Pairs with A3. A paper's project page, a dataset website, a course LMS, or a blog post can show a *live, scrubbable* bag instead of a video. Every embed is a BAGEL ad that robotics people see.

**What:** `#embed=1` (alongside the existing `b=`, `p=`, `t=` params) renders only the panel grid + a compact timeline: no toolbar, no landing page, no sidebar. A small "Open in BAGEL" corner link opens the full app with the same hash. Optional `autoplay=1` and `loop=1`.

**How:**
- Parse `embed` in `useUrlState.ts` into `uiStore.embedMode`. In `App.tsx`, branch the layout on it.
- Disable features that make no sense inside an iframe (drag-to-dock, editing, live connect).
- **Isolation gotcha:** BAGEL ships COOP/COEP headers, and the splat shared-memory path checks `crossOriginIsolated`. A cross-origin iframe is only isolated when the parent page is isolated too, which ordinary dataset and course pages won't be. Design embed mode for the **non-isolated** case: check `window.crossOriginIsolated` at runtime (as SplatViewer already does) and confirm MCAP, `.bag`, and `.db3` all load without it. A parent that does send COEP may also need BAGEL's responses to carry `Cross-Origin-Resource-Policy: cross-origin`. Check both cases with a test host page.
- Respect `prefers-color-scheme` or a `theme=light|dark` param so it matches the host page.

**Files:** `hooks/useUrlState.ts`, `store/uiStore.ts`, `App.tsx`, `layout/Timeline.tsx` (compact variant), `docs/DATASET_HOSTING.md` (embed section), the A3 share modal.
**Tests:** URL parse tests for the new params. A Playwright test that loads a local HTML page embedding BAGEL in an iframe with the sample bag.
**Effort:** M

### E4. `.spz` and multi-splat scenes

**Why:** Listed as out of scope in v1.7.0. `.spz` is now the common compressed splat format from Niantic Scaniverse, and the underlying library already supports it.

**How:** Add `.spz` to `detectFormat()` in `parsers/core.ts` (extension-based, like `.splat`), to the DropZone `accept` list, and pass the right format hint to the viewer's `addSplatScene`. For multi-splat, allow dropping a second splat onto an existing SplatViewer panel and keep a per-scene transform list (the `dynamicScene: true` path already supports per-scene transforms).

**Files:** `parsers/splat.ts`, `parsers/core.ts`, `DropZone.tsx`, `SplatViewer/index.tsx`.
**Tests:** detection tests in `tests/parsers/splat.test.ts` (`.spz` with and without an extension-less URL).
**Effort:** S (`.spz`) / M (multi-splat)

---

## F. New audiences

Each audience below is reached mostly by reusing what BAGEL already has, so it's a positioning and packaging effort as much as a coding one.

### F1. Dataset publishers and academic labs

**Pitch:** "Add one badge to your dataset README and every visitor can explore your data without installing ROS."

**Build:** A3 (badge + CORS doc) + E3 (embed) + E1 (split bags, since big datasets are always split).
**Outreach:** Open a friendly PR adding the badge to 3-5 datasets you already know load well (M2DGR is credited in the README demo). Each merged PR is a permanent inbound link. Keep a "Datasets that open in BAGEL" gallery section in the README with live links; it doubles as a regression test list for E1 and C5.
**Effort:** mostly A3/E3/E1.

### F2. Educators and students

**Pitch:** "Teach ROS data concepts (TF, timestamps, sensor fusion) in a browser, in the first lecture, before anyone fights a ROS install."

**Build: guided tours.** A tour is a JSON file: `{ bagUrl, steps: [{ layoutHash, timeSec, title, markdownBody, highlightSelector? }] }`. A side card shows the step text with Next/Back. Each step applies its layout hash (the existing `useUrlState` restore) and seeks. Ship 2-3 tours on the bundled `tour.mcap` ("What is TF?", "Reading a LaserScan", "Why timestamps disagree") under `public/tours/`, and load with `#tour=<url>`. Instructors write their own tours as JSON with no code.
**Files:** new `components/layout/TourCard.tsx`, `store/tourStore.ts`, `useUrlState.ts` (`tour=` param), `public/tours/*.json`.
**Tests:** tour JSON schema validation (bad step, missing layout) fails with a readable error.
**Outreach:** post to ROS Discourse "Education" and to the course-material maintainers of popular ROS 2 university courses.
**Effort:** M

### F3. ML and perception engineers

**Pitch:** "Find the interesting moments in your bags, label them, and export training data, all in the browser."

**Build:**
- **Time-range labels.** Extend `annotationStore` from point bookmarks to ranges with a label and a free-text note (drag on the timeline with a modifier key). Export as JSON / CSV: `{ bag, start_ns, end_ns, label, note }`. This is the format people currently keep in spreadsheets.
- **Frame export.** The clip exporter already renders panels frame by frame. Add a "raw frames" mode that exports the original image messages (decoded to PNG, or the original JPEG bytes for `CompressedImage` with no re-encode) for a labelled range, at a chosen stride, with a `frames.csv` mapping filename to timestamp. Pair each image with the nearest point cloud as `.pcd` (writer is the inverse of `parsers/pcd.ts`, binary variant, ~50 lines).
- With D1 (search) this becomes: search for a condition, mark the hits as ranges, export the frames.
**Files:** `store/annotationStore.ts`, `layout/Timeline.tsx`, `modals/ClipExportModal.tsx`, `utils/clipEncoder.ts`, new `utils/pcdWriter.ts`.
**Tests:** the PCD writer round-trips through `parsePcd`; range label serialization; the CompressedImage passthrough export is byte-identical to the message payload.
**Effort:** M-L

### F4. CI / QA engineers: headless `bagel-check`

**Pitch:** "Fail a pull request when the robot's recording is missing topics or `/scan` dropped below 9 Hz."

**Why it's cheap:** the parsers are pure TypeScript with no DOM dependency (`parsers/core.ts`, `readAllMessageStats`, `utils/topicStats.ts`, `utils/anomalies.ts`). The Bag Health dashboard's logic can run in Node unchanged, and `scripts/verify-parsers.mjs` already runs parsers outside the browser.

**Build:**
- `packages/bagel-check/` (pnpm workspace; `pnpm-workspace.yaml` exists) with a CLI: `npx bagel-check run.mcap --expect expectations.yaml`.
- Expectations file: `topics: { /scan: { min_hz: 9, max_gap_s: 0.5 }, /tf: { required: true } }`, plus `no_non_monotonic_stamps: true`.
- Output: a human-readable table, `--json`, and a Markdown summary written to `$GITHUB_STEP_SUMMARY`. The summary includes an "Open in BAGEL" link when the bag has a URL (ties back to A3).
- A thin GitHub Action wrapper (`action.yml`, `runs: using: node24`) so it's `uses: Hussain004/bagel-check@v1`.
- The Node source: implement `BagSource` over `fs.FileHandle.read` for range reads, so multi-GB bags don't load into memory. `.db3` needs sql.js in Node, which works with the same WASM.
**Tests:** run the CLI against `public/sample-bags/tour.mcap` with a passing and a failing expectations file in CI.
**Effort:** M. This also brings BAGEL to people who never open the web app, and they find it through the Action's link.

### F5. Live robot operators: publish, teleop, service calls

**Why:** Live mode is read-only today; `foxgloveClient.ts` only handles `advertise`/`unadvertise`/`status` from the server. `foxglove_bridge` supports client publishing (`clientPublish` capability) and service calls (`services` capability). That turns BAGEL from a viewer into a lightweight field console: drive the robot, send a nav goal, call `/reset_odometry`, from a laptop or (with B6) a tablet.

**How:**
1. Protocol: implement the client-side ops `advertise` (client channels), `publish` (binary `0x01` frame with channel id + CDR payload), and `callService` / `serviceCallResponse`. Check the server's `capabilities` in `serverInfo` and hide features it doesn't offer.
2. Encoding: `@foxglove/rosmsg2-serialization` already provides a `MessageWriter` next to the reader `liveDecoder.ts` uses. Use it for `geometry_msgs/Twist` / `PoseStamped`.
3. UI:
   - A teleop panel: an on-screen joystick + WASD, publishing `Twist` at a fixed 10 Hz while held and a zero Twist on release, blur, and disconnect (safety).
   - "2D Goal" tool in the 3D panel's top-down orthographic mode: click and drag to set position + heading, publish `PoseStamped` on `/goal_pose`.
   - A service-call panel with a JSON editor generated from the service's request schema.
4. Safety: publishing is off by default per connection, behind an explicit "Enable control" toggle with a visible red state. Never auto-reconnect into a publishing state. Document that BAGEL adds no authentication; that's the bridge's job.
**Files:** `live/foxgloveClient.ts`, `live/liveConnection.ts`, new `components/panels/Teleop/`, `ThreeDScene` goal tool, `store/liveStore.ts`.
**Tests:** encode/decode round-trip of the client publish frame against the protocol spec bytes; the zero-twist-on-release state machine (press, blur, disconnect, reconnect all end at zero and disabled).
**Effort:** L

### F6. PX4 / ArduPilot drone community: ULog support

**Why:** The drone community is large, mostly not on ROS, and its main browser tool (PX4 Flight Review) is upload-based, so files go to a server. A local-first ULog viewer with BAGEL's plot, trajectory-with-OSM-tiles, and 3D panels is a natural fit and a whole new audience.

**How:** ULog is a documented, simple binary format (header, definitions section with format/info/parameter messages, data section with subscription + data + logging messages). Write `parsers/ulog.ts` producing the same `BagSummary`: each `(message name, multi_id)` becomes a topic, and format definitions become the schema. Map `vehicle_global_position` to a NavSatFix-shaped object so `TrajectoryPlot` with OSM tiles works unchanged, and `vehicle_attitude` + `vehicle_local_position` to a Pose for the 3D scene. Parameters and logged text messages go to the Log panel.
**Files:** new `parsers/ulog.ts`, `parsers/core.ts` (`detectFormat`: magic `ULog\x01\x12\x35`), `utils/messages.ts` adapters.
**Tests:** following AGENTS.md: fixtures from real PX4 releases (format changed across versions: appended-data flag, `multi_id`, nested formats, padding fields named `_padding0`), a truncated log (logs from crashes are common, the same lesson as interrupted MCAPs), and a log with dropout messages.
**Effort:** L

---

## G. Engineering health

### G1. Split the oversized components

**Why:** `ThreeDScene/index.tsx` is 3,254 lines and `Toolbar.tsx` is 1,146. Every 3D feature in this document (C3, C5, C6, C7, F5) touches the 3D file, and contributors (A1) will bounce off it. Do this before the 3D features.

**How (ThreeDScene):** Move pieces out in behaviour-preserving steps, one PR each, running the full suite + Playwright smoke (A2) after each:
1. The Display card / controls UI to `ThreeDScene/DisplayCard.tsx` (the `<details>` sections are natural seams).
2. Per-kind feeds (point cloud, laser scan, markers, occupancy grid, pose) to `ThreeDScene/feeds/*.tsx`, each owning its subscription + object lifecycle.
3. Camera/keyboard controls (orbit/zoom/fit, the item 24 accessibility keys, the ortho zoom slider) to `ThreeDScene/useCameraControls.ts`.
4. `index.tsx` remains the composition root (target under 600 lines).

**How (Toolbar):** extract `LiveConnectControl`, `RecordControl`, `PresetsMenu`, `ExportMenu` into `layout/toolbar/*.tsx`.
**Tests:** no new tests. The rule is zero behaviour change; review with `git diff --stat -M` showing moves.
**Effort:** M

### G2. Panel registry

**Why:** Adding a panel kind today means editing `PanelKind` in `layoutStore.ts`, the switch in `PanelGrid.tsx`, `KIND_BUTTON_LABEL` / `KIND_BUTTON_TITLE` / `panelOptionsFor` in `TopicRow.tsx`, presets, and URL encoding. A registry makes C8, F5, and D1 one-file additions, and it's the prerequisite for the "plugin panels" roadmap item, which needs a stable internal contract before it can have a public one.

**How:**
```ts
// src/components/panels/registry.ts
export interface PanelDefinition {
  kind: PanelKind;
  label: string;           // button text
  title: string;           // tooltip
  accepts(type: string, topicName: string): boolean;
  priority: number;        // ordering in panelOptionsFor
  component: React.LazyExoticComponent<React.ComponentType<PanelProps>>;
}
```
Derive `panelOptionsFor()` and the `PanelGrid` dispatch from the registry. Use `React.lazy` per panel, which also code-splits SplatViewer and its library away from users who never open a splat (good for G4). Keep `PanelKind` a string-literal union for URL back-compat.

**Files:** new `components/panels/registry.ts`, `layout/PanelGrid.tsx`, `TopicInspector/TopicRow.tsx`.
**Tests:** a snapshot of `panelOptionsFor()` for ~30 representative message types before and after the refactor must match exactly.
**Effort:** M

### G3. Component test harness

**Why:** `IMPROVEMENTS_PROGRESS.md` item 19 notes "no component-test harness exists in this repo (all tests are logic-only .ts)". Focus traps, Esc ordering, and the undo toast (B1) are exactly the kind of behaviour that regresses silently.

**How:** Add `@testing-library/react` + `jsdom` as dev deps and use a per-file `// @vitest-environment jsdom` header so existing node-environment tests don't change. Start with `ModalShell` (focus trap wrap), `useEscapeToClose` ordering, and `TopicRow` keyboard handling.
**Effort:** S-M

### G4. Performance benchmarks and a bundle budget

**Why:** BAGEL's promise is "multi-GB bags in a browser". Performance regressions (like the zstd episode in v1.6.4-1.6.7) should be caught by CI, not by a user on ROS Discourse.

**How:**
- `vitest bench` files for hot paths: `decodePointCloud2` (1M points), CDR decode of 10k Imu messages, MCAP chunk decompression (zstd, lz4), `alignSeries` (C1). Run on CI and post results as a PR comment; start as non-blocking and set thresholds once the variance is known.
- A reused-instance stress test for the decompressors, per the AGENTS.md rule for stateful/WASM deps: 1,000 sequential mixed-size chunks through the same decoder instance, comparing output hashes.
- Bundle budget: a CI step that fails when the main entry chunk grows beyond a threshold (read `dist/.vite/manifest.json` after `vite build` with `build.manifest: true`). G2's lazy panels should shrink the entry first, then lock in the number.
**Effort:** M

---

## Release plan sketch

| Release | Theme | Items |
|---------|-------|-------|
| v1.7.2 | Community foundations | A1, A2, A3, A4, B1, D2, C9 |
| v1.8 | "Works on my real bags" | G1, G2, E1, C1, C2, C3 |
| v1.9 | Perception | C5, C6, C7, C4, C8, D3 |
| v1.10 | Reach | E3, F1, E2, F2, B2, B3 |
| v2.0 | Beyond the viewer | D1, F3, F4, F5, D4 |
| Later | New ecosystems | F6, B4, B6, E4, plugin panels on top of G2 |

After each release, post a short GIF-first note to ROS Discourse ("General" and "Tooling") and r/ROS. Track which features get mentioned back; they show where to go next better than any roadmap does.
