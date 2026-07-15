# IMPROVEMENTS.md progress tracker

Status of each item from [IMPROVEMENTS.md](./IMPROVEMENTS.md). Updated as work lands.

**Done: 13 / 21, 2 partial** (quick wins: 11/11 - all done, medium: 2/9 done + 2 partial, larger initiatives: 0/5 - the larger ones need a design decision first)

## Quick Wins

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Self-host fonts (privacy claim) | **Done** | Google Fonts @import replaced with bundled @fontsource-variable Inter + JetBrains Mono; dist verified free of external font requests |
| 2 | Drop zone keyboard operability | **Done** | Enter/Space now opens the file picker |
| 3 | Topic-row buttons visible on keyboard focus | **Done** | group-focus-within added to the button strip and stats fade |
| 4 | Esc ordering (popovers before panels) | **Done** | New useEscapeToClose hook; export menu and 3D Display card consume Esc; panel-close undo toast not included (tracked as follow-up) |
| 5 | Light theme inside data surfaces (uPlot + 3D clear color + theme-color meta) | **Done** | New utils/chartTheme.ts; uPlot axes, trajectory canvas ink, 3D clear color, and the theme-color meta all follow the theme now; also fixed canvas font strings broken by the variable-font rename |
| 6 | "Copy link" button for the shareable URL layout | **Done** | Toolbar button copies location.href, 2s "Copied" confirmation |
| 7 | Replace transition-all with explicit properties | **Done** | Swept ~65 occurrences across 19 files; each one checked against its actual state branches (color-only -> transition-colors, opacity/transform/size toggles -> explicit property list) so nothing silently lost its fade/resize |
| 8 | Typography and copy consistency (ellipsis, casing, tabular-nums) | **Done** | All "..." -> "…" in UI strings; tabular-nums added to Toolbar stat values |
| 9 | Timeline slider focusable + scrub/bookmark hint | **Done** | tabIndex added (global arrow shortcuts already operate the playhead); title hints at double-click bookmarks |
| 10 | content-visibility on topic rows | **Done** | content-visibility: auto + contain-intrinsic-size on .topic-row |
| 11 | Narrow-viewport banner + timeline wrap | **Done** | Dismissible sm:hidden notice on DropZone; Timeline row gets flex-wrap |

## Medium Effort

| # | Item | Status | Notes |
|---|------|--------|-------|
| 12 | Shared PanelStates + OverlayCard (cohesion) | Partial | PanelStates half done: extracted src/components/panels/shared/PanelStates.tsx, eliminated 13 duplicate Loading/Error/Empty implementations across 7 panels. OverlayCard (the floating in-canvas control card pattern used by 3D Display, plot controls, etc.) not started |
| 13 | 3D Display card progressive disclosure | **Done** | Only color-by/point-size/grid/axes visible by default; rest behind 3 native `<details>` sections (Coordinate frame, Range and clipping, Accumulation, Overlays) with expand-state persisted per-panel in threeDPanelStore; defaults save/reset moved to a pinned footer; manually verified in-browser (dark + light theme, expand-state survives close/reopen) |
| 14 | Timeline data-density strip | Todo | |
| 15 | Docking discoverability + keyboard path | Todo | |
| 16 | Sample bag lands on a curated cockpit layout | Todo | |
| 17 | Live status: consolidate buttons, aria-live, buffer extent | Todo | |
| 18 | Error copy with next steps | Partial | Scoped down deliberately: investigated the actual error paths and found source-level messages already carry real next-step guidance where one exists (createUrlSource already explains CORS/Content-Length/Accept-Ranges failures inline; schema-missing topics route to the paste-schema modal instead of erroring). Building a downstream error->action classifier on top of that would duplicate it, not improve it. Shipped the honest remaining gap instead: a "Copy error details" button on the DropZone parse-failure box and the shared PanelErrorState, for the unscripted cases (corrupt file, worker exception) that don't have a real next step beyond filing a bug report |
| 19 | Modal focus trap | **Done** | Tab/Shift+Tab now wrap inside the dialog; no component-test harness exists in this repo (all tests are logic-only .ts), so no automated test was added for this one |
| 20 | Micro-interactions motion spec (CSS-only) | Todo | |

## Larger Initiatives (blocked on a design decision)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 21 | Visual identity: instrument vs glass | Awaiting decision | |
| 22 | Panel maximize (then maybe tabs) | Awaiting decision | Maximize alone could proceed; tabs need a call |
| 23 | Named layout presets | Awaiting decision | Topic-matching strategy undecided |
| 24 | 3D/canvas accessibility tier | Awaiting decision | Tier 1 recommended |
| 25 | Per-topic timeline lanes | Awaiting decision | Depends on item 14 landing first |
