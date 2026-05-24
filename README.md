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

### v0.2: Plotting, Image Viewer & Playhead *(Current)*

Everything in v0.1, plus:

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
| **v0.3** | Web Worker parsing + WASM zstd (perf foundation), 2D trajectory plot, TF tree graph |
| **v0.4** | 3D point cloud rendering, LaserScan overlay, camera frustum |
| **v0.5** | CSV/JSON export, keyboard shortcuts, sample bag loader, polish & launch |

> v0.3 includes performance work needed before BAGEL can stay snappy on multi-GB compressed bags.

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
| **Deployment** | Vercel | Static site hosting |

---

## Architecture

```
User's Browser
│
├── File Input (drag & drop)
│     │
│     ▼
├── Format Detection (.db3 or .mcap?)
│     │
│     ├── .mcap → @mcap/core IndexedReader (range reads via BlobReadable)
│     │              ├── fzstd  (decompress zstd chunks)
│     │              └── readMessageAtTime / readMessages(topic)
│     │
│     └── .db3  → sql.js (SQLite via WASM)
│                     └── SQL: topics / messages tables, nearest-row at time
│
├── CDR Deserialization (single-pass, with progress + yields)
│     └── @foxglove/rosmsg2-serialization
│           Schemas from MCAP file or @foxglove/rosmsg-msgs-common
│
├── Application State (Zustand)
│     ├── bagStore       (BagSummary + source File)
│     ├── playheadStore  (timeNs, playing, speed, seek)
│     └── layoutStore    (open panels keyed by kind:topic)
│
└── UI (React + TailwindCSS + react-resizable-panels)
      ├── DropZone           (landing page)
      ├── Toolbar            (bag info bar)
      ├── TopicInspector     (sidebar topic list)
      ├── Timeline           (global playhead scrubber)
      └── PanelGrid
            ├── TimeSeriesPlot     (uPlot)
            ├── ImageViewer        (canvas; lazy single-frame reads)
            └── RawMessageInspector (collapsible JSON tree)
```

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
│   ├── index.ts          # Format detection + unified parser, message-read APIs
│   ├── mcap.ts           # MCAP reader (range reads, fzstd decompress, lazy seek)
│   ├── db3.ts            # SQLite reader (cached Database, nearest-at-time query)
│   ├── cdr.ts            # CDR deserializer (cached MessageReader per type)
│   └── typeRegistry.ts   # ROS2 message definitions
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
│       └── RawMessageInspector/    # JSON tree at playhead time
│
├── types/                # TypeScript interfaces
│   ├── bag.ts            # BagSummary, TopicInfo, RawMessage
│   └── ros2.ts           # Common ROS2 message types
│
└── utils/                # Helpers
    ├── time.ts           # Nanosecond timestamp utils
    ├── bytes.ts          # File size, hex dump, magic bytes
    ├── color.ts          # Topic color assignment
    └── messages.ts       # flattenNumeric, nearestMessageIndex, isImageType
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
