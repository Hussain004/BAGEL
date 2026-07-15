# BAGEL UX / Design Review

Grounded in the actual source as of v1.6.7: `src/index.css` (design tokens), `App.tsx`, `layout/` (DropZone, Toolbar, Timeline, PanelGrid), `panels/` (PanelShell, ThreeDScene, TimeSeriesPlot, TopicInspector, TopicRow, ImageViewer, TFTree, RawMessageInspector), `modals/` (ModalShell, ShortcutsModal), `hooks/useKeyboardShortcuts.ts`, `hooks/useUrlState.ts`, `live/liveConnection.ts`, `store/*`.

---

## The three critics, in one paragraph each

**The skeptical HN commenter:** "So it's Foxglove without the parts that make Foxglove useful, wrapped in glassmorphism." That comment is coming, and right now BAGEL gives it ammunition: the workspace has an animated grid background, radial gradient orbs, gradient logo text, glow shadows, and shimmer keyframes, which reads as "2024 landing-page template" rather than "instrument I trust at 2am". The genuinely differentiated story (zero install, zero server, file never leaves the machine, works from a URL hash you can Slack to a teammate) is buried in a tagline. Worse: the README says "no data leaves your machine" while `index.css` line 2 pings Google Fonts on every load. An HN commenter will find that in four minutes and it will become the thread.

**The SLAM engineer mid-debug:** Opens a 4GB MCAP, gets a decent progress bar, lands on a genuinely good stats card. Then: no way to see *where in the timeline* the data is (no per-topic activity density, the single biggest tool for "when did my map go bad"), Esc closes the *most recently opened* panel rather than the one being looked at (loses a configured 3D view), the 3D Display card is 15 controls in a 224px popover in 10px lowercase mono, and switching to light theme for a sunlit lab leaves the plot axes invisible and the 3D viewport still dark navy. The power is all there; the ergonomics leak under pressure.

**The heuristic evaluator (Nielsen):** Strongest areas: visibility of system status (progress, per-panel loading/truncation footers), user control (bookmark rename with proper cancel semantics), error prevention (schema-missing rows route to the paste modal instead of opening a dead panel). Systematic failures: *consistency* (three different empty-state components, lowercase mono labels in 3D vs Title Case elsewhere, two different Follow-Live buttons), *recognition over recall* (drag-to-dock exists only as a `title` tooltip; the shareable-URL feature is invisible), and *accessibility as designed vs as shipped* (the very first interactive element on the landing page, the drop zone, has `role="button"` and `tabIndex={0}` but no key handler, so Enter does nothing).

---

## The actual design system (documented from source, not assumed)

**Typography:** Inter (300-900) for UI, JetBrains Mono (400-600) for data, both via Google Fonts `@import` in `src/index.css:2`. Type sizes used ad hoc: `text-[9px]`, `text-[10px]`, `text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`, `text-5xl`. The 3D Display card and footers run at 9-10px, below comfortable legibility.

**Color tokens (dark base, `@theme` in index.css):**

| Token | Value | Role |
|---|---|---|
| `--color-bg-primary / secondary / tertiary` | `#06080f` / `#0c1020` / `#111827` | page, panels, raised |
| `--color-surface (+hover/active)` | white @ 3 / 6 / 9% | interactive fills |
| `--color-border (+hover)` | white @ 8 / 15% | all strokes |
| `--color-accent-blue/cyan/violet/emerald/amber/rose` | `#3b82f6 #06b6d4 #8b5cf6 #10b981 #f59e0b #f43f5e` | semantic accents |
| `--color-text-primary/secondary/tertiary/muted` | `#f1f5f9 #94a3b8 #64748b #475569` | 4-step text ramp |

Light theme overrides shift accents to the Tailwind `*-700` tier and flips overlays to slate-alpha; badge text is re-pinned per badge class. Radii: 6/10/16/24px plus Tailwind defaults used interchangeably (`rounded-md`, `-lg`, `-xl`, `-2xl` all appear in panel chrome). Shadows: `shadow-panel`, `glow-blue`, `glow-cyan`. Named animations: `fade-in`, `fade-in-up`, `fade-in-scale`, `slide-in-left`, `pulse-border`, `shimmer`, `float`, `spin-slow`, `gradient-shift`, stagger delays 1-8. Spacing: raw Tailwind scale, no custom tokens.

**Verdict on the tokens themselves:** the palette is coherent and the two-theme variable strategy is genuinely good engineering. The problems are (a) escape hatches: uPlot axes (`#94a3b8`, `rgba(255,255,255,0.05)` grid in `TimeSeriesPlot/index.tsx:268-277`), the 3D clear color (`0x0c1020` in `useScene.ts:61`), and `SERIES_PALETTE` never read the tokens, so light theme silently breaks; and (b) the decorative layer (grid bg, orbs, shimmer, gradient text) sits on top of a data tool.

