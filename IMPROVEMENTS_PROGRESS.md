# IMPROVEMENTS.md progress tracker

Status of each item from [IMPROVEMENTS.md](./IMPROVEMENTS.md). Updated as work lands.

**Done: 4 / 21** (quick wins: 4/11, medium: 0/8, larger initiatives: 0/5 - the larger ones need a design decision first)

## Quick Wins

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Self-host fonts (privacy claim) | **Done** | Google Fonts @import replaced with bundled @fontsource-variable Inter + JetBrains Mono; dist verified free of external font requests |
| 2 | Drop zone keyboard operability | **Done** | Enter/Space now opens the file picker |
| 3 | Topic-row buttons visible on keyboard focus | **Done** | group-focus-within added to the button strip and stats fade |
| 4 | Esc ordering (popovers before panels) | **Done** | New useEscapeToClose hook; export menu and 3D Display card consume Esc; panel-close undo toast not included (tracked as follow-up) |
| 5 | Light theme inside data surfaces (uPlot + 3D clear color + theme-color meta) | Todo | |
| 6 | "Copy link" button for the shareable URL layout | Todo | |
| 7 | Replace transition-all with explicit properties | Todo | |
| 8 | Typography and copy consistency (ellipsis, casing, tabular-nums) | Todo | |
| 9 | Timeline slider focusable + local arrow keys | Todo | |
| 10 | content-visibility on topic rows | Todo | |
| 11 | Narrow-viewport banner + timeline wrap | Todo | |

## Medium Effort

| # | Item | Status | Notes |
|---|------|--------|-------|
| 12 | Shared PanelStates + OverlayCard (cohesion) | Todo | |
| 13 | 3D Display card progressive disclosure | Todo | |
| 14 | Timeline data-density strip | Todo | |
| 15 | Docking discoverability + keyboard path | Todo | |
| 16 | Sample bag lands on a curated cockpit layout | Todo | |
| 17 | Live status: consolidate buttons, aria-live, buffer extent | Todo | |
| 18 | Error copy with next steps | Todo | |
| 19 | Modal focus trap | Todo | |
| 20 | Micro-interactions motion spec (CSS-only) | Todo | |

## Larger Initiatives (blocked on a design decision)

| # | Item | Status | Notes |
|---|------|--------|-------|
| 21 | Visual identity: instrument vs glass | Awaiting decision | |
| 22 | Panel maximize (then maybe tabs) | Awaiting decision | Maximize alone could proceed; tabs need a call |
| 23 | Named layout presets | Awaiting decision | Topic-matching strategy undecided |
| 24 | 3D/canvas accessibility tier | Awaiting decision | Tier 1 recommended |
| 25 | Per-topic timeline lanes | Awaiting decision | Depends on item 14 landing first |
