<div align="center">

<img src="public/favicon.svg" width="80" alt="BAGEL Logo" />

# BAGEL

### BAG ExpLoration: ROS2 Bag File Web Visualizer

**Explore ROS2 bag files in your browser. No installation required.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff.svg)](https://vite.dev/)

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

### v0.4: 3D Visualization *(Current)*

Everything in v0.3, plus:

- **ThreeDScene panel**: a Three.js-powered 3D viewer that opens on `sensor_msgs/PointCloud2`, `sensor_msgs/LaserScan`, and pose-bearing topics (`Odometry`, `PoseStamped`, `PoseWithCovarianceStamped`, `TransformStamped`). Orbit controls (drag to rotate, wheel to zoom, right-drag to pan) with damping; ROS Z-up convention so "up" actually points up. A faint ground grid in the XY plane and a world-axis triad keep the user oriented at all zoom levels.
- **PointCloud2 rendering**: decodes the packed binary layout from each message's `fields` array — supports `FLOAT32 / FLOAT64 / INT8…INT32 / UINT8…UINT32` datatypes, the RGB-packed-in-a-float ROS convention, and intensity / ring fields. Colormaps: **height** (z), **intensity** (or ring index if no intensity), and **single colour**. Sub-samples to 500k points per frame so a full 1 M-point sweep doesn't lock the page; reuses GPU buffers across playhead ticks when the point count is stable.
- **LaserScan overlay**: lifts the polar `(range, angle)` ring into 3D at `z=0` so it sits naturally on top of the ground grid. Coloured by distance from the sensor (Turbo colormap) so depth is visible at a glance.
- **Pose / Odometry markers**: rendered as a coordinate-frame axes triad with a forward-pointing arrow, oriented by the message's quaternion. Track a robot's pose through the scene in real time as the playhead advances.
- **TF-aware rendering**: when the bag has `/tf` and `/tf_static`, every panel composes the chain from the source topic's `header.frame_id` up to a chosen *world frame* (`map` or `odom` by default) and applies it to the rendered geometry. A dropdown in the panel's Display card lets you switch the world frame at any time. Without TF, panels render directly in the topic's local frame and surface that fact.
- **Display controls**: per-panel pop-out card with color-mode buttons (PointCloud2), point-size slider, grid / axes toggles, and the world-frame selector.
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

| Version | Features |
|---|---|
| **v0.5** | CSV/JSON export, keyboard shortcuts, URL state, sample bag loader, polish & launch |

---

## Quick Start

### Use the Live Demo

1. Open [**bagel-ros2.vercel.app**](https://bagel-ros2.vercel.app)
2. Drag your `.db3` or `.mcap` file onto the page
3. Explore!

### Run Locally

```bash
# Clone the repository
git clone https://github.com/Hussain004/BAGEL.git
cd BAGEL

# Install dependencies
pnpm install

# Start dev server
pnpm dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

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
│   └── layoutStore.ts     # Open panels keyed by kind:topic
│
├── hooks/
│   ├── useTopicMessages.ts   # Eager load all messages (for plot; capped)
│   └── useMessageAtTime.ts   # Lazy load one message at playhead (for image/raw)
│
├── components/
│   ├── layout/
│   │   ├── DropZone.tsx    # Drag & drop landing page
│   │   ├── Toolbar.tsx     # Top info bar
│   │   ├── Timeline.tsx    # Global playhead scrubber
│   │   └── PanelGrid.tsx   # Resizable visualization grid
│   └── panels/
│       ├── PanelShell.tsx          # Header + close chrome shared by panels
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
    └── pointcloud.ts     # PointCloud2 binary decode + Turbo colormap
```

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