---

# Quick Wins (implementable in under a day)

### [P0] Self-host the fonts, or the privacy claim is false
- **Problem:** `index.css:2` `@import`s Google Fonts. The DropZone says "No data leaves your machine." Every page load sends the visitor's IP and referer to Google. HN will not be kind about this, and robotics users behind air-gapped lab networks get a FOUT/timeout on top. The `@import` is also render-blocking in the worst possible position (inside the bundled CSS).
- **Fix:** `npm i @fontsource-variable/inter @fontsource/jetbrains-mono`, import the weights actually used in `main.tsx`, delete the `@import`. Fully offline, faster first paint, claim becomes true.
- **Files affected:** `src/index.css`, `src/main.tsx`, `package.json`.
- **Implementation notes:** Zero test risk. Verify `font-display: swap` is in the fontsource CSS (it is by default). Bundle grows by the woff2 files but they cache forever and currently load from Google anyway.
- **Effort:** S

### [P0] The landing-page drop zone is not keyboard operable
- **Problem:** `DropZone.tsx:125-136` gives the drop area `role="button"` and `tabIndex={0}` but no `onKeyDown`. A keyboard user tabs to the first, largest, most important control in the app, presses Enter, and nothing happens. This undermines the accessibility pass at the front door.
- **Fix:** Add `onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!isLoading) fileInputRef.current?.click(); } }}`.
- **Files affected:** `src/components/layout/DropZone.tsx`.
- **Implementation notes:** Same pattern already used correctly in `TopicRow.tsx:194-199`, so this is consistency, not invention. No test risk.
- **Effort:** S

### [P0] Hover-only topic-row buttons are invisible to keyboard focus
- **Problem:** The per-topic panel buttons (`TopicRow.tsx:270-299`) are `opacity-0 group-hover:opacity-100`. They are still in the tab order, so a keyboard user tabs through buttons they cannot see, and the focus ring appears to float over the msgs/Hz numbers (which only fade out on *hover*, not focus).
- **Fix:** Add `group-focus-within:opacity-100` to the button strip and `group-focus-within:opacity-0` to the stats column.
- **Files affected:** `src/components/panels/TopicInspector/TopicRow.tsx`.
- **Implementation notes:** Pure class addition. Check `tests/components` for TopicRow snapshot tests; class-string changes may need snapshot updates.
- **Effort:** S

### [P0] Esc is a footgun: it closes panels the user didn't mean to close
- **Problem:** Global Esc closes the *most recently opened* panel (`useKeyboardShortcuts.ts:76-86`). Two traps: (1) the PanelShell export dropdown has no Esc handling of its own, so pressing Esc to dismiss the little menu destroys an entire panel; (2) "most recently opened" is not "the one I'm looking at". Mid-debug, closing a 3D panel you spent two minutes configuring (world frame, clip box, accumulation) is rage-inducing because there is no undo.
- **Fix:** Minimum viable: make the export menu (and any open transient popover like the 3D Display card) consume Esc via a `stopPropagation` keydown while open, so Esc peels UI in the expected order: menu, then modal, then panel. Follow-up worth doing in the same pass: a 5-second "Panel closed - Undo" toast, since layoutStore already has the leaf data to restore.
- **Files affected:** `src/components/panels/PanelShell.tsx` (ExportMenu), `src/components/panels/ThreeDScene/index.tsx` (ControlsCard), `src/hooks/useKeyboardShortcuts.ts`, optionally `src/store/layoutStore.ts` for undo.
- **Implementation notes:** The keyboard hook reads stores via `getState()` so ordering logic is easy to extend. Undo needs a `reopenPanel(leaf, position)` which `dockPanel` internals mostly provide. Store tests exist in `tests/store`, add one for reopen if implemented.
- **Effort:** S (Esc ordering) / M (with undo toast)

