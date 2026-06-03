<div align="center">

<img src="public/favicon.svg" width="80" alt="BAGEL Logo" />

# BAGEL

### BAG ExpLoration: ROS Bag File Web Visualizer

**Explore ROS1 & ROS2 bag files in your browser. No installation required.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff.svg)](https://vite.dev/)
[![Version](https://img.shields.io/badge/version-1.3.2-3b82f6.svg)](https://github.com/Hussain004/BAGEL/releases)

[**→ Live Demo**](https://bagel-ros2.vercel.app) · [Report Bug](https://github.com/Hussain004/BAGEL/issues) · [Request Feature](https://github.com/Hussain004/BAGEL/issues)

</div>

---

## What is BAGEL?

**BAGEL** is a fully static web application that lets you explore ROS bag files (`.mcap`, `.db3`, and `.bag`) entirely in your browser needing no server, no installation, no account. Just drag and drop!

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

<video src="https://github.com/user-attachments/assets/63e448fd-7272-4dee-86a2-a6dc3c3df846" controls width="100%"></video>

### Stress test with a real-world SLAM dataset

<video src="https://github.com/user-attachments/assets/d7ae858e-5e8e-40c2-90bd-a296c3991d06" controls width="100%"></video>

> Data featured in this demo is from the excellent open-access **M2DGR dataset** provided by the **SJTU-ViSYS team**, which was instrumental in stress-testing this visualizer's spatial rendering capabilities.

---


## Features

A condensed feature list is below. **Detailed version-by-version release notes (with the design rationale behind every feature) live in [FEATURES.md](FEATURES.md).**

### File formats

| Format | Notes |
|---|---|
| ROS2 `.mcap` | Including `zstd`-compressed chunks (the new ROS2 default) |
| ROS2 `.db3` | SQLite via `sql.js` / WASM |
| ROS1 `.bag` | Including `bz2` and `lz4` compressed chunks |
| Remote URLs | HTTP Range requests, so only the chunks you scrub through hit the network. `.mcap` / `.bag` stream lazily; `.db3` eager-fetches (sql.js needs it in memory). |

### Visualization panels

- **TimeSeriesPlot**: chart any numeric leaf field (`linear.x`, `orientation.w`, etc.) on uPlot.
- **ImageViewer**: `sensor_msgs/Image` (`rgb8` / `bgr8` / `rgba8` / `mono8` / `mono16`) and `CompressedImage` (`jpeg` / `png`) with lazy single-message reads. Optional `sensor_msgs/CameraInfo` overlay (principal-point reticle + focal-length badge + calibration-likely-unfilled chip) toggles from the panel header. *(v1.3.2)*
- **ThreeDScene** (Three.js): `PointCloud2`, `LaserScan`, `MarkerArray` (all twelve primitives: `CUBE` / `SPHERE` / `CYLINDER` / `ARROW` / `LINE_STRIP` / `LINE_LIST` / `CUBE_LIST` / `SPHERE_LIST` / `POINTS` / `TEXT_VIEW_FACING` / `MESH_RESOURCE` / `TRIANGLE_LIST` from v1.3.1), `OccupancyGrid`, pose markers, **camera frustums** for every `sensor_msgs/CameraInfo` topic (v1.3.2). Custom orbit pivot, range filter, point accumulation, configurable up-axis.
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

### Robot model (URDF) overlay *(v1.3.0)*

- **Drop a `.urdf` and the robot appears in every 3D panel**, anchored to its root link in world space via the bag's `/tf` stream. Joints animate from `sensor_msgs/JointState` (auto-detected) when the bag publishes it; static URDFs render at their rest pose. A toolbar "Robot" button opens the load modal; the Display card in each 3D panel grows a per-panel `robot model` hide toggle.
- **Geometry support**: box / cylinder / sphere primitives + `.stl` / `.dae` / `.obj` meshes. Loaders are lazy-imported on first use of each file type so primitives-only URDFs don't pay the Collada loader's bundle cost.
- **`package://` resolver**: paste a URL prefix or drag-drop a folder per referenced package; URL bindings persist across sessions in `localStorage` under `bagel:package-roots:v1`. No auto-fetch from ROS distros - BAGEL only loads meshes from where you point it.
- **Bundled sample robot URDF** (`public/sample-bags/sample-robot.urdf`) pairs with `tour.mcap` so the "Try a sample robot" button in the modal demonstrates the full flow on a fresh checkout.

### UX and quality

- **Light + dark themes** (toggle in the toolbar; persisted per browser). *(v1.0)*
- **Keyboard shortcuts**: `Space` to play, `← / →` to step, `Esc` to close panels, `T` to focus topic search, `O` to open a bag, `?` for the cheat-sheet.
- **Accessibility pass**: ARIA roles + focus management on every modal, `prefers-reduced-motion` respected, focus-visible rings throughout.
- **Bundled `tour.mcap` sample bag** exercises every panel type. Drop in zero seconds with the "Try a sample bag" button.
- **180-test Vitest suite** + GitHub Actions CI runs `tsc -b` + `pnpm test` on every PR. *(v1.0, expanded in v1.1)*
- **Bags well over 2 GB work in the browser**: range reads + lazy decoding throughout the parser stack.

> Looking for the long version with implementation notes and design tradeoffs for each release? See **[FEATURES.md](FEATURES.md)**.

---

### Earlier version highlights at a glance

- **v1.3.2**: `sensor_msgs/CameraInfo` first-class support. ImageViewer grows an overlay (principal-point reticle, focal-length badge, calibration-likely-unfilled chip) with auto-pair by topic-name convention (`/camera/image_raw` -> `/camera/camera_info`) and a per-panel manual override. The 3D scene renders a wireframe camera frustum in each camera's optical frame, sized by intrinsics, with a per-panel far-plane slider; when the camera's TF chains to the robot, the frustum follows the robot through scrubs. 21 new tests; total suite now 256.
- **v1.3.1**: `visualization_msgs/Marker` types 10 (`MESH_RESOURCE`) and 11 (`TRIANGLE_LIST`) now render correctly in the 3D panel, closing the last gap from v0.8. Mesh markers re-use the v1.3.0 `package://` resolver + `meshLoader` so one mapping per package serves both URDF visuals and marker meshes. `mesh_use_embedded_materials` is honoured. Triangle-list markers render as vertex-coloured Lambert-lit triangle soups with per-vertex colours when `marker.colors[]` matches the vertex count, otherwise solid `marker.color`. 12 new tests; total suite now 235.
- **v1.3.0**: Robot model in the 3D scene. Drop a URDF + an optional `package://` folder/URL per referenced mesh, and BAGEL renders the robot in every 3D panel anchored to the bag's `/tf` stream. Revolute and prismatic joints animate from `sensor_msgs/JointState` when present. Zero-dependency URDF parser + LRU-cached `.stl`/`.dae`/`.obj` loader. 20 new tests; total suite now 223.
- **v1.2**: Cross-format bag editing. The v1.1 editor now also accepts ROS1 `.bag` and ROS2 `.db3` inputs, both producing fresh indexed MCAP output. ROS1 schemas flow through from connection records as `ros1msg`; `.db3` schemas are synthesised on demand from the bundled type registry. 23 new tests; total suite now 203.
- **v1.1**: Bag editing. Trim time range, drop topics, download a fresh indexed MCAP. Browser-native replacement for `mcap filter`. 12 new tests; total suite now 180.
- **v1.0**: 168-test Vitest suite + CI gate, anchor UI for multi-bag, light theme, `DiagnosticArray` swimlane panel, `rcl_interfaces/Log` virtualised viewer.
- **v0.9 / v0.9.1**: Multi-bag overlay (per-bag Web Worker + three time-alignment modes), `nav_msgs/OccupancyGrid` rendering, OpenStreetMap tile underlay for `NavSatFix`, remote URL loading via HTTP Range.
- **v0.8 / v0.8.1**: `visualization_msgs/MarkerArray` rendering (10 of 12 primitives), per-frame TF chains, ROS1 `bz2` / `lz4` chunk decompression, paste-your-own `.msg` schema flow for `.db3` topics.
- **v0.7 / v0.7.1**: Drag-to-dock VSCode-style panel layout, recursive split-tree URL hashes, per-panel state survives docking.
- **v0.6**: ROS1 `.bag` parsing through the same drop zone (via `@foxglove/rosbag`), cross-version field + type-name normalization.
- **v0.5**: Keyboard shortcuts, sharable URL state, per-topic CSV / NDJSON export, voxel-grid point accumulation, bundled sample bag, accessibility pass.
- **v0.4**: `ThreeDScene` panel (PointCloud2 / LaserScan / pose markers), TF-aware rendering, point accumulation ring buffer, custom orbit pivot.
- **v0.3**: `TrajectoryPlot`, `TFTree`, all parsing moved to a dedicated Web Worker.
- **v0.2**: Global playhead, `TimeSeriesPlot`, `ImageViewer`, `RawMessageInspector`, zstd-compressed MCAP, multi-GB file handling via range reads.
- **v0.1**: Drag & drop `.db3` and `.mcap`, format auto-detect, topic inspector with search + sort.

For the full detail behind each release (including design rationale and implementation notes), see **[FEATURES.md](FEATURES.md)**.

### Roadmap

v1.0 stabilised the surface BAGEL already covered (test suite + CI gate, anchor UI, light theme, diagnostics + log panels). v1.1 / v1.2 shipped browser-native bag editing across every input format BAGEL reads. v1.3.0 pivoted to "make BAGEL feel like a real robotics tool, not just a bag viewer" with URDF + meshes in the 3D scene, v1.3.1 closed the v0.8 marker gap by wiring the same mesh loader into `MESH_RESOURCE` + `TRIANGLE_LIST`, and v1.3.2 closed the calibration-debugging story with `sensor_msgs/CameraInfo` overlay + camera frustum. Possible future directions:

| Idea | Notes |
|---|---|
| Image rectification from `CameraInfo` (**v1.3.3** candidate) | v1.3.2 shows intrinsics + frustum but doesn't warp the pixels. A per-frame canvas remap keyed by `distortion_model` (plumb-bob covers ~95% of bags; fisheye + equidistant ship as follow-ups) would close the "does the calibration actually flatten the lens distortion?" loop without leaving the browser. |
| Per-camera frustum hide toggle | v1.3.2's Display card has one master switch + one far-plane slider; on multi-camera bags every frustum renders at the same depth. A per-camera checklist (parallel to the v0.8 marker-namespace filter) would close this. |
| Collada texture-dependency resolution | `.dae` files reference texture image files via relative paths; the v1.3.1 mesh loader handles top-level mesh files but not their textures. A small texture-pre-resolution pass through the same `packageResolver` would close this for moveit / nav2 bags whose mesh markers carry per-link decals. |
| Zstd-compressed edit output | Edited bags are always uncompressed because `fzstd` is decompress-only; we don't bundle a pure-JS zstd *encoder* yet. Output bags reload identically; they just weigh 2-4x the zstd equivalent. Lands once a sensible encoder is available. |
| Plugin panels | Lets users build custom views (e.g. depth-image colorisation, vendor-specific marker overlays, OBD-II decoders) against a stable panel API. Earmarked once internal panels have stabilised so the API becomes a stability contract; shipping it half-baked is a one-way door. |
| Cloud-hosted shareable URLs | The local hash is great for personal reuse (a tiny Vercel function + KV store would unlock real link-sharing with layouts that survive a bag move). Designed in the v1.0 plan, deferred to a follow-up so it can land with the deploy infra change. |
| Streaming `.db3` over HTTP Range | `sql.js-httpvfs` would do real partial reads via a custom SQLite VFS; current URL loading eager-fetches the whole `.db3` because sql.js needs it in memory. Deferred until someone hits the practical ~250 MB cap in the wild. |
| Xacro evaluator | Pure-JS xacro is ~1000 LOC of XML transform - its own project. Users pre-process with the official `xacro` once; the URDF modal explains this when an unprocessed file is detected. Earmarked for a future "tool integration" pass rather than a v1.3.x sub-version. |

---

## Quick Start

### Use the Live Demo

1. Open [**bagel-ros2.vercel.app**](https://bagel-ros2.vercel.app)
2. Drag your `.mcap`, `.db3`, or `.bag` file onto the page, paste a URL to a remote bag (v0.9), or click **Try a sample bag** for a quick tour
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

The shortcuts modal (`?`) lists everything at runtime (adding a binding in `src/hooks/useKeyboardShortcuts.ts` auto-populates the modal).

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
| **ROS1 Parsing** | @foxglove/rosbag | Indexed reader for legacy .bag files (range-read from File) |
| **ROS1 Deser.** | @foxglove/rosmsg-serialization | Pre-CDR ROS1 wire-format deserialization |
| **ROS1 bz2** | seek-bzip | Pure-JS bzip2 for `rosbag record --bz2` chunks |
| **ROS1 lz4** | lz4js | Pure-JS LZ4 frame format for `rosbag record --lz4` chunks |
| **CDR Deser.** | @foxglove/rosmsg2-serialization | ROS2 message deserialization |
| **Type Registry** | @foxglove/rosmsg-msgs-common | Pre-built ROS2 message defs (fallback for .db3 only) |
| **3D** | three.js (WebGL) | Point clouds, scans, pose markers, MarkerArray primitives, orbit controls |
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
│   ├── DropZone / Toolbar / Timeline / Sidebar / PanelGrid
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
├── parsers/              # Core parsing (no React deps)
│   ├── index.ts          # Thin shim: forwards every call to the parser worker
│   ├── core.ts           # Worker-only: format detect + unified parse + read APIs
│   ├── source.ts         # BagSource abstraction (File or URL), HTTP-Range readers
│   ├── mcap.ts           # MCAP reader (range reads, fzstd decompress, lazy seek)
│   ├── db3.ts            # SQLite reader (cached Database, nearest-at-time query)
│   ├── bag.ts            # ROS1 .bag reader (cached Bag, type-name normalisation)
│   ├── cdr.ts            # CDR deserializer (cached MessageReader per type)
│   ├── rosbag1.ts        # ROS1 deserializer (cached reader + time-field alias pass)
│   ├── edit.ts           # v1.1 bag editor: trim + topic filter, MCAP-in to MCAP-out
│   ├── urdf.ts           # v1.3 URDF parser (zero-dep mini XML tokenizer + URDF semantic layer)
│   ├── packageResolver.ts# v1.3 package:// → URL / File resolver (localStorage-backed)
│   └── typeRegistry.ts   # ROS2 message definitions (.db3 fallback only)
│
├── workers/
│   ├── parser.worker.ts  # Web Worker entry which owns the parser caches
│   └── parserClient.ts   # Main-thread RPC client (promise-based)
│
├── store/
│   ├── bagStore.ts        # Bag summary + source File
│   ├── playheadStore.ts   # Time cursor, play/pause, speed
│   ├── layoutStore.ts     # Open panels keyed by kind:topic
│   ├── themeStore.ts      # Dark / light preference (v1.0)
│   ├── robotModelStore.ts # v1.3 loaded URDF + per-panel visibility flags
│   └── uiStore.ts         # Modal overlays (about / shortcuts)
│
├── hooks/
│   ├── useTopicMessages.ts        # Eager load all messages (for plot; capped)
│   ├── useMessageAtTime.ts        # Lazy load one message at playhead (for image/raw)
│   ├── useJointStates.ts          # v1.3 sensor_msgs/JointState reader for URDF joints
│   ├── useCameraInfo.ts           # v1.3.2 sensor_msgs/CameraInfo reader + auto-pair convention
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
│   │   ├── BagEditModal.tsx  # v1.1 bag editor: trim + topic filter + MCAP download
│   │   ├── SchemaPasteModal.tsx # Custom .msg schema paste flow for .db3 (v0.8.1)
│   │   ├── UrdfLoadModal.tsx # v1.3 URDF drop + per-package resolver prompts
│   │   └── ShortcutsModal.tsx# Generated from SHORTCUTS table
│   └── panels/
│       ├── PanelShell.tsx          # Header + export menu + close chrome
│       ├── TopicInspector/         # Sidebar topic list with search/sort
│       ├── TimeSeriesPlot/         # uPlot-based time-series chart
│       ├── ImageViewer/            # Raw + Compressed image decoder
│       ├── RawMessageInspector/    # JSON tree at playhead time
│       ├── TrajectoryPlot/         # 2D x/y path on a canvas
│       ├── TFTree/                 # /tf + /tf_static graph view
│       ├── ThreeDScene/            # Three.js 3D viewer (PointCloud2, LaserScan, Pose, MarkerArray)
│       ├── DiagnosticArray/        # Diagnostic swimlane + at-playhead inspector (v1.0)
│       └── Log/                    # Virtualised rosout viewer w/ severity + node filters (v1.0)
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
    ├── occupancyGrid.ts  # nav_msgs/OccupancyGrid → RGBA texture (v0.9)
    ├── gpsTiles.ts       # OSM slippy-map projection + tile LRU loader (v0.9)
    ├── export.ts         # CSV + NDJSON encoders + download trigger
    ├── meshLoader.ts     # v1.3 Three.js .stl/.dae/.obj dispatcher (lazy + LRU)
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
├── markerObjects.ts          # Per-type factories for visualization_msgs/Marker (all 12 primitives as of v1.3.1)
├── cameraFrustum.ts          # v1.3.2 wireframe frustum from sensor_msgs/CameraInfo intrinsics
├── markerSet.ts              # (ns, id) → Object3D manager + frame-grouped TFs
├── mapPlane.ts               # nav_msgs/OccupancyGrid textured plane (v0.9)
├── accumulator.ts            # Ring buffer + voxel-grid downsample for accumulation
├── robotModel.ts             # v1.3 URDF → Three.js subtree builder (joints + meshes)
└── tfTransform.ts            # composeTFChain + pickWorldFrame helpers
```

### Build-time scripts

- `scripts/build-sample-bag.mjs`: generates `public/sample-bags/tour.mcap`, a ~2 MB synthetic bag with `/odom`, `/imu/data`, `/scan`, `/tf`, `/markers`, `/map`, and `/gps/fix` topics over 30 seconds. The `/markers` topic publishes 8 markers at 1 Hz across `status` (base_link, frame-locked) and `planning` (odom) namespaces to exercise the v0.8 MarkerArray renderer end-to-end. `/map` publishes a 100×100 `nav_msgs/OccupancyGrid` that expands outward over the bag, mimicking an incremental SLAM run with outer walls, two pillars, and a mid-cost diagonal corridor to exercise the v0.9 cost ramp. `/gps/fix` projects the figure-eight onto realistic lat/lon around Cambridge UK so the v0.9 OSM tile underlay shows familiar streets when toggled on. Idempotent; rerun only if the synthetic data needs changing. The output is committed so a fresh checkout serves the sample without a Node build step.
- `scripts/verify-sample-bag.mjs`: parses the generated bag with `McapIndexedReader` and prints the topic table; smoke-test the writer when you change the synthesiser.
- `scripts/verify-parsers.mjs`: Node-side verification of the `.db3` and `.mcap` parser paths against the real test fixtures in `test_files/`.

### Tests (v1.0 - v1.3)

```
tests/
├── fixtures/
│   └── synth.ts                # In-memory MCAP / .bag / .db3 writers (per-test bags as Uint8Array)
│
├── parsers/                    # Parser unit tests
│   ├── cdr.test.ts             # CDR round-trips (String, Twist, Odometry w/ covariance)
│   ├── mcap.test.ts            # Parse + read + at-time + cache invalidation against synth bags
│   ├── db3.test.ts             # .db3 dispatch via mocked sql.js locateFile
│   ├── bag.test.ts             # ROS1 .bag, skipped on 10 GB fixtures, ready for a smaller one
│   ├── edit.test.ts            # v1.1 trim + topic filter round-trips (synth + tour.mcap)
│   ├── editDb3.test.ts         # v1.2 .db3-in / MCAP-out + missing-schema opt-in path
│   ├── editRos1.test.ts        # v1.2 .bag-in / MCAP-out + connection-record schema flow
│   ├── source.test.ts          # HTTP Range reader: CORS / 416 / no-Content-Length / Range-ignored
│   ├── urdf.test.ts            # v1.3 URDF parser: primitives, meshes, joints, xacro detection
│   └── packageResolver.test.ts # v1.3 package:// resolver: URL + file bindings, persistence
│
├── utils/                      # Utility unit tests
│   ├── time.test.ts            # BigInt ns math + alignment offsets
│   ├── bytes.test.ts           # Size formatting + magic-byte detection
│   ├── messages.test.ts        # flattenNumeric + type sniffing across every panel kind
│   ├── pointcloud.test.ts      # FLOAT32 fast path + DataView path + packed RGB + Turbo gradient
│   ├── trajectory.test.ts      # Pose extraction across all 7 supported types + NavSatFix projection
│   └── occupancyGrid.test.ts   # int8 → RGBA mapping + content-fingerprint stability
│
├── components/                 # ThreeDScene panel unit tests
│   ├── markerObjects.test.ts   # v1.3.1 MESH_RESOURCE + TRIANGLE_LIST factories (mocked loader)
│   └── cameraFrustum.test.ts   # v1.3.2 frustum geometry math (centred + offset principal points)
│
├── hooks/                      # React hook helpers (pure functions covered without renderer)
│   └── useCameraInfo.test.ts   # v1.3.2 auto-pair convention + parseCameraInfo + per-panel persistence
│
└── integration/                # Real-bag end-to-end through the unified parseBag entry
    ├── sample-bag.test.ts      # Committed public/sample-bags/tour.mcap (ships with the repo)
    ├── real-mcap.test.ts       # test_files/mcap/pose_topics/* (skipped on CI; gitignored)
    └── real-db3.test.ts        # test_files/db3/sample.db3 (skipped on CI; gitignored)
```

Run with `pnpm test` (one-shot, under 20 s wall time, 256 passing tests) or `pnpm test:watch` for HMR-style re-runs. `pnpm test:coverage` adds an `@vitest/coverage-v8` report under `coverage/`. The `tests/` directory uses synthetic fixtures (no disk hit) and the bundled `tour.mcap` as the integration layer, so a fresh checkout has everything the suite needs without downloading any new fixtures.

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
