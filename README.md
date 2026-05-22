<div align="center">

<img src="public/favicon.svg" width="80" alt="BAGEL Logo" />

# BAGEL

### BAG ExpLoration — ROS2 Bag File Web Visualizer

**Explore ROS2 bag files in your browser. No installation required.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff.svg)](https://vite.dev/)

[**→ Live Demo**](https://bagel-ros2.vercel.app) · [Report Bug](https://github.com/Hussain004/BAGEL/issues) · [Request Feature](https://github.com/Hussain004/BAGEL/issues)

</div>

---

## 🥯 What is BAGEL?

**BAGEL** is a fully static web application that lets you explore ROS2 bag files (`.db3` and `.mcap`) entirely in your browser — no server, no installation, no account. Just drag and drop.

Robotics engineers and researchers frequently generate bag files during experiments, SLAM runs, and sensor calibration. Inspecting these files currently requires a full ROS2 installation, Foxglove Studio (increasingly commercial), or writing custom Python scripts for every inspection task.

BAGEL eliminates this friction.

### Why BAGEL?

| Problem | BAGEL Solution |
|---|---|
| Need ROS2 installed to inspect bag files | Works in any modern browser |
| Foxglove Studio going commercial | 100% open source, MIT licensed |
| `ros2 bag info` gives text-only output | Rich visual interface with search & filtering |
| Can't share bag contents easily | Zero-install — send anyone the URL |
| Students struggle with ROS2 tooling | No setup required, just drag and drop |

---

## ✨ Features

### v0.1 — Foundation & File Parsing *(Current)*

- 🗂️ **Drag & drop** `.db3` and `.mcap` ROS2 bag files
- 🔍 **Auto-detect** file format from extension and magic bytes
- 📊 **Topic Inspector** — browse all topics with:
  - Topic name (color-coded by message type category)
  - Message type with package badge
  - Message count
  - Publishing frequency (Hz)
- 📈 **Bag summary** — duration, total messages, file size, active topics
- 🔎 **Search & filter** — quickly find topics by name or type
- 📋 **Sort** — by name, message count, or frequency
- 🌙 **Premium dark theme** — glassmorphism, micro-animations, gradient accents
- 🔒 **100% client-side** — your data never leaves your machine
- ⚡ **Fast** — WASM-powered SQLite, streaming MCAP parser

### Roadmap

| Version | Features |
|---|---|
| **v0.2** | Time-series plotting, image viewer, global playhead |
| **v0.3** | 2D trajectory visualization, TF tree graph |
| **v0.4** | 3D point cloud rendering, LaserScan overlay |
| **v0.5** | CSV/JSON export, keyboard shortcuts, sample bag loader |

---

## 🚀 Quick Start

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

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | React 19 + TypeScript | Component-based UI |
| **Build** | Vite 8 | Fast HMR, WASM support |
| **Styling** | TailwindCSS v4 | Utility-first dark theme |
| **State** | Zustand | Lightweight state management |
| **MCAP Parsing** | @mcap/core | Official MCAP reader (MIT) |
| **SQLite** | sql.js (WASM) | Parse .db3 files in-browser |
| **CDR Deser.** | @foxglove/rosmsg2-serialization | ROS2 message deserialization |
| **Type Registry** | @foxglove/rosmsg-msgs-common | Pre-built ROS2 message defs |
| **Deployment** | Vercel | Static site hosting |

---

## 🏗️ Architecture

```
User's Browser
│
├── File Input (drag & drop)
│     │
│     ▼
├── Format Detection (.db3 or .mcap?)
│     │
│     ├── .mcap → @mcap/core (native JS)
│     │               └── Reads channels, schemas, statistics
│     │
│     └── .db3 → sql.js (SQLite via WASM)
│                     └── Queries: topics, messages tables
│
├── CDR Deserialization
│     └── @foxglove/rosmsg2-serialization
│           Uses schemas from file (MCAP) or type registry (DB3)
│
├── Application State (Zustand)
│     ├── bag: BagSummary
│     ├── topics[]
│     └── isLoading, error, progress
│
└── UI (React + TailwindCSS)
      ├── DropZone (landing page)
      ├── Toolbar (bag info bar)
      └── TopicInspector (topic list panel)
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

## 📁 Project Structure

```
src/
├── parsers/              # Core parsing (no React deps)
│   ├── index.ts          # Format detection + unified parser
│   ├── mcap.ts           # MCAP reader (@mcap/core)
│   ├── db3.ts            # SQLite reader (sql.js WASM)
│   ├── cdr.ts            # CDR deserializer
│   └── typeRegistry.ts   # ROS2 message definitions
│
├── store/
│   └── bagStore.ts       # Zustand state (bag, loading, errors)
│
├── components/
│   ├── layout/
│   │   ├── DropZone.tsx   # Drag & drop landing page
│   │   └── Toolbar.tsx    # Top info bar
│   └── panels/
│       └── TopicInspector/ # Topic list with search/sort
│
├── types/                # TypeScript interfaces
│   ├── bag.ts            # BagSummary, TopicInfo
│   └── ros2.ts           # ROS2 message types
│
└── utils/                # Helpers
    ├── time.ts           # Nanosecond timestamp utils
    ├── bytes.ts          # File size, hex dump
    └── color.ts          # Topic color assignment
```

---

## 🤝 Contributing

Contributions are welcome! Here's how to get started:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development

```bash
pnpm install          # Install dependencies
pnpm dev              # Start dev server with HMR
pnpm build            # Production build
pnpm preview          # Preview production build
```

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Foxglove](https://foxglove.dev/) for the excellent open-source ROS2 parsing libraries
- [sql.js](https://sql.js.org/) for making SQLite run in the browser
- The ROS2 community for building the robotics ecosystem

---

<div align="center">

**Built with ❤️ for the robotics community**

*If BAGEL saves you time, consider giving it a ⭐ on [GitHub](https://github.com/Hussain004/BAGEL)!*

</div>