### [P1] Fix light theme inside the data surfaces (uPlot + 3D clear color)
- **Problem:** Toggling light theme restyles the chrome but not the data: uPlot axis stroke stays `#94a3b8` with a white-alpha grid (invisible on white), and the 3D viewport stays `#0c1020` navy (`useScene.ts:61`), so every 3D panel looks like a hole punched in a light UI. A "theme toggle" that only themes the chrome reads as unfinished, and this is the first thing a screenshot comparison against Foxglove (which themes its plots) will show.
- **Fix:** Read the resolved CSS variables (`getComputedStyle(document.documentElement).getPropertyValue(...)`) when constructing uPlot options and the Three.js clear color, and subscribe to `themeStore` to re-apply (uPlot: destroy/recreate on theme change is acceptable; Three: `renderer.setClearColor` + `renderOnce()` is one line).
- **Files affected:** `src/components/panels/TimeSeriesPlot/index.tsx`, `src/components/panels/TrajectoryPlot/index.tsx` (same pattern), `src/components/panels/ThreeDScene/useScene.ts`, `index.html` (`theme-color` meta is also hardcoded `#06080f`; update it from `applyTheme` in themeStore).
- **Implementation notes:** Keep `SERIES_PALETTE` as-is (vivid hues survive both themes, same rationale as the accent comment in index.css); only axes/grid/clear color need to follow the theme. Risk: uPlot recreate must preserve the saved `xRange` (already handled via `savedXRangeRef`). Component tests for plots may need a themeStore mock.
- **Effort:** S-M

### [P1] Make the shareable-URL layout feature discoverable
- **Problem:** `useUrlState.ts` already serializes the full layout tree, playhead, bag URL, and anchors into the hash. This is a genuinely differentiating feature ("send your teammate the exact cockpit at the exact timestamp", Foxglove needs an account for that), and there is zero UI acknowledging it exists. Nobody reads hashes.
- **Fix:** A "Copy link" button in the Toolbar (next to Export) that copies `location.href` and confirms with a transient "Link copied - restores this layout and playhead" tooltip. When the bag came from a URL (`b=` param), say so; when it's a local file, the tooltip notes "your teammate needs the same file".
- **Files affected:** `src/components/layout/Toolbar.tsx`, reuse the existing button styling there.
- **Implementation notes:** `navigator.clipboard.writeText`. The confirmation needs `aria-live="polite"`. No store changes, no test risk beyond one new component test.
- **Effort:** S

### [P1] Replace `transition-all` with explicit properties
- **Problem:** 19 files use `transition-all` or `transition: all` (`.dropzone`, `.topic-row` in index.css, and most buttons). `all` animates layout properties you never intended (padding, border-width changes trigger layout), and on the topic list, 500 rows each with `transition: all` plus a hover `translateX(2px)` is measurable jank on low-end laptops during scroll-hover.
- **Fix:** `transition-colors` for color-only hovers (most buttons), `transition: transform 0.15s, background-color 0.15s, border-color 0.15s` for `.topic-row`. Same visual result.
- **Files affected:** `src/index.css`, sweep of `transition-all` across `src/components/`.
- **Implementation notes:** Mechanical find/replace with eyes on. Snapshot tests that assert class strings will need updating; this is the biggest churn item of the quick wins, still under a day.
- **Effort:** S

### [P1] Typography and copy consistency pass
- **Problem:** Three-dot ellipses ("Parsing bag file...", "Connecting...", "Saving...") vs the typographically correct "…" used elsewhere ("Loading…" in DropZone already gets it right). Casing drifts per surface: Toolbar uses Title-ish case ("Add bag", "Set anchor"), the 3D Display card is all-lowercase ("color by", "point size", "limit range"), Timeline mixes ("speed", "align" lowercase mono). Toolbar stat values (`Toolbar.tsx` `Stat`) aren't `tabular-nums`, so live message counts jitter the layout as digits change width.
- **Fix:** One sweep: "…" everywhere a process is ongoing; pick lowercase-mono as the *deliberate* convention for in-panel dense controls and sentence case for chrome-level buttons, then apply it consistently (the split is defensible, the current randomness is not); add `tabular-nums` to every numeric stat (`Stat`, `RecordButton` count, plot footer).
- **Files affected:** `DropZone.tsx`, `Toolbar.tsx`, `Timeline.tsx`, `ThreeDScene/index.tsx`, `TimeSeriesPlot/index.tsx`.
- **Effort:** S

### [P1] Timeline slider: focusable and honest about its ARIA role
- **Problem:** `Timeline.tsx:229-243` sets `role="slider"` with full `aria-value*` (good) but no `tabIndex`, so the slider can never receive focus; arrow keys work only because of the *global* shortcut. Screen-reader users are told "this is a slider" and then can't operate it as one. Double-click-to-bookmark is also completely undiscoverable (nothing hints at it; the M shortcut is only in the shortcuts modal).
- **Fix:** `tabIndex={0}` on the track plus local ArrowLeft/Right/Home/End handling (delegate to the same playhead-store calls; guard against double-firing with the global handler by checking `e.currentTarget === document.activeElement`). Add `title="Click to seek, double-click to bookmark"` on the track as a minimal discoverability patch.
- **Files affected:** `src/components/layout/Timeline.tsx`, `src/hooks/useKeyboardShortcuts.ts`.
- **Effort:** S

