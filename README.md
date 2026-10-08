<div align="center">

<img src="public/favicon.svg" width="80" alt="BAGEL Logo" />

# BAGEL

### BAG ExpLoration: ROS Bag File Web Visualizer

**Explore ROS1 & ROS2 bag files in your browser. No installation required.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178c6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff.svg)](https://vite.dev/)
[![Version](https://img.shields.io/badge/version-1.7.1-3b82f6.svg)](https://github.com/Hussain004/BAGEL/releases)

[**→ Live Demo**](https://bagel-ros2.vercel.app) · [Report Bug](https://github.com/Hussain004/BAGEL/issues) · [Request Feature](https://github.com/Hussain004/BAGEL/issues)

</div>

---

## What is BAGEL?

**BAGEL** is a fully static web application that lets you explore ROS bag files (`.mcap`, `.db3`, `.bag`), standalone point cloud files (`.pcd`, `.ply`), and 3D Gaussian Splat scenes (`.ply`, `.splat`, `.ksplat`) entirely in your browser needing no server, no installation, no account. Just drag and drop!

Robotics engineers and researchers frequently generate bag files during experiments, SLAM runs, and sensor calibration. Inspecting these files currently requires a full ROS1 or ROS2 installation, Foxglove Studio (increasingly commercial), or writing custom Python scripts for every inspection task.

BAGEL eliminates this friction.

### Why BAGEL?

| Problem | BAGEL Solution |
|---|---|
| Need ROS1/ROS2 installed to inspect bag files | Works in any modern browser |
| Foxglove Studio going commercial | 100% open source, MIT licensed |
| `ros2 bag info` gives text-only output | Rich visual interface with search & filtering |
| Can't share bag contents easily | Zero-install, you can send anyone the URL |
| Students struggle with ROS tooling | No setup required, just drag and drop |
| Legacy ROS1 bags require old toolchains | Drag the `.bag` straight in (no conversion needed) |

---

## Demo

### Quick tour with the bundled sample bag

https://github.com/user-attachments/assets/a6078f92-e461-4a90-8af3-f3cedb521621

> Data featured in this demo is from the excellent open-access **M2DGR dataset** provided by the **SJTU-ViSYS team**, which was instrumental in stress-testing this visualizer's spatial rendering capabilities.

---


## Features

A condensed feature list is below. **Detailed version-by-version release notes (with the design rationale behind every feature) live in [FEATURES.md](FEATURES.md).**

### File formats and live sources

| Format | Notes |
|---|---|
| ROS2 `.mcap` | Including `zstd`-compressed chunks (the new ROS2 default). Foxglove Studio JSON-encoded channels (`schemaEncoding: "jsonschema"`, `encoding: "json"`) supported from v1.6.1. |
| ROS2 `.db3` | SQLite via `sql.js` / WASM |
| ROS1 `.bag` | Including `bz2` and `lz4` compressed chunks |
| Split recordings | Pick or drop all the parts of a `ros2 bag record --max-bag-size` run (`name_0.mcap`, `name_1.mcap`, ...), a ROS1 `--split` recording, or the bag folder itself, and they open as one recording. Works for `.mcap`, `.db3` and `.bag`. |
| Remote URLs | HTTP Range requests, so only the chunks you scrub through hit the network. `.mcap` / `.bag` stream lazily; `.db3` eager-fetches (sql.js needs it in memory). |
| **Foxglove WebSocket** *(v1.5.0)* | Paste a `ws://` or `wss://` URL to connect to a live robot running `foxglove_bridge` or `rosbridge_suite`. All panels update in real time. Per-topic ring buffer holds the last 10,000 messages per topic; Follow/Pause button lets you scrub back into history without disconnecting. Auto-reconnect with exponential backoff. |
| **`.pcd` point clouds** *(v1.6.0)* | All three PCD 0.7 encodings: `ascii`, `binary`, `binary_compressed` (LZF). All color modes (height, intensity, rgb, single). Feeds directly into the ThreeDScene panel via a synthetic `sensor_msgs/PointCloud2` message. |
| **`.ply` point clouds** *(v1.6.0)* | ASCII + `binary_little_endian` + `binary_big_endian`. RGB from `red`/`green`/`blue` uchar properties or packed `rgb` float. Drop a `.ply` and the cloud appears instantly in the 3D panel with all existing color, range-filter, and accumulator settings. |
| **Gaussian Splats** *(v1.7.0)* | Splat-flavored `.ply` (detected by header, not extension - a plain colored-point-cloud `.ply` still opens in the regular 3D panel), plus `.splat` and `.ksplat`. Opens in a dedicated Splat panel with outlier-robust camera auto-fit, shift+click custom orbit pivot, keyboard fly-through and orbit controls (W/S/A/D/Q/E/R/F/Z/C), `B`/`N`/`I`/`K`/`U`/`J` shortcuts to spin the splat itself on all three axes instead of moving the camera, and a `V` shortcut to cycle up-axis orientation presets. |

### Visualization panels

- **TimeSeriesPlot**: chart any numeric leaf field (`linear.x`, `orientation.w`, etc.) on uPlot. Math expressions as derived series: type `field_a * 2 + field_b` in the series editor to plot any arithmetic combination of fields from the same topic without writing code. *(v1.4.1)*
- **ImageViewer**: `sensor_msgs/Image` (`rgb8` / `bgr8` / `rgba8` / `mono8` / `mono16`) and `CompressedImage` (`jpeg` / `png`) with lazy single-message reads. Foxglove equivalents (`foxglove.RawImage`, `foxglove.CompressedImage`) supported via JSON schema translation. *(v1.6.1)* H264/H265 video via `foxglove.CompressedVideo` using the browser's WebCodecs `VideoDecoder` with a fast keyframe index for efficient seeking. *(v1.6.2)* Scroll to zoom (cursor-centered), drag to pan, double-click to reset; zoom percentage shown in the footer. *(v1.6.3)* Optional `sensor_msgs/CameraInfo` overlay (principal-point reticle + focal-length badge + calibration-likely-unfilled chip) toggles from the panel header. *(v1.3.2)* `undistort` button applies per-frame plumb-bob (Brown-Conrady) undistortion using the paired CameraInfo's D coefficients. *(v1.3.4)*
- **ThreeDScene** (Three.js): `PointCloud2`, `LaserScan`, `MarkerArray` (all twelve primitives: `CUBE` / `SPHERE` / `CYLINDER` / `ARROW` / `LINE_STRIP` / `LINE_LIST` / `CUBE_LIST` / `SPHERE_LIST` / `POINTS` / `TEXT_VIEW_FACING` / `MESH_RESOURCE` / `TRIANGLE_LIST` from v1.3.1), `OccupancyGrid`, pose markers, **camera frustums** for every `sensor_msgs/CameraInfo` topic with per-camera hide checkboxes on multi-camera rigs (v1.3.2 / v1.3.4). Custom orbit pivot, range filter, point accumulation, configurable up-axis.
- **Spatial topic layers** *(v1.7.1)*: Open any 3D panel, then use `Display` > `Overlays` > `scene topics` to add maps, point clouds, laser scans, and odometry or pose topics to the same TF-aligned scene. This supports workflows such as an `OccupancyGrid` base map with live LiDAR points and the robot odometry pose on top. Per-overlay point size and flat-color overrides keep stacked layers visually distinct. A top-down orthographic 2D projection mode (with a zoom slider synced to scroll/pinch) reads an overlaid scene like a floor plan instead of a 3D orbit.
- **SplatViewer** *(v1.7.0)*: dedicated 3D Gaussian Splat renderer for splat-flavored `.ply` / `.splat` / `.ksplat` files, built on `@mkkellogg/gaussian-splats-3d`. Outlier-robust camera auto-fit (ignores stray "floater" splats a naive bounding-box fit would get wrecked by), shift+click custom orbit pivot, and keyboard fly-through: `W`/`S` forward-back, `A`/`D` strafe, `Q`/`E` turn, `R`/`F` up-down, `Z`/`C` orbit around the pivot, active while hovering the panel. `B`/`N`, `I`/`K`, `U`/`J` spin the splat itself around the pivot on the Z/X/Y axes respectively, instead of moving the camera - useful for viewing it from a new angle or correcting a multi-axis tilt without the camera's perspective changing. `V` cycles up-axis orientation presets, since gaussian-splatting exports don't follow one universal up-axis convention.
- **TrajectoryPlot**: Odometry / Pose / PoseWithCovariance / TransformStamped / NavSatFix as a 2D polyline, with an opt-in OpenStreetMap tile underlay for GPS traces.
- **TFTree**: `/tf` + `/tf_static` hierarchy with current transforms at the playhead time.
- **DiagnosticArray**: swimlane timeline + at-playhead inspector for `diagnostic_msgs/DiagnosticArray`. *(v1.0)*
- **Log (rosout)**: virtualised list for `rcl_interfaces/Log` and `rosgraph_msgs/Log` with severity, node-name, and full-text filters. *(v1.0)*
- **RawMessageInspector**: collapsible JSON tree of the deserialized message at the playhead.

All panels resolve `header.frame_id` through `/tf` + `/tf_static` against a user-selected world frame.

### Multi-bag overlay

- Drop multiple bags into the same session; each gets a colour tint that flows through every panel.
- **Three time-alignment modes**: `wall-clock`, `bag-start`, and `anchor` (with a "Set anchor" picker UI in v1.0 so you can lock runs to a physical sync event).
- **Per-bag parser Web Worker** so parsing bag B doesn't queue behind bag A's decode.

### Layout, sharing, and export

- **Drag-to-dock** VSCode-style panel layout. Per-panel state (3D display settings, plot zoom, TF selection) survives docking.
- **Sharable URL hashes** encode layout + playhead + bag URL + per-bag anchors. v0.5 / v0.7 / v0.9 hash forms still parse, so old links keep working.
- **Per-topic CSV / NDJSON export** from every panel header.
- **Bag editing / MCAP clip export**: trim the time range, drop topics you don't need, download a fresh indexed `.mcap`. Replaces the `mcap filter` CLI workflow for the common cuts. **v1.2 extends the editor to ROS1 `.bag` and ROS2 `.db3` inputs** alongside MCAP - output is always MCAP regardless of input format. `.db3` topics whose type isn't in BAGEL's bundled registry are flagged in the modal and excluded by default; opt them in to include them with a schema-less channel. *(v1.1 / v1.2)*
- **Paste-your-own `.msg` schema** flow for ROS2 `.db3` topics whose types aren't in the bundled registry. Persisted across sessions in `localStorage`.
- **Clip export**: Export button in the Toolbar renders any open panel (Image, Plot, Trajectory, or 3D Scene) frame-by-frame to a PNG zip or MP4 video (WebM fallback on browsers that cannot record MP4). Uses a frame-sync protocol (seek playhead, 2x rAF + 250 ms settle, `canvas.toBlob()`) so every panel type captures correctly. PNG frames are zipped with `fflate` at level 0 (no re-compression of already-deflated PNGs); video uses a two-phase `MediaRecorder` + `captureStream(0)` + `requestFrame()` approach so video playback speed is always correct. *(v1.4.2)*
- **Timeline bookmarks**: drop named markers at any timestamp on the scrubber (double-click the bar, click the `+` button, or press `M`), click a tick to seek, hover to see the label. Bookmarks persist to `localStorage` per bag and are encoded in the URL hash (`bm=`) for sharing. *(v1.4.3)*

### Robot model (URDF) overlay *(v1.3.0)*

- **Drop a `.urdf` and the robot appears in every 3D panel**, anchored to its root link in world space via the bag's `/tf` stream. Joints animate from `sensor_msgs/JointState` (auto-detected) when the bag publishes it; static URDFs render at their rest pose. A toolbar "Robot" button opens the load modal; the Display card in each 3D panel grows a per-panel `robot model` hide toggle.
- **Geometry support**: box / cylinder / sphere primitives + `.stl` / `.dae` / `.obj` meshes. Loaders are lazy-imported on first use of each file type so primitives-only URDFs don't pay the Collada loader's bundle cost.
- **`package://` resolver**: paste a URL prefix or drag-drop a folder per referenced package; URL bindings persist across sessions in `localStorage` under `bagel:package-roots:v1`. No auto-fetch from ROS distros - BAGEL only loads meshes from where you point it.
- **Bundled sample robot URDF** (`public/sample-bags/sample-robot.urdf`) pairs with `tour.mcap` so the "Try a sample robot" button in the modal demonstrates the full flow on a fresh checkout.

### Live robot data *(v1.5.0 - v1.5.6)*

- **Foxglove WebSocket client**: connect to a live robot by pasting a `ws://host:8765` URL into the new "Connect" input. Works with `foxglove_bridge` (ROS2) and `rosbridge_suite` (ROS1/ROS2). Implements `foxglove.websocket.v1` - binary MESSAGE_DATA frames for message payloads, JSON frames for topic advertisement.
- **Per-topic ring buffer**: the last 10,000 messages per topic are held in memory. All existing panels (Image, Plot, 3D Scene, Trajectory, TF Tree, Log) display live data without any panel-level changes - the hooks detect a live entry and read from the ring buffer instead of the parser worker.
- **Follow / Pause mode**: the timeline's Follow button (also in the Toolbar chip) keeps the playhead at the live edge. Press Pause to scrub back through buffered history; press Follow to snap forward again.
- **Auto-reconnect**: exponential backoff on disconnect: 1s, 2s, 4s, 8s, 16s, 30s. Connection status shown as a pulsing dot (emerald = connected, amber = reconnecting, rose = error) on the toolbar chip.
- **CDR and JSON decoding** in the main thread. ROS2 CDR via `@foxglove/rosmsg2-serialization`, ROS1 CDR via `@foxglove/rosmsg-serialization` - both already bundled as bag-parsing dependencies, no new packages. *(v1.5.3 adds `encoding: "ros1"` for ROS1 bridges)*
- **Live MCAP recording** *(v1.5.2)*: `Record` button in the Toolbar (visible when a live connection is active) buffers every incoming message. Click `Stop` to serialize all captured data to a fully-indexed MCAP file and download it instantly. The output opens back in BAGEL or any `mcap`-compatible tool without conversion.
- **Recording size limit + topic filter** *(v1.5.5)*: 500 MB hard cap auto-stops the recording and downloads immediately. A filter icon lets you select a subset of topics before recording starts. Byte count turns amber above 400 MB as a warning.
- **Sim clock support** *(v1.5.4)*: when `/clock` is advertised, messages with `logTimeNs = 0` (common in Gazebo/Isaac Sim) use the simulation clock value instead of wall-clock time, keeping plots readable in simulation sessions. A `SIM` badge appears on the toolbar chip.
- **Cross-bag health comparison** *(v1.5.6)*: the Health panel shows a chip strip at the top when multiple bags are loaded. Click any chip to switch the stats view to that bag without opening a new panel. Active chip is highlighted; live bags are excluded.

### Analysis tools *(v1.4)*

- **Bag Health dashboard** *(v1.4.0, extended v1.5.6)*: a per-topic analytics panel showing measured Hz, jitter (standard deviation of inter-message gaps), gap events (pauses longer than 3x the expected period), and bandwidth (bytes/s). Opens from a `Health` button in the Toolbar. Data is computed once per bag in a background scan and cached. *(v1.5.6)* When multiple bags are loaded, a chip strip at the top lets you switch the view between bags without opening additional panels.
- **Math expressions in plots** *(v1.4.1)*: type arithmetic expressions (`vel_x * 2 + offset`, `sqrt(x*x + y*y)`) as derived series directly in the TimeSeriesPlot panel. References other numeric fields from the same topic; evaluated in a sandboxed expression engine (no `eval`).
- **Clip export** *(v1.4.2)*: render any panel to an animated PNG zip or MP4 video (WebM fallback) via a frame-sync protocol. Toolbar Export button opens the modal.
- **Timeline bookmarks** *(v1.4.3)*: named markers on the scrubber, persisted per bag and shareable via the `bm=` URL hash segment.
- **`bagel-check` CI gate**: a headless command line tool and GitHub Action that fail a pipeline when a recording is missing a topic, publishes too slowly, has a long gap, or is too short. See [docs/BAGEL_CHECK.md](docs/BAGEL_CHECK.md).

### UX and quality

- **Light + dark themes** (toggle in the toolbar; persisted per browser). *(v1.0)*
- **Keyboard shortcuts**: `Space` to play, `← / →` to step, `L` to loop, `M` to bookmark *(v1.4.3)*, `Esc` to close panels, `T` to focus topic search, `O` to open a bag, `?` for the cheat-sheet.
- **Loop playback**: a `Timeline` toolbar toggle wraps the playhead back to start at end-of-bag instead of pausing, persisted across reloads. *(v1.3.3)*
- **Saved Display defaults**: per-data-type defaults for the 3D panel's Display card (colour mode, accumulator, point size, range filter, up axis, camera-frustum master toggle), persisted across sessions. Manageable from the About modal. *(v1.3.3 / v1.3.4)*
- **Accessibility pass**: ARIA roles + focus management on every modal, `prefers-reduced-motion` respected, focus-visible rings throughout.
- **Bundled `tour.mcap` sample bag** exercises every panel type. Drop in zero seconds with the "Try a sample bag" button.
- **854-test Vitest suite** plus Playwright browser tests, with GitHub Actions CI running `tsc -b`, lint, `pnpm test`, and the e2e job on every PR. *(v1.0, expanded each release)*
- **Recent files** *(B4)*: reopen a recently opened bag in one click from the landing page. Local files reopen through a persisted file handle (one permission prompt, no picker round trip); remote URLs reopen directly. Capped at 8, dismissed entries are forgotten.
- **Sidebar namespace tree and type chips**: switch the topic list between the flat list and a tree grouped by namespace, with single-child chains collapsed (`/robot1/sensors/lidar` is one row) and message counts and Hz rolled up so a dead namespace is obvious without expanding it. Type chips ("Images 4", "Point clouds 2", ...) filter either view.
- **Bags well over 2 GB work in the browser**: range reads + lazy decoding throughout the parser stack.

> Looking for the long version with implementation notes and design tradeoffs for each release? See **[FEATURES.md](FEATURES.md)**. Per-version summaries are in **[CHANGELOG.md](CHANGELOG.md)**.

---

## Roadmap

BAGEL is maintained in the open. Planned work is tracked as GitHub issues
labelled [`roadmap`](https://github.com/Hussain004/BAGEL/labels/roadmap), and
the reasoning behind each one lives in
[`ROADMAP_UPGRADES.md`](ROADMAP_UPGRADES.md), which sizes every item and lists
the files and tests it would need. Issues labelled
[`good first issue`](https://github.com/Hussain004/BAGEL/labels/good%20first%20issue)
are the deliberately small ones.

Known limitations and ideas that are not yet scheduled:

| Idea | Notes |
|---|---|
| [Fisheye / equidistant undistortion](https://github.com/Hussain004/BAGEL/issues/120) | v1.3.4 covers plumb-bob (~95% of bags). `fisheye` and `equidistant` (Kalibr) need different remap math. |
| [Collada texture resolution](https://github.com/Hussain004/BAGEL/issues/119) | `.dae` files reference textures by relative path; the mesh loader handles the mesh but not its textures. |
| [Zstd-compressed edit output](https://github.com/Hussain004/BAGEL/issues/121) | Edited bags are always uncompressed since `fzstd` is decompress-only, so output is 2-4x larger than the source. |
| [Plugin panels](https://github.com/Hussain004/BAGEL/issues/122) | User-built views against a stable panel API. Gated on the panel registry landing first. |
| [Cloud-hosted shareable URLs](https://github.com/Hussain004/BAGEL/issues/123) | The URL hash is self-contained today, so a link breaks if the bag moves. |
| [Streaming `.db3` over HTTP Range](https://github.com/Hussain004/BAGEL/issues/124) | `.db3` eager-fetches the whole file because sql.js wants it in memory; a custom VFS would allow partial reads. |
| [Xacro evaluator](https://github.com/Hussain004/BAGEL/issues/125) | Roughly 1000 lines of XML transform, so it is its own project. The URDF modal explains running xacro upstream meanwhile. |

---

## Quick Start

### Use the Live Demo

1. Open [**bagel-ros2.vercel.app**](https://bagel-ros2.vercel.app)
2. Drag your `.mcap`, `.db3`, or `.bag` file onto the page, paste a URL to a remote bag, paste a `ws://` or `wss://` URL to connect to a live robot, or click **Try a sample bag** for a quick tour
3. Explore!

### Run Locally

```bash
# Clone the repository
git clone https://github.com/Hussain004/BAGEL.git
cd BAGEL

# Install dependencies
pnpm install

# (Optional) regenerate the bundled sample bag
node scripts/build-sample-bag.mjs

# Start dev server
pnpm dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

Node **22** and pnpm are required; `.nvmrc` pins the version. Use `pnpm install`,
not npm, or CI will reject the lockfile mismatch.

### Contributing

Bug reports and feature requests use the [issue templates](.github/ISSUE_TEMPLATE).
To contribute code, start with [CONTRIBUTING.md](CONTRIBUTING.md), which covers
the architecture, the house style, how to add support for a new message type, and
what the tests expect. Issues labelled
[`good first issue`](https://github.com/Hussain004/BAGEL/labels/good%20first%20issue)
are scoped small on purpose.

### Sharing a view

The **Share** button in the toolbar builds a permalink for whatever you have
open, plus a markdown badge you can paste into a dataset README:

```markdown
[![Open in BAGEL](https://bagel-ros2.vercel.app/badge.svg)](https://bagel-ros2.vercel.app/#b=https://data.example.com/run.mcap)
```

The link carries the layout, playhead, and bookmarks, so it opens the exact
cockpit you were looking at. That requires the bag to live at a URL with CORS
headers and HTTP Range support configured on the host;
[`docs/DATASET_HOSTING.md`](docs/DATASET_HOSTING.md) has the header list,
copy-paste configs for S3, GCS, R2, nginx, and Apache, and a note on which
public hosts work. The Share modal also has a probe that tells you which
specific header a given host is missing.

### Command palette

`Cmd/Ctrl + K` opens a searchable list of everything BAGEL can do: every topic
in the openable panel views, the workspace actions (theme, export, bag edit, URDF,
share, presets), and go-to targets including bookmarks and any time typed in
seconds. Typing `imgraw` finds `/camera/image_raw`; typing `20` offers to jump
the playhead to 20 s.

Everything it lists calls an action the UI already had. The palette adds
discovery, not behaviour.

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause the playhead |
| `← / →` | Step the playhead by ~1% of the bag |
| `Shift + ← / →` | Step by ~5% |
| `Home / End` | Jump to bag start / end |
| `L` | Toggle loop playback *(v1.3.3)* |
| `M` | Add timeline bookmark at playhead *(v1.4.3)* |
| `T` | Focus the topic search box |
| `O` | Open a different bag file |
| `Esc` | Close the most recent panel (undoable with `Cmd/Ctrl + Z`) |
| `Shift + Esc` | Close every panel |
| `Cmd / Ctrl + Z` | Reopen the last closed panel |
| `Cmd / Ctrl + K` | Open the command palette (search topics, actions, times) |
| `?` | Show the shortcuts cheat-sheet |

The shortcuts modal (`?`) lists everything at runtime (adding a binding in `src/hooks/useKeyboardShortcuts.ts` auto-populates the modal). The About modal moved to a toolbar button only *(v1.7.0)* to free up `A` for the SplatViewer panel's fly controls, which are panel-scoped (active while hovering that panel) rather than global, so they're not in this table - see the SplatViewer entry above.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | React 19 + TypeScript | Component-based UI |
| **Build** | Vite 8 | Fast HMR, WASM support |
| **Styling** | TailwindCSS v4 | Utility-first dark theme |
| **State** | Zustand | Bag, playhead, and layout stores |
| **Resizable layout** | react-resizable-panels | Drag-to-resize sidebar + panels |
| **Charting** | uPlot | High-perf canvas time-series |
| **MCAP Parsing** | @mcap/core + @mcap/browser | Official MCAP reader (range-read from File) |
| **Zstd decode** | fzstd | Pure-JS zstd for compressed MCAP chunks |
| **ZIP encode** | fflate | Zero-copy PNG zip for clip export *(v1.4.2)* |
| **SQLite** | sql.js (WASM) | Parse .db3 files in-browser |
| **ROS1 Parsing** | @foxglove/rosbag | Indexed reader for legacy .bag files (range-read from File) |
| **ROS1 Deser.** | @foxglove/rosmsg-serialization | Pre-CDR ROS1 wire-format deserialization |
| **ROS1 bz2** | seek-bzip | Pure-JS bzip2 for `rosbag record --bz2` chunks |
| **ROS1 lz4** | lz4js | Pure-JS LZ4 frame format for `rosbag record --lz4` chunks |
| **CDR Deser.** | @foxglove/rosmsg2-serialization | ROS2 message deserialization |
| **Type Registry** | @foxglove/rosmsg-msgs-common | Pre-built ROS2 message defs (fallback for .db3 only) |
| **3D** | three.js (WebGL) | Point clouds, scans, pose markers, MarkerArray primitives, orbit controls |
| **Gaussian Splats** | @mkkellogg/gaussian-splats-3d | Splat parsing, off-thread depth sort, shader-based rendering *(v1.7.0)* |
| **Testing** | Vitest | Parser + utility unit tests, integration tests against committed sample bag (v1.0) |
| **CI** | GitHub Actions | `tsc -b` + `pnpm test` on every PR (v1.0) |
| **Deployment** | Vercel | Static site hosting |

---

## Architecture

```
User's Browser
│
├── Main thread (React render loop)
│   │
│   ├── Toolbar / Timeline / Sidebar / PanelGrid
│   │
│   ├── Zustand stores
│   │     ├── bagStore       (Map<bagId, BagEntry> + focusBagId + alignment)
│   │     ├── playheadStore  (aligned-time cursor + playing + speed)
│   │     └── layoutStore    (open panels keyed by kind:bagId:topic)
│   │
│   ├── Hooks (lazy fetch + cache decoded messages)
│   │     ├── useTopicMessages       (cache keyed by bagId + source + topic)
│   │     ├── useMessageAtTime       (single-flight per panel)
│   │     ├── useBagLocalPlayhead    (aligned → bag-local time conversion)
│   │     ├── useTrajectory
│   │     └── useTFGraph
│   │
│   └── parsers/index.ts  → tiny shim that talks to the per-bag worker
│         │
│         │  getParserClient(bagId).request({ id, method, params })
│         ▼
└── Parser Web Worker (off-thread, one per loaded bagId)
      │
      ├── parseBag(source)                → BagSummary
      ├── readDeserializedMessages(...)   → decoded[]   (streams progress)
      ├── readMessageAtTime(...)          → one message
      └── disposeParserCaches()
      │
      ├── BagSource adapter:
      │     ├── { kind: 'file', file }    → BlobReadable / BlobReader (range reads against Blob)
      │     └── { kind: 'url',  url }     → HttpReadable / HttpFilelike (HTTP Range requests)
      │
      ├── Format detect (.db3, .mcap, or .bag?)
      │     ├── .mcap → @mcap/core IndexedReader (uses the adapter)
      │     │              └── fzstd (decompress zstd chunks)
      │     ├── .db3  → sql.js (SQLite compiled to WASM, eager-fetches the whole file)
      │     │              └── nearest-row-at-time SQL
      │     └── .bag  → @foxglove/rosbag (uses the adapter)
      │                    ├── chunk index + per-topic message iterator
      │                    └── seek-bzip / lz4js (decompress bz2 / lz4 chunks)
      │
      └── Deserialization
            ├── CDR (.mcap / .db3) via @foxglove/rosmsg2-serialization
            │     Schemas from MCAP file or @foxglove/rosmsg-msgs-common
            └── ROS1 (.bag) via @foxglove/rosmsg-serialization
                  Schemas from connection records' messageDefinition text
                  + recursive { sec, nsec } → { sec, nsec, nanosec } alias pass
```

The main bundle no longer ships `@mcap/core`, `sql.js`, `fzstd`, or the
`@foxglove/*` libraries which are bundled into the worker chunk that
Vite emits as a sibling of `index.js`. Each loaded bag owns its own
worker instance (v0.9 multi-bag), so the worker's MCAP reader, sql.js
database, and ROS1 `Bag` instance are held in module-level caches
*per bag* so opening a second panel on the same topic doesn't re-pay
the parse cost, and parsing bag B doesn't queue behind bag A's
in-flight decode.

### Supported Message Types

BAGEL's built-in type registry covers all standard ROS2 packages:

| Package | Examples |
|---|---|
| `std_msgs` | String, Int32, Float64, Bool, Header |
| `geometry_msgs` | Pose, Twist, Transform, Point, Quaternion |
| `sensor_msgs` | Image, Imu, LaserScan, NavSatFix, PointCloud2, JointState (drives URDF joints in the 3D scene from v1.3.0), CameraInfo (renders the principal-point reticle on ImageViewer + a wireframe frustum in ThreeDScene from v1.3.2) |
| `nav_msgs` | Odometry, Path, OccupancyGrid |
| `tf2_msgs` | TFMessage |
| `visualization_msgs` | Marker, MarkerArray (CUBE / SPHERE / CYLINDER / ARROW / LINE_STRIP / LINE_LIST / CUBE_LIST / SPHERE_LIST / POINTS / TEXT_VIEW_FACING) |
| `diagnostic_msgs` | DiagnosticArray, DiagnosticStatus, KeyValue (rendered as a swimlane timeline panel in v1.0) |
| `rcl_interfaces` | Log (rendered in the virtualised Log panel in v1.0), ParameterEvent |
| `rosgraph_msgs` | Log (ROS1 rosout), same Log panel via shared type detector |
| `builtin_interfaces` | Time, Duration |

> **MCAP files** embed their schemas, so *any* message type in an MCAP file is supported (including custom types).
> **ROS1 `.bag` files** likewise embed schemas in connection records, so the same applies: any custom message that was alive in the producing ROS graph deserializes without bundling its definition.

---

## Project Structure

```
src/
├── parsers/       # Format readers, no React deps (mcap, rosbag1, db3, pcd, ply, splat, urdf)
├── workers/       # Parser Web Worker + the main-thread RPC client
├── live/          # Foxglove WebSocket client, decoder, ring buffer, recorder
├── store/         # zustand stores (bags, playhead, layout, per-panel settings)
├── components/
│   ├── landing/   # The no-bag landing page
│   ├── layout/    # Toolbar, Timeline, PanelGrid: the workspace chrome
│   ├── panels/    # One folder per panel kind, plus shared/ chrome
│   └── modals/    # ModalShell and the dialogs built on it
├── hooks/         # Cross-cutting React hooks
├── utils/         # Pure helpers. Anything testable without React lives here
└── types/         # TypeScript interfaces
tests/             # Mirrors src/. fixtures/synth.ts builds in-memory bags
scripts/           # Sample-bag generator and parser verification
```

The `ThreeDScene` panel is further split into focused modules (`sceneObjects.ts`,
`markerObjects.ts`, `cameraFrustum.ts`, `mapPlane.ts`, `accumulator.ts`,
`robotModel.ts`, `tfTransform.ts`, `useScene.ts`) so the 3,000-line component
stays navigable.

[CONTRIBUTING.md](CONTRIBUTING.md) has the annotated map, the house style, how to
add support for a new message type, and what the tests expect.

### Tests

`pnpm test` runs a **logic-only** Vitest suite (854 tests, 67 files, a few
seconds). Pure helpers are tested in `tests/utils/`, parser and codec paths in
`tests/parsers/`, store logic in `tests/store/`, live-connection code in
`tests/live/`, and there is an integration pass over the committed
`public/sample-bags/tour.mcap`.

There is no React component-test harness, so panel components are covered by
`pnpm test:e2e` instead (see CONTRIBUTING.md) rather than by hand. The synthetic
fixtures in `tests/fixtures/synth.ts` mean a fresh checkout needs nothing
downloaded to run the suite. The two real-bag suites (`real-mcap`, `real-db3`)
skip themselves because `test_files/` is gitignored; the committed sample bag
carries that coverage in CI instead.

---

## Acknowledgments

- [Foxglove](https://foxglove.dev/) for the excellent open-source ROS2 parsing libraries
- [sql.js](https://sql.js.org/) for making SQLite run in the browser
- The ROS2 community for building the robotics ecosystem

---

<div align="center">

**Built with ❤️ for the robotics community**

*If BAGEL saves you time, consider giving it a ⭐ on [GitHub](https://github.com/Hussain004/BAGEL)!*

*Want to support development directly? [Donate here](https://donatr.ee/hussain/)*

</div>
