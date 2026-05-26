<div align="center">

<img src="public/favicon.svg" width="80" alt="BAGEL Logo" />

# BAGEL

### BAG ExpLoration: ROS2 Bag File Web Visualizer

**Explore ROS2 bag files in your browser. No installation required.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff.svg)](https://vite.dev/)
[![Version](https://img.shields.io/badge/version-0.5.0-3b82f6.svg)](https://github.com/Hussain004/BAGEL/releases)

[**→ Live Demo**](https://bagel-ros2.vercel.app) · [Report Bug](https://github.com/Hussain004/BAGEL/issues) · [Request Feature](https://github.com/Hussain004/BAGEL/issues)

</div>

---

## What is BAGEL?

**BAGEL** is a fully static web application that lets you explore ROS2 bag files (`.db3` and `.mcap`) entirely in your browser needing no server, no installation, no account. Just drag and drop!

Robotics engineers and researchers frequently generate bag files during experiments, SLAM runs, and sensor calibration. Inspecting these files currently requires a full ROS2 installation, Foxglove Studio (increasingly commercial), or writing custom Python scripts for every inspection task.

BAGEL eliminates this friction.

### Why BAGEL?

| Problem | BAGEL Solution |
|---|---|
| Need ROS2 installed to inspect bag files | Works in any modern browser |
| Foxglove Studio going commercial | 100% open source, MIT licensed |
| `ros2 bag info` gives text-only output | Rich visual interface with search & filtering |
| Can't share bag contents easily | Zero-install, you can send anyone the URL |
| Students struggle with ROS2 tooling | No setup required, just drag and drop |

---

## Features

### v0.5: Polish & Launch *(Current)*

Everything in v0.4, plus:

- **Keyboard shortcuts** — `Space` to play/pause, `← / →` to step by 1% of the bag (`Shift + ← / →` for 5%), `Home / End` to jump to the bag's start or end, `T` to focus the topic search box, `O` to open a different bag, `Esc` to close the most recent panel (`Shift + Esc` closes them all), `?` for the shortcuts cheat-sheet, `A` for the about modal. Bindings ignore text inputs so they never eat keystrokes you meant for the search box.
- **Sharable URL state** — the open panels and the playhead position are written to `location.hash` on every change (rAF-coalesced, so playback at 60 Hz isn't writing 60 times a second). Re-opening the same bag with the same URL restores the exact layout and time cursor. Panels for topics that no longer exist are silently dropped.
- **Per-topic export** — every panel header now has an Export menu that downloads the topic as CSV (flattened numeric leaves, one row per message — exactly what `plot.csv` looked like in `rqt_bag`) or NDJSON (the full deserialized message stream, one object per line, with `BigInt` timestamps stringified and `Uint8Array` fields base64-encoded so the file is valid JSON). Caps at 250k messages per topic to keep the in-browser exporter from OOMing on multi-million-message logs.
- **Voxel-grid point accumulation** — the v0.4 ring buffer is now joined by a true voxel-grid downsample mode. Each appended point is snapped to a regular 3D grid keyed by `(floor(x/v), floor(y/v), floor(z/v))` and only the most recent point per cell is kept. The result is a stable map of the visited ground rather than ten ring-buffer copies of the same area. Voxel size is exposed as a 5 cm – 2 m slider in the Display card. Switching modes or voxel size mid-flight clears the accumulator (storage layouts differ).
- **About + Shortcuts modals** — reachable from the BAGEL logo (top-left of the toolbar), the `?` icon in the toolbar, or the keyboard. Generated from the same `SHORTCUTS` table the handler uses, so new bindings auto-appear.
- **Try a sample bag** — a 1.7 MB bundled `tour.mcap` ships in `public/sample-bags/`. It's generated from `scripts/build-sample-bag.mjs` (an idempotent Node script that uses `@mcap/core` + `@foxglove/rosmsg2-serialization` to write a 30-second synthetic `/odom + /imu + /scan + /tf` set), so first-time visitors can exercise every panel without supplying their own data.
- **Accessibility pass** — `role="dialog"` + `aria-modal` on every modal with focus management (close button gets initial focus, previously-focused element restored on dismissal); `aria-label` / `aria-valuemin/now/max` on the timeline scrubber; `role="list"` + per-row `aria-label` on the topic inspector; focus-visible rings on every interactive control via a single CSS pass that suppresses the default outline only on `:focus` (mouse) while keeping it on `:focus-visible` (keyboard); `prefers-reduced-motion` strips animations to a single static frame.
- **Responsive toolbar** — the full stats row collapses to a compact `duration · msgs · topics` strip on tablet-width viewports and stacks below 900 px so portrait iPads no longer push the close button off-screen.

### v0.4: 3D Visualization

Everything in v0.3, plus:

- **ThreeDScene panel**: a Three.js-powered 3D viewer that opens on `sensor_msgs/PointCloud2`, `sensor_msgs/LaserScan`, and pose-bearing topics (`Odometry`, `PoseStamped`, `PoseWithCovarianceStamped`, `TransformStamped`). Orbit controls (drag to rotate, wheel to zoom, right-drag to pan) with damping; ROS Z-up convention so "up" actually points up. A faint ground grid in the XY plane and a world-axis triad keep the user oriented at all zoom levels.
- **PointCloud2 rendering**: decodes the packed binary layout from each message's `fields` array — supports `FLOAT32 / FLOAT64 / INT8…INT32 / UINT8…UINT32` datatypes, the RGB-packed-in-a-float ROS convention, and intensity / ring fields. Colormaps: **height** (z), **intensity** (or ring index if no intensity), and **single colour**. Sub-samples to 250k points per frame so a full 1 M-point sweep doesn't lock the page; reuses GPU buffers across playhead ticks when the point count is stable. A FLOAT32 fast path reads x/y/z through a typed-array view (no DataView dispatch) for typical Velodyne / Ouster / RealSense streams.
- **Livox CustomMsg support**: list-of-struct point clouds (`livox_ros_driver2/msg/CustomMsg` and similar) share the same render pipeline — detected by shape, not by hard-coded type name, so converted bags with non-standard package names still work.
- **LaserScan overlay**: lifts the polar `(range, angle)` ring into 3D at `z=0` so it sits naturally on top of the ground grid. Coloured by distance from the sensor (Turbo colormap) so depth is visible at a glance.
- **Pose / Odometry markers**: rendered as a coordinate-frame axes triad with a forward-pointing arrow, oriented by the message's quaternion. Track a robot's pose through the scene in real time as the playhead advances.
- **TF-aware rendering**: when the bag has `/tf` and `/tf_static`, every panel composes the chain from the source topic's `header.frame_id` up to a chosen *world frame* (`map` or `odom` by default) and applies it to the rendered geometry. A dropdown in the panel's Display card lets you switch the world frame at any time. Without TF, panels render directly in the topic's local frame and surface that fact.
- **Custom orbit pivot**: `Shift+Click` anywhere in the 3D viewport sets the orbit centre to that scene point. Raycasts the live cloud (and the accumulator) with a pick threshold tied to the camera view radius, falls back to the `z=0` ground plane when nothing is hit. A wireframe sphere marks the chosen pivot; a `Reset pivot` button reverts to the auto-fit centre without disturbing the camera angle. Solves the case where the cloud isn't centred on its sensor origin and orbit feels off-axis.
- **Range filter**: a `limit range` slider (1–200 m) in the Display card drops returns farther than the cap before bounds + height-colour stats are computed. Recovers useful height colouring on long-range Velodyne / Ouster scans where a handful of 100 m returns would otherwise compress the colormap into a thin slab.
- **Point accumulation**: a ring-buffer mode that builds up a running "map" view from many frames — drone flights, SLAM runs, vehicle traversals. New frames are sub-sampled (`per-frame pts`, 1k–500k) and appended in world frame via the cached source→world TF matrix; oldest points drop FIFO once the budget (0.25M–10M) is hit. Auto-clears on topic / world-frame / up-axis change, and warns when no `/tf` is present (frames will overlap in the sensor frame). Voxel-grid downsampling for "build a 60-second field map" workflows is slated for v0.5.
- **Custom up-axis**: a 6-option selector (`±X / ±Y / ±Z up`) handles bags whose clouds aren't ROS-standard Z-up — upside-down PCDs, drone NED frames, camera-aligned LiDAR rigs. Applied as a pre-multiplication on the TF chain so it composes for free with the existing graph; no decoder changes.
- **Display controls**: per-panel pop-out card with color-mode buttons (PointCloud2), point-size slider, range filter, accumulation controls, grid / axes toggles, up-axis selector, and the world-frame selector.
- **3D quick-button**: `PointCloud2` and `LaserScan` topics expose a `3D` button in the sidebar and default-open the 3D panel on click. Pose-bearing topics gain a `3D` option alongside their existing `Path` and `Plot` buttons.

### v0.3: Trajectory, TF Tree & Web Worker

Everything in v0.2, plus:

- **TrajectoryPlot** panel: click any pose-bearing topic to render its 2D path. Supports `nav_msgs/Odometry`, `geometry_msgs/PoseStamped`, `PoseWithCovarianceStamped`, `Pose`, `Point(Stamped)`, `TransformStamped`, and `sensor_msgs/NavSatFix` (equirectangular projection from the first GPS fix). The polyline runs blue → red along the path, with a playhead marker that follows the bag time and a heading arrow when the source message has an orientation quaternion. Mouse-wheel zoom, drag-to-pan, and a dynamic scale bar in metres / km.
- **TFTree** panel: parses `/tf` and `/tf_static` into a single graph and renders the frame hierarchy as an interactive top-down tree. Click any frame to see its current transform (translation, quaternion, Euler angles in degrees) at the playhead time, and to highlight the root → frame chain. Static and dynamic edges are visually distinct (dashed vs solid).
- **Web Worker parsing**: every heavy operation — initial bag parse, MCAP chunk zstd-decompression, sql.js queries, CDR deserialization — now runs in a dedicated parser worker. The React render loop stays responsive while a topic decodes; scrubbing the timeline, toggling panels, and resizing the layout no longer block on the bag. `@mcap/core`, `sql.js`, `fzstd`, and the `@foxglove/*` libraries live entirely in the worker chunk and never touch the UI thread.
- **Smarter sidebar panel buttons**: each topic row now offers exactly the panel kinds that fit its type. Pose topics get a `Path` button, `/tf` and `/tf_static` get a `TF` button, image topics keep `Image`, and `Raw` is always available. The default-click panel matches the topic's nature (TF → tf, pose-only → trajectory, image → image, otherwise → plot).

### v0.2: Plotting, Image Viewer & Playhead

- **Global playhead**: timeline strip at the bottom with click/drag scrub, play/pause, 0.25×–4× speed, and Spacebar shortcut. Every open panel syncs to the same timestamp.
- **TimeSeriesPlot** panel: click any non-image topic to chart its numeric fields. Auto-extracts every numeric leaf (e.g. `linear.x`, `angular.z`, `orientation.w`) as a separate series, with per-field visibility toggles. uPlot-driven, handles up to 50,000 points per panel.
- **ImageViewer** panel: click any `sensor_msgs/Image` or `CompressedImage` topic to see the frame nearest the playhead time. Supports `rgb8 / bgr8 / rgba8 / mono8 / mono16` raw encodings and `jpeg / png` compressed. Lazy single-message reads: multi-GB image streams open near-instantly.
- **RawMessageInspector** panel: collapsible JSON tree of the deserialized message at the playhead, with type-aware coloring and hex dumps for `Uint8Array` fields.
- **Resizable panel layout**: sidebar and visualization panels are split by `react-resizable-panels` handles; drag to reflow.
- **Active-panel indicator**: small blue dot on sidebar topic rows that already have a panel open.
- **Zstd-compressed MCAP support**: bags recorded with `--compression zstd` (the new ROS2 default) decompress via a pure-JS zstd decoder, no extra setup.
- **Multi-GB file handling**: MCAP indexed reader does range reads against the source `File` instead of loading the whole bag into a single ArrayBuffer; bags well over 2 GB work.

### v0.1: Foundation & File Parsing

- **Drag & drop** `.db3` and `.mcap` ROS2 bag files
- **Auto-detect** file format from extension and magic bytes
- **Topic Inspector**: browse all topics with name, type, message count, and Hz
- **Bag summary**: duration, total messages, file size, active topics
- **Search & filter**: quickly find topics by name or type
- **Sort**: by name, message count, or frequency

### Roadmap

BAGEL v0.5 closes the original five-version plan. Possible future directions:

| Idea | Notes |
|---|---|
| Light theme | Dark is intentional (data viz reads better on dark backgrounds), but a toggle would help in bright field conditions. |
| Plugin panels | Lets users build custom views (e.g. depth-image colorisation, GPS overlay) against a stable panel API. |
| Multi-bag overlay | Drag two bags in to compare runs side-by-side on the same timeline. |
| Cloud-hosted shareable URLs | The local hash is great for personal reuse — a tiny backend would unlock real link-sharing. |

---

## Quick Start

### Use the Live Demo

1. Open [**bagel-ros2.vercel.app**](https://bagel-ros2.vercel.app)
2. Drag your `.db3` or `.mcap` file onto the page — or click **Try a sample bag** for a quick tour
3. Explore!

### Run Locally

```bash
# Clone the repository
git clone https://github.com/Hussain004/BAGEL.git
cd BAGEL

# Install dependencies
pnpm install

# (Optional) regenerate the bundled sample bag — already checked in
node scripts/build-sample-bag.mjs

# Start dev server
pnpm dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

### Keyboard Shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause the playhead |
| `← / →` | Step the playhead by ~1% of the bag |
| `Shift + ← / →` | Step by ~5% |
| `Home / End` | Jump to bag start / end |
| `T` | Focus the topic search box |
| `O` | Open a different bag file |
| `Esc` | Close the most recent panel |
| `Shift + Esc` | Close every panel |
| `?` | Show the shortcuts cheat-sheet |
| `A` | Show the about modal |

The shortcuts modal (`?`) lists everything at runtime — adding a binding in `src/hooks/useKeyboardShortcuts.ts` auto-populates the modal.

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
| **SQLite** | sql.js (WASM) | Parse .db3 files in-browser |
| **CDR Deser.** | @foxglove/rosmsg2-serialization | ROS2 message deserialization |
| **Type Registry** | @foxglove/rosmsg-msgs-common | Pre-built ROS2 message defs |
| **3D** | three.js (WebGL) | Point clouds, scans, pose markers, orbit controls |
| **Deployment** | Vercel | Static site hosting |

---

## Architecture

```
User's Browser
│
├── Main thread (React render loop)
│   │
│   ├── DropZone / Toolbar / Timeline / Sidebar / PanelGrid
│   │
│   ├── Zustand stores
│   │     ├── bagStore       (BagSummary + source File handle)
│   │     ├── playheadStore  (timeNs, playing, speed, seek)
│   │     └── layoutStore    (open panels keyed by kind:topic)
│   │
│   ├── Hooks (lazy fetch + cache decoded messages)
│   │     ├── useTopicMessages
│   │     ├── useMessageAtTime
│   │     ├── useTrajectory
│   │     └── useTFGraph
│   │
│   └── parsers/index.ts  → tiny shim that talks to the worker
│         │
│         │  postMessage({ id, method, params })
│         ▼
└── Parser Web Worker (off-thread)
      │
      ├── parseBag(file)                  → BagSummary
      ├── readDeserializedMessages(...)   → decoded[]   (streams progress)
      ├── readMessageAtTime(...)          → one message
      └── disposeParserCaches()
      │
      ├── Format detect (.db3 or .mcap?)
      │     ├── .mcap → @mcap/core IndexedReader (range reads via BlobReadable)
      │     │              └── fzstd (decompress zstd chunks)
      │     └── .db3  → sql.js (SQLite compiled to WASM)
      │                     └── nearest-row-at-time SQL
      │
      └── CDR Deserialization (@foxglove/rosmsg2-serialization)
            Schemas from MCAP file or @foxglove/rosmsg-msgs-common
```

The main bundle no longer ships `@mcap/core`, `sql.js`, `fzstd`, or the
`@foxglove/*` libraries — those are bundled into the worker chunk that
Vite emits as a sibling of `index.js`. The worker's MCAP reader and
sql.js database are held in module-level caches that survive across
panel reads, so opening a second panel on the same topic doesn't re-pay
the parse cost.

### Supported Message Types

BAGEL's built-in type registry covers all standard ROS2 packages:

| Package | Examples |
|---|---|
| `std_msgs` | String, Int32, Float64, Bool, Header |
| `geometry_msgs` | Pose, Twist, Transform, Point, Quaternion |
| `sensor_msgs` | Image, Imu, LaserScan, NavSatFix, PointCloud2 |
| `nav_msgs` | Odometry, Path, OccupancyGrid |
| `tf2_msgs` | TFMessage |
| `rcl_interfaces` | Log, ParameterEvent |
| `builtin_interfaces` | Time, Duration |

> **MCAP files** embed their schemas — so *any* message type in an MCAP file is supported, including custom types.

---

## Project Structure

```
src/
├── parsers/              # Core parsing (no React deps)
│   ├── index.ts          # Thin shim: forwards every call to the parser worker
│   ├── core.ts           # Worker-only: format detect + unified parse + read APIs
│   ├── mcap.ts           # MCAP reader (range reads, fzstd decompress, lazy seek)
│   ├── db3.ts            # SQLite reader (cached Database, nearest-at-time query)
│   ├── cdr.ts            # CDR deserializer (cached MessageReader per type)
│   └── typeRegistry.ts   # ROS2 message definitions
│
├── workers/
│   ├── parser.worker.ts  # Web Worker entry — owns the parser caches
│   └── parserClient.ts   # Main-thread RPC client (promise-based)
│
├── store/
│   ├── bagStore.ts        # Bag summary + source File
│   ├── playheadStore.ts   # Time cursor, play/pause, speed
│   ├── layoutStore.ts     # Open panels keyed by kind:topic
│   └── uiStore.ts         # Modal overlays (about / shortcuts)
│
├── hooks/
│   ├── useTopicMessages.ts        # Eager load all messages (for plot; capped)
│   ├── useMessageAtTime.ts        # Lazy load one message at playhead (for image/raw)
│   ├── useKeyboardShortcuts.ts    # Global keymap, single source of truth for shortcuts
│   └── useUrlState.ts             # location.hash <-> panels + playhead sync
│
├── components/
│   ├── layout/
│   │   ├── DropZone.tsx    # Drag & drop landing page + sample bag loader
│   │   ├── Toolbar.tsx     # Top info bar + help / close
│   │   ├── Timeline.tsx    # Global playhead scrubber
│   │   └── PanelGrid.tsx   # Resizable visualization grid
│   ├── modals/
│   │   ├── ModalHost.tsx     # Renders whichever modal uiStore selected
│   │   ├── ModalShell.tsx    # Dialog chrome, Esc-to-close, focus restore
│   │   ├── AboutModal.tsx    # Project info + tech stack + links
│   │   └── ShortcutsModal.tsx# Generated from SHORTCUTS table
│   └── panels/
│       ├── PanelShell.tsx          # Header + export menu + close chrome
│       ├── TopicInspector/         # Sidebar topic list with search/sort
│       ├── TimeSeriesPlot/         # uPlot-based time-series chart
│       ├── ImageViewer/            # Raw + Compressed image decoder
│       ├── RawMessageInspector/    # JSON tree at playhead time
│       ├── TrajectoryPlot/         # 2D x/y path on a canvas
│       ├── TFTree/                 # /tf + /tf_static graph view
│       └── ThreeDScene/            # Three.js 3D viewer (PointCloud2, LaserScan, Pose)
│
├── types/                # TypeScript interfaces
│   ├── bag.ts            # BagSummary, TopicInfo, RawMessage
│   └── ros2.ts           # Common ROS2 message types
│
└── utils/                # Helpers
    ├── time.ts           # Nanosecond timestamp utils
    ├── bytes.ts          # File size, hex dump, magic bytes
    ├── color.ts          # Topic color assignment
    ├── messages.ts       # flattenNumeric, nearestMessageIndex, type sniffing
    ├── trajectory.ts     # Pose / NavSatFix → x/y extraction + bounds
    ├── pointcloud.ts     # PointCloud2 binary decode + Turbo colormap + range filter
    ├── customCloud.ts    # Livox CustomMsg / list-of-struct cloud decoder
    ├── laserscan.ts      # LaserScan polar-ring → 3D positions
    ├── export.ts         # CSV + NDJSON encoders + download trigger
    └── version.ts        # APP_VERSION constant
```

### Inside `components/panels/ThreeDScene/`

The 3D panel is split across a few focused modules:

```
ThreeDScene/
├── index.tsx                 # Panel React component + ControlsCard
├── useScene.ts               # Renderer / scene / camera / orbit-controls lifetime
├── useDecodedPointCloud.ts   # Lazy worker-decoded single-frame loader
├── sceneObjects.ts           # Factories for PointCloud / LaserScan / PoseAxes / grid
├── accumulator.ts            # Ring buffer + voxel-grid downsample for accumulation
└── tfTransform.ts            # composeTFChain + pickWorldFrame helpers
```

### Build-time scripts

- `scripts/build-sample-bag.mjs` — generates `public/sample-bags/tour.mcap`, a 1.7 MB synthetic bag with `/odom`, `/imu/data`, `/scan`, and `/tf` topics over 30 seconds. Idempotent; rerun only if the synthetic data needs changing. The output is committed so a fresh checkout serves the sample without a Node build step.
- `scripts/verify-sample-bag.mjs` — parses the generated bag with `McapIndexedReader` and prints the topic table; smoke-test the writer when you change the synthesiser.
- `scripts/verify-parsers.mjs` — Node-side verification of the `.db3` and `.mcap` parser paths against the real test fixtures in `test_files/`.

---

## Acknowledgments

- [Foxglove](https://foxglove.dev/) for the excellent open-source ROS2 parsing libraries
- [sql.js](https://sql.js.org/) for making SQLite run in the browser
- The ROS2 community for building the robotics ecosystem

---

<div align="center">

**Built with ❤️ for the robotics community**

*If BAGEL saves you time, consider giving it a ⭐ on [GitHub](https://github.com/Hussain004/BAGEL)!*

</div>