### [P2] Cheap topic-list scroll performance
- **Problem:** A 500-topic bag renders 500 `.topic-row` DOM nodes, each with entry animations and hover transforms. No virtualization (only the Log panel is virtualized).
- **Fix:** `content-visibility: auto; contain-intrinsic-size: auto 52px;` on `.topic-row`. One CSS rule, browser-native lazy rendering. Skip a virtualization library.
- **Files affected:** `src/index.css`.
- **Implementation notes:** Verify the stagger animation still looks right for the first visible page (it will; delays cap at 0.6s). If `content-visibility` interacts badly with the fade-in, gate the animation to the first 20 rows, which is all anyone sees anyway.
- **Effort:** S

### [P2] Narrow-viewport stance: say no, gracefully
- **Problem:** The only responsive handling is toolbar wrap below 900px (`index.css:575`). On a phone, the panel grid is unusable (pointer-only docking, hover-only buttons), and pretending otherwise wastes effort.
- **Fix:** This should *not* be a mobile app, and the roadmap shouldn't chase it. Do the honest minimum: below ~700px, show a dismissible banner on the landing page ("BAGEL is built for desktop; things will be cramped here") and make sure nothing *breaks* (the Timeline controls already wrap poorly; `flex-wrap` on the timeline row fixes overflow). Total investment: an hour, then never think about phones again.
- **Files affected:** `src/components/layout/DropZone.tsx`, `src/components/layout/Timeline.tsx`.
- **Effort:** S

---

# Medium Effort (multi-day)

### [P0] One shared panel-state and overlay language (kills the "ten products" feel)
- **Problem:** The single biggest cohesion leak isn't the PanelShell (which is shared and good), it's everything inside it. `PanelLoadingState`/`PanelErrorState`/`PanelEmptyState` are copy-pasted with drift into `TimeSeriesPlot`, `TrajectoryPlot`, `ImageViewer`, while `TFTree` and `RawMessageInspector` each have their own differently-styled `EmptyState`. Floating overlay cards differ per panel: the 3D Display card is `bg-bg-primary/85 mono text-[10px] w-56`, the plot's controls live in a bottom chip bar, ImageViewer pushes toggles into `headerExtras`. Footers differ in padding and tone. Each panel is internally consistent and collectively dissonant, exactly the "ten products" symptom.
- **Fix:** Extract `src/components/panels/shared/PanelStates.tsx` (Loading, Error, Empty, with one icon set and one type scale) and `src/components/panels/shared/OverlayCard.tsx` (the floating in-canvas card: one bg, one radius, one 11px minimum font size, one header row with a disclosure chevron). Migrate all nine panels. Write down the rule the code already almost follows: *chrome text is sans, data text is mono; overlay controls are lowercase mono; nothing below 11px.*
- **Files affected:** all of `src/components/panels/*/index.tsx`, new `shared/` files.
- **Implementation notes:** Mostly deletion (five empty-state implementations become one). Biggest test risk of any item here: `tests/components` renders panels and may assert on text/classes; migrate tests alongside, panel by panel, not in one commit.
- **Effort:** M

### [P0] Progressive disclosure in the 3D Display card (the "wall of knobs")
- **Problem:** For a pointcloud topic the Display popover stacks: color mode, point size, limit range + slider, clip box + 6 numeric inputs, accumulate + mode + voxel size + per-frame + budget + stats + TF warning, namespaces, grid, axes, robot model, camera frustums + far slider + per-camera checkboxes, and save/reset/clear default actions, in one 224px-wide untitled column at 9-10px. A first-time user opens it and closes it again. The SLAM engineer *wants* all of it, but not as an undifferentiated stack.
- **Fix:** Keep the everyday four visible on open: color by, point size, grid, axes. Group the rest into collapsed disclosure sections with 10px uppercase headers: "Range and clipping", "Accumulation", "Overlays" (robot, frustums, namespaces). Persist each section's expanded flag in the existing `threeDPanelStore` settings so the power user who opens "Accumulation" once has it open forever (their density is preserved, one click away, and *remembered*). Move "Save as default / Reset" into a pinned footer of the card so it stops scrolling with content.
- **Files affected:** `src/components/panels/ThreeDScene/index.tsx` (ControlsCard), `src/store/threeDPanelStore.ts` (three booleans in settings), `src/store/panelDefaultsStore.ts` untouched.
- **Implementation notes:** Native `<details>`/`<summary>` covers this without a component; style the marker. Adding fields to persisted settings needs a default-merge for old stored state (the codebase already guards this pattern for `expressions` in panelUiStores). Store tests: add defaults-migration case.
- **Effort:** M

### [P0] Timeline data-density strip (the SLAM debugger's missing map)
- **Problem:** The timeline is a uniform bar. In a 40-minute bag the engineer cannot see where the camera dropped out, where /tf went quiet, or where the crash cluster is; they scrub blind. Foxglove and even `rqt_bag` show per-topic activity; this is the largest single functional gap versus the competition for the debugging use case, and it's also the feature that makes screenshots look serious.
- **Fix:** One aggregate density heatmap strip (2-3px tall, N=200 buckets, opacity mapped to message count) rendered above the existing track, computed once per bag from the topic index/summary data already in memory; per-topic strips stay out of scope (see Larger Initiatives). Annotation ticks already prove the layered-on-track pattern works.
- **Files affected:** `src/components/layout/Timeline.tsx`, plus a small `getMessageDensity(bagId, buckets)` in the parser worker API or derivable from existing chunk indexes in `bagStore`.
- **Implementation notes:** MCAP chunk indexes give message-count-per-time-range nearly free; db3 can query `count(*) group by` bucketed timestamps in the worker; ROS1 bag chunk info similar. Render as a single `<canvas>` strip, not 200 divs. Reduced-motion irrelevant (static). Test: one worker-API unit test per format in `tests/parsers`.
- **Effort:** M

### [P1] Docking discoverability and a keyboard path for panel management
- **Problem:** Drag-to-dock exists only as `title="Drag to dock this panel"` on the header (`PanelShell.tsx:131`). Nothing looks draggable (no grip glyph), a drop on the panel center silently cancels (deliberate, but nothing communicates it), and there is no keyboard alternative whatsoever for moving panels, which makes the drag-only layout system an accessibility dead end. Resize handles at least show dot-grips on hover.
- **Fix:** (1) Add a 6-dot grip glyph at the left of the panel header, always visible at low opacity, `cursor-grab`. (2) First time a drag starts per session, dim non-target panels slightly so the edge zones read as "places"; the existing `DropIndicator` covers the rest. (3) Keyboard path: a "Move panel" item behind a small chevron menu next to the close button (or Alt+Arrow when a panel header has focus) that calls the existing `dockPanel(sourceId, targetId, edge)` with the nearest sibling; make the header focusable (`tabIndex={0}`).
- **Files affected:** `src/components/panels/PanelShell.tsx`, `src/components/layout/PanelGrid.tsx`, `src/store/dragDockStore.ts` (session "hasDragged" flag), `src/store/layoutStore.ts` (a `movePanel(direction)` helper wrapping dockPanel).
- **Implementation notes:** No library. The layout tree already has everything; `movePanel` is a tree walk to find the adjacent leaf. Reduced-motion: the dim is opacity-only and static, fine as is. Tests: layoutStore is well tested; add `movePanel` cases there.
- **Effort:** M

### [P1] First 30 seconds: the sample bag should land on a cockpit, not a menu
- **Problem:** "Try a sample bag" is the right instinct, and the post-load stats card is good, but the payoff is delayed: the new user still has to discover that clicking a topic row opens a panel (the hint is one quiet line of text). The wow moment, 3D points + camera + plot moving in sync under one playhead, is three undiscovered clicks away. On HN, most people give a tool 60 seconds.
- **Fix:** The URL-hash layout encoder already exists (`useUrlState.ts` encodes `H(P3d:...,V(Pimage:...,Pplot:...))`). Make `SampleBagButton` apply a curated layout + playhead after load: 3D scene left, image top-right, plot bottom-right, playhead parked at the most photogenic moment, playing. Add a dismissible one-time coach line over the sidebar: "Click any topic to open more panels. Drag a panel header to rearrange." Two sentences, not a tour library.
- **Files affected:** `src/components/layout/DropZone.tsx` (SampleBagButton), `src/store/layoutStore.ts` (an `applyLayout(tree)` likely already exists for URL restore, reuse it), `scripts/build-sample-bag.mjs` only if the tour bag needs a better money-shot segment.
- **Implementation notes:** Do it by dispatching the same code path URL-restore uses, so there is exactly one layout-deserialization path to maintain. Zero new deps. Test: one integration test in `tests/integration` asserting sample load produces the expected tree.
- **Effort:** M

### [P1] Live-connection status: consolidate, announce, and expose the buffer
- **Problem:** Live state is currently: an 8px pulsing dot in a bag chip (tooltip-only detail), a Follow/Live button in the Toolbar, and a *second, differently-styled* Follow button in the Timeline, plus `followLive` (with labels hidden below `xl`, meaning most laptops see two unlabeled toggles). Reconnection (`liveConnection.ts`, exponential 1s→30s backoff) is invisible beyond the amber dot; there is no aria-live anywhere, so state changes are silent to screen readers; and the extent of the ring buffer (what history you can actually scrub) is not shown on the timeline at all. Whether you're looking at live, paused-recent, or historical data is the *core* mental model for live mode, and it's carried by dot color alone, which also fails colorblind users since connecting/connected differ only amber/emerald.
- **Fix:** (1) Delete the Toolbar `FollowLiveButton`; the Timeline is where time control lives, one toggle, always labeled. (2) Reconnecting state gets text in the chip: "reconnecting (3)" with attempt count from the store, not just a dot, and the dot gains a shape difference (hollow ring = not connected, solid = connected) for colorblind safety. (3) One visually-hidden `aria-live="polite"` region fed by liveStore status transitions ("Connected to robot.local", "Connection lost, retrying in 8 seconds"). (4) Tint the scrubbable buffer extent on the timeline track (the ring buffer's start..end as a lighter band) so "what can I scrub" is visible; when followLive is off, show a "Back to live" pill at the track's right edge.
- **Files affected:** `src/components/layout/Toolbar.tsx`, `src/components/layout/Timeline.tsx`, `src/store/liveStore.ts` (expose attempt count + buffer range; `useLivePlayhead` already tracks the range), `src/live/liveConnection.ts` (surface attempt number in status message).
- **Implementation notes:** Pulse animation already respects reduced-motion via the global kill, but after that kill the *only* state signal was color, which is exactly why the shape difference matters. Tests exist in `tests/live`; extend for attempt-count surfacing.
- **Effort:** M

### [P1] Error copy that says what to do next
- **Problem:** Failure modes mostly end in a raw message under a generic heading ("Failed to parse bag file" + exception text in DropZone; `PanelErrorState` prints worker errors verbatim). The critical robotics-specific cases each have a known next step the UI doesn't offer: db3 with missing schemas (the schema-paste modal exists!), URL loads failing CORS (needs `Access-Control-Allow-Origin` + Range support explanation), URDF `package://` meshes unresolvable (UrdfLoadModal already explains this one well, proving the pattern), multi-GB `.bag` ROS1 files that will be slow (warn early). A malformed-file error that just prints `RangeError: offset is out of bounds` reads as "this tool is broken", not "this file is truncated".
- **Fix:** An error-classifier in `bagStore` mapping known failure signatures to structured errors `{ title, detail, action? }`, where `action` is a real button (e.g. "Paste schema…" opening the existing modal, "How to enable CORS" linking the README section). Unknown errors keep the raw message but gain "Copy error details" for bug reports.
- **Files affected:** `src/store/bagStore.ts`, `src/components/layout/DropZone.tsx`, `src/components/panels/*/index.tsx` error states (folds into the shared `PanelStates.tsx` item above, do them together).
- **Implementation notes:** Signature matching on error strings is brittle but fine here since the parsers are in-repo; better, have parsers throw typed errors with a `code`. The 526-test suite covers parser error paths, so new typed errors must keep messages compatible or update those asserts deliberately.
- **Effort:** M

### [P2] Modal focus trap (the comment has aged out)
- **Problem:** `ModalShell.tsx:24-26` says a full trap is "overkill for the two short modals BAGEL ships". There are now eight, including real forms (UrdfLoadModal, BagEditModal, ClipExportModal, SchemaPasteModal with a textarea). Tab walks out of the dialog into the obscured app behind it while `aria-modal="true"` tells screen readers the background doesn't exist; the two contradict each other.
- **Fix:** Minimal trap in ModalShell: on Tab/Shift+Tab, query focusable descendants and wrap at the edges (12 lines), keep the existing focus-restore-on-close which is already correct. No library.
- **Files affected:** `src/components/modals/ModalShell.tsx` only (every modal inherits).
- **Implementation notes:** Also update the stale comment. Component tests in `tests/components` for modals: add one Tab-wrap assertion.
- **Effort:** S-M (S if no test additions were needed, the tests push it up)

### [P2] Micro-interactions: the concrete motion spec (CSS-only, no new dependency)
- **Problem:** Motion today is entry-only and slightly slow (0.3-0.5s ease-out fades everywhere, panels `animate-fade-in-scale` 0.3s), there are zero exit animations (panels vanish abruptly, jarring in a dense grid because siblings snap-resize), the `DropIndicator` uses `transition-all`, and the playhead knob has hover-scale but no drag feedback.
- **Fix, per interaction, each with its reduced-motion fallback stated:**
  - **Panel open:** keep `fade-in-scale`, tighten to 180ms with `scale(0.97)→1` and 4px rise. *Reduced motion:* opacity-only fade at 0.01ms (already delivered by the existing global kill).
  - **Panel close:** before `closePanel` commits, apply a `.panel-exit` class (120ms, opacity→0 + `scale(0.98)`) and remove the leaf on `animationend`, with a 150ms `setTimeout` safety net so the store never waits on a missing event. *Reduced motion:* the global kill collapses it to instant removal, which is exactly correct.
  - **Dock drop:** replace the indicator's `transition-all` with `opacity 120ms, transform 120ms`; on successful drop, run a single 250ms border-color pulse on the landed panel (reusing `pulse-border` at 1 iteration). *Reduced motion:* no pulse; the layout change itself is the confirmation.
  - **Live status dot:** keep `animate-pulse` while connected/connecting. *Reduced motion:* static dot, state carried by the hollow/solid + color scheme from the live-status item above, so no information rides on motion.
  - **Timeline scrub:** never animate playhead position while dragging (input latency reads as lag). Instead: knob `scale(1.3)` while `isDragging` (transform-only), and a time tooltip following the pointer during hover/drag (position via `transform: translateX`, no layout reads beyond the one `getBoundingClientRect` already done per event). *Reduced motion:* tooltip still appears (it's information), knob scale drops.
  - **Discrete seeks** (bookmark click, Home/End, arrow keys): 150ms `width` ease on the progress fill so the jump reads as travel, applied via a short-lived class only on discrete seeks, never during RAF playback or drag. *Reduced motion:* instant jump.
- **Library recommendation:** none. CSS transitions/keyframes cover every item above at 0KB. Framer Motion is ~32KB gzipped and React Spring ~12KB, and their value (interruptible spring physics, FLIP layout animation) only pays off if animating the *grid reflow* when panels dock, which react-resizable-panels controls anyway. The existing `prefers-reduced-motion` global kill in `index.css:560` remains the single enforcement point, which is a feature: no per-component motion audit can be forgotten.
- **Files affected:** `src/index.css`, `src/components/panels/PanelShell.tsx`, `src/components/layout/PanelGrid.tsx` (DropIndicator), `src/components/layout/Timeline.tsx`, `src/store/layoutStore.ts` (deferred close).
- **Implementation notes:** The deferred-close is the only structurally risky bit (store mutation timing); layoutStore tests must cover "close during close". Everything else is classes.
- **Effort:** M (S without the exit animation)

---

# Larger Initiatives (need a design decision from you first)

### [P1] Visual identity: instrument, not landing page
- **Problem:** Inside the workspace, BAGEL keeps landing-page decor: `bg-grid` + `bg-gradient-radial` behind the panel grid, glassmorphism blur on every panel over that animated-feeling backdrop, gradient logo text in the toolbar, glow shadows. The index.css header literally self-describes as "Premium dark theme with glassmorphism". The skeptical HN read: BAGEL currently *dresses like* Foxglove's marketing site rather than differentiating from Foxglove's product. Its real identity, "the one that's instant, private, and disposable: no install, no account, no server, file stays local", is a *utilitarian* identity, and the visual language should feel like a calibrated instrument: quieter surfaces, higher data-ink ratio, decoration reserved for the landing DropZone where it does honest marketing work.
- **The decision I need from you:** Commit to "workspace = instrument, landing = brand" (my recommendation: keep DropZone's orbs/gradients exactly as they are, strip `bg-grid`/`bg-gradient-radial`/backdrop-blur from `PanelGrid` and panels, solid `bg-bg-secondary` panels, keep the accent system), or double down on the glass aesthetic as the brand and accept the "template" jabs. Half-measures get the worst of both. This gates several medium items above (the shared OverlayCard should be built to whichever answer you pick).
- **Files affected (if instrument):** `src/index.css`, `src/components/layout/PanelGrid.tsx`, `src/components/panels/PanelShell.tsx`, `src/App.tsx` (EmptyPanelState backdrop).
- **Implementation notes:** Also a GPU win: backdrop-filter over a full-viewport gradient is one of the most expensive things a compositor does, and it's under every panel during 3D playback.
- **Effort:** L (as a deliberate, screenshot-everything pass)

### [P1] Panel maximize, then maybe tabs
- **Problem:** The layout tree supports splits only. Two consequences: no temporary "let me look at just the 3D scene" (Foxglove, RViz, VSCode all have a maximize gesture), and no tabbed stacking for low-priority panels (Raw, Log) that currently steal grid space. Mid-debug, maximize is the one users will miss within the first hour.
- **The decision I need from you:** (a) Maximize only: double-click panel header (plus a header button for discoverability) overlays that leaf full-grid; cheap, no layout-tree change, no URL-schema change. (b) Full tab-stacking: a new `tabs` node type in `LayoutNode`, touching `layoutStore`, `dockPanel`, `PanelGrid`, `useUrlState`'s hash schema (with back-compat parsing), and their test suites. My recommendation: ship (a) now, decide on (b) only if users ask; (b) is the single most invasive UI change on this list and permanently complicates the hash format.
- **Files affected:** (a) `layoutStore.ts` (a `maximizedId` field), `PanelGrid.tsx`, `PanelShell.tsx`. (b) all of the above plus `useUrlState.ts` and `tests/store`, `tests/hooks`.
- **Effort:** M for maximize alone, L for tabs

### [P2] Named layout presets ("SLAM debug", "camera rig", …)
- **Problem:** The URL hash makes layouts shareable but not *keepable*: power users rebuild the same cockpit per bag. A preset that opens /tf + /map + odom trajectory + a plot in one click is the repeat-user retention feature.
- **The decision I need from you:** Topic matching strategy. Presets saved from real layouts reference exact topic names (`/camera/front/image_raw`) which won't exist in the next bag. Options: exact-name matching with silent drop of missing topics (simple, often disappointing), type-based slots ("first Image topic", "first OccupancyGrid", smarter, occasionally wrong), or slots with a quick reassignment prompt on apply. Also: localStorage-only vs exportable JSON. I'd take type-based slots + localStorage, but this changes how layouts serialize, so it deserves your call before anyone builds.
- **Files affected:** new `presetStore`, `Toolbar.tsx`, reuse of the `useUrlState` tree codec.
- **Effort:** L

### [P2] How far to take 3D/canvas accessibility
- **Problem:** The 3D scene is a `<canvas>` with pointer-only orbit controls and one aria-label in 2,400 lines; the Splat viewer likewise; uPlot's canvas has no text alternative. Honest framing: every tool in this genre (RViz, Foxglove, Grafana's newer panels) is also bad here, so this is an *exceed-the-genre* decision, not a parity gap, and it's real scope.
- **The decision I need from you:** Pick a tier. Tier 1 (cheap, do regardless): keyboard camera controls when the 3D panel has focus (arrows orbit, +/- zoom, F re-fit), a visually-hidden live region summarizing the scene ("212,000 points, frame `map`, 3 markers"), `aria-label` on the canvas naming topic and kind, plot panels get a data summary (min/max/last per visible series) in a hidden table. Tier 2 (a project): sonification/haptics or full non-visual navigation, which I do not recommend for a solo-maintained tool at this stage. If you pick Tier 1, it can ride along with the docking-keyboard-path item since both touch focus handling.
- **Files affected (Tier 1):** `ThreeDScene/useScene.ts` (camera controls), `ThreeDScene/index.tsx`, `TimeSeriesPlot/index.tsx`, shared live-region utility.
- **Effort:** M-L depending on tier

### [P2] Per-topic timeline expansion (beyond the aggregate density strip)
- **Problem:** The medium-effort density strip answers "where is data at all"; SLAM debugging eventually wants "where is data *per topic*" (camera dropouts vs TF gaps at a glance), which is a Foxglove-parity feature with real layout cost: N topic lanes need vertical space the current 1-row timeline doesn't have.
- **The decision I need from you:** Where does it live? An expandable timeline drawer (click a chevron, timeline grows to ~160px showing lanes for pinned topics), a dedicated "Timeline" panel kind inside the grid (consistent with the panel model, but then it duplicates the global playhead UI), or fold it into Bag Health (already computes per-topic gaps/Hz, but is a diagnostic view, not a scrub surface). My lean: expandable drawer with lanes for *pinned* topics only (pin from TopicRow), capped at ~8 lanes.
- **Files affected:** `Timeline.tsx`, `bagStore`/worker density API from the medium item, `TopicRow.tsx` (pin affordance).
- **Effort:** L

---

## What I deliberately did not flag

For completeness of the audit, things that are *fine* and should not be churned: the Zustand store decomposition (clean boundaries, `getState()` discipline in event handlers), the worker-per-bag parsing architecture, the schema-missing → paste-modal flow (genuinely better than Foxglove's dead-end for db3), the bookmark rename UX (correct create-vs-rename cancel semantics), the export menu's honest message-limit disclosure, the URL-hash back-compat parsing, the focus-restore in ModalShell, `Separator` resize handles (react-resizable-panels ships keyboard resize on its separators), and the light-theme token override strategy in index.css, which is the right architecture even though three consumers (uPlot, Three.js clear color, series palette) currently bypass it.
