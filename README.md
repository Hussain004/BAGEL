<div align="center">

<img src="public/favicon.svg" width="80" alt="BAGEL Logo" />

# BAGEL

### BAG ExpLoration: ROS Bag File Web Visualizer

**Explore ROS1 & ROS2 bag files in your browser. No installation required.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8-646cff.svg)](https://vite.dev/)
[![Version](https://img.shields.io/badge/version-0.8.1-3b82f6.svg)](https://github.com/Hussain004/BAGEL/releases)

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

<video src="https://github.com/user-attachments/assets/5fed57a9-50d8-41e3-aefe-58a18987f57e" controls width="100%"></video>

### Stress test with a real-world SLAM dataset

<video src="https://github.com/user-attachments/assets/d7ae858e-5e8e-40c2-90bd-a296c3991d06" controls width="100%"></video>

> Data featured in this demo is from the excellent open-access **M2DGR dataset** provided by the **SJTU-ViSYS team**, which was instrumental in stress-testing this visualizer's spatial rendering capabilities.

---


## Features

### v0.8.1: Custom Message Schemas for `.db3`

Everything in v0.8, plus:

- **Paste-your-own `.msg` definition for `.db3` topics**: ROS2 `.db3` bags don't embed message schemas, so historically anything outside the bundled `ros2galactic` set (std/geometry/sensor/nav/tf2/visualization/builtin_interfaces/rcl_interfaces) silently failed to decode — most painfully for `px4_msgs`, `autoware_msgs`, and every in-house planner / vendor package. v0.8.1 adds a paste flow: a topic with an unknown type now renders with a `schema missing` amber badge in the sidebar, and clicking the row opens a modal where you paste the type's `.msg` definition (primary type at the top, every dependency block separated by `=====`, the same form `mcap convert` writes). The schema is validated by parsing through `@foxglove/rosmsg` before commit, so a typo surfaces inline rather than silently shipping a broken decoder into your browser.
- **Persisted across bags + sessions**: saved schemas live in `localStorage` under `bagel:custom-schemas:v1`, so you paste once per type and every future bag that mentions it decodes automatically. Roboticists tend to work with a stable set of message packages across many bags; this keeps the per-bag friction at zero after the first paste.
- **Override priority**: user-supplied schemas win against the bundled registry, so you can shim a vendor fork of a stock package (e.g. a `sensor_msgs/Imu` with extra fields) without rebuilding BAGEL. The override map is keyed by every alias form (`pkg/Type` and `pkg/msg/Type`) so a topic tagged with either convention picks the right entry.
- **Cache invalidation on edit**: when a schema is added, the worker drops its CDR `MessageReader` cache and the `.db3` per-(topic, timestamp) decoded LRU; the main thread drops the topic-message cache. Re-opening a panel on a previously broken topic produces fresh values rather than the cached `null` from the pre-schema attempt.
- **Manage schemas from the About modal**: a new section lists every saved entry with `edit` and `delete` affordances. Hidden when no schemas are saved, so the modal stays compact for the common case.

### v0.8: MarkerArray + ROS1 Compression

Everything in v0.7, plus:

- **`visualization_msgs/MarkerArray` rendering**: drop a MarkerArray topic into the existing 3D panel and ten of the twelve standard marker primitives render correctly — `CUBE`, `SPHERE`, `CYLINDER`, `ARROW` (both the pose form and the `points`-as-start-end form), `LINE_STRIP`, `LINE_LIST`, `CUBE_LIST`, `SPHERE_LIST`, `POINTS`, and `TEXT_VIEW_FACING` (a billboarded sprite that always faces the camera, sized by `marker.scale.z` in metres). `MESH_RESOURCE` and `TRIANGLE_LIST` aren't supported in v0.8.0 — external `package://` mesh URIs can't be resolved from a static viewer, and triangle lists are rare enough in published bags to defer — so they fall back to a pink wireframe placeholder with a console warning rather than crashing the scene.
- **Per-frame TF chains**: each marker's `header.frame_id` composes through the existing `composeTFChain` infra so a debug arrow placed in `base_link` rides with the robot when the world frame is `map`, even when the surrounding MarkerArray includes other markers in `odom`. The new `MarkerSet` manager groups markers by source frame into per-frame Three.js subgroups so one matrix-write per frame replaces the N writes you'd otherwise pay. `frame_locked` is honored transparently — every refresh re-composes the chain at the current playhead time.
- **Action + lifetime semantics**: `ADD`/`MODIFY` insert or update by `(ns, id)`; `DELETE` removes that key; `DELETEALL` clears the entire set. Markers with non-zero `lifetime` auto-vanish once `stamp + lifetime < playhead`, and re-appear when you scrub back across them. Type changes mid-stream (a debug arrow that flips into a cube on a later message) are detected on update and trigger a recreation of the underlying Object3D, since you can't feed a Mesh update into a Sprite.
- **Namespace filter**: the Display card grows a checklist of every namespace the topic has ever published, persisted per-panel in the same store the v0.4 / v0.7.1 display settings live in. Real planner bags publish 5-10 namespaces in one MarkerArray (`/planner/expanded`, `/local_costmap/raw`, …); hiding the noisy ones makes the panel usable on bags from `move_base` or `nav2` without having to author topic-level filters upstream.
- **Incremental ingest with backward-scrub safety**: marker state is persistent — every `ADD` lives until `DELETE` or lifetime expiry — which means a 60 Hz playhead can't just re-decode "the message at the playhead" the way clouds and poses do. The ingest effect binary-searches the cutoff index, incrementally applies new actions on forward scrub, and clears + replays from the start on backward scrub (replaying a sub-range is messier than it sounds because a DELETE at index 50 only "undoes" an ADD at index 40 if we still know about it). A small watermark ref tracks how far we've ingested so paused playback doesn't re-walk every message on each render.
- **ROS1 `bz2` / `lz4` chunk decompression**: `rosbag record --bz2` and `--lz4` bags now load through the same drag-and-drop flow as uncompressed ones, closing the last "BAGEL can't open this ROS1 bag" gap from v0.6. Pure-JS decoders (`seek-bzip` and `lz4js`) live in the parser worker so even the slower bz2 path (~5-10 MB/s on a modern laptop) doesn't block the UI. Uncompressed bags (the `rosbag record` default and what most teams ship) still never hit the decoders at all.
- **Bundled sample bag exercises every new primitive**: `public/sample-bags/tour.mcap` gains a `/markers` topic at 1 Hz with 8 markers across two namespaces — `status` (a cube body, sphere head, billboarded "robot" text label, forward arrow, and cylinder mast, all riding with the robot in `base_link`) and `planning` (a green line strip drawing the figure-eight path, yellow cube-list waypoints stepping ahead of the playhead, and scattered violet feature points fixed in `odom`). One drag exercises every supported primitive type and gives the namespace filter something to filter.

### v0.7: Dockable Panels

Everything in v0.6, plus:

- **Drag-to-dock layout**: every panel header is now a drag handle. Pick up a panel and drop it on another panel's top / right / bottom / left edge to split that panel into a horizontal or vertical pair (same UX convention as VSCode and Foxglove). The drop targets are pointer-event overlays that light up the destination half on hover; a release on the panel's centre cancels the drag. Image topics in particular finally get to live above a TF / plot row instead of being squeezed into a landscape strip.
- **Recursive split tree**: `layoutStore` is no longer a flat array; it's a tree of `SplitNode | PanelLeaf` with normalisation invariants. Single-child splits collapse into their child, empty splits disappear, and same-orientation parents absorb new siblings rather than nesting so dragging a third panel into an existing horizontal row keeps the row flat instead of growing a `H(A, H(B, C))` tower. `react-resizable-panels` continues to handle the actual resize chrome, so drag handles between siblings still work in both axes.
- **Tree-aware URL hashes**: the share link now encodes the layout as a tiny `P/H/V` recursive form (e.g. `H(Pplot:%2Fodom,V(Pimage:%2Fcam,Pplot:%2Fimu))`). v0.5 / v0.6 flat hashes (`p=plot:topic1,image:topic2`) are still accepted and lift into a single horizontal split, so existing share links keep working.
- **Per-panel state survives docking**: panel ids are still `kind:topicName`, which docking doesn't touch so the 3D viewer's display settings, world frame, accumulator state, and orbit pivot all persist when you rearrange panels around the layout. v0.7.1 (above) extends this to the 2D panels.
- **Touch/pen aware drag**: the header pointer-down explicitly releases pointer capture so the drop-zone overlays receive `pointerenter` / `pointerup` events on touch and stylus inputs, not just mouse. Field-iPad-on-a-bag-file is still the goal.
- **Esc behaviour preserved**: closing the most-recent panel with `Esc` still works, even though "last item in a flat array" no longer maps onto a tree. The store keeps a small `openOrder: string[]` alongside the tree to track insertion order independently of where each panel ended up after docking.
- **2D panels also now survive a dock**: when a drag changes the parent split's orientation, `react-resizable-panels` remounts the affected subtree because that's a `Group` identity change and there's no way around it from inside React. Up through v0.7 only the 3D panel kept its display settings across this remount (it already lifted state into a per-`panelId` zustand store). v0.7.1 does the same for the other panels: `TimeSeriesPlot` keeps its **series visibility toggles** and **x-axis zoom range**, `TrajectoryPlot` keeps its **pan + zoom view**, `TFTree` keeps the **selected frame**. Same store-keyed-by-id pattern, same close-and-reopen-restores-too bonus.
- **Smart zoom-range capture**: uPlot fires `setScale` on every data update which the streaming plot path constantly auto-fits during decode so naively persisting on `setScale` would clobber any zoom the user just made. The new handler listens to native `pointerup` on the chart container instead, so only mouse-released gestures get saved. `dblclick` clears the saved range and snaps back to auto-fit.
- **Auto-fit only when no view is saved**: `TrajectoryPlot`'s auto-fit effect used to unconditionally snap to data bounds whenever bounds changed (i.e. as the trajectory loaded). It now uses a functional setter to leave a saved view alone and so opening a bag with a hash-restored view doesn't get yanked back to fit on the next bounds update.

### v0.6: ROS1 `.bag` Support

Everything in v0.5, plus:

- **Direct `.bag` parsing**: ROS1 bag files (`rosbag v2.0`) load through the same drag-and-drop flow as MCAP and DB3 so no more `mcap convert` or `rosbags-convert` round-trip, no more Python sidecar. Backed by `@foxglove/rosbag` with a `BlobReader` that range-reads the source `File`, so multi-GB ROS1 bags don't have to load into memory either.
- **ROS1 message deserialization** via `@foxglove/rosmsg-serialization`: each connection record's embedded `.msg` text (primary type + every dependency block separated by `=====`) feeds a cached `MessageReader`. Schemas come from the bag itself, so the bundled type registry isn't a gating factor on ROS1 the way it is on `.db3` where any custom message that was running in the producing graph deserializes too.
- **Cross-version field normalization**: ROS1 `time` and `duration` primitives decode as `{ sec, nsec }`; the rest of BAGEL assumes ROS2's `{ sec, nanosec }`. A single recursive walk per decoded message adds a `nanosec` alias on every embedded time field so the TF graph, image scrubber, and trajectory panel work identically across formats with zero per-panel changes.
- **Type-name normalization**: ROS1 emits `sensor_msgs/Image`, ROS2 emits `sensor_msgs/msg/Image`. The bag parser normalizes to the ROS2 form at the topic-info layer so the existing dispatch logic (most of which already used `.endsWith('/Foo')` and tolerated both, but a few exact-match spots didn't) stays format-agnostic going forward.
- **Format-aware drop-zone copy**: the landing screen now advertises `.mcap`, `.db3`, and `.bag` as first-class formats with distinct colour chips, and the `accept=` attribute on the underlying `<input>` opens the same set in the OS file picker.
- **Compressed-chunk error handling**: `rosbag record` defaults to uncompressed chunks (the common case), so most ROS1 bags work out of the box. `bz2`- or `lz4`-compressed bags surface a clear "re-record without compression or run `mcap convert`" message instead of an opaque library error (pure-JS bz2/lz4 decompression is the obvious follow-up if real bags need it).

### v0.5: Polish & Launch

Everything in v0.4, plus:

- **Keyboard shortcuts**: `Space` to play/pause, `← / →` to step by 1% of the bag (`Shift + ← / →` for 5%), `Home / End` to jump to the bag's start or end, `T` to focus the topic search box, `O` to open a different bag, `Esc` to close the most recent panel (`Shift + Esc` closes them all), `?` for the shortcuts cheat-sheet, `A` for the about modal. Bindings ignore text inputs so they never eat keystrokes you meant for the search box.
- **Sharable URL state**: the open panels and the playhead position are written to `location.hash` on every change (rAF-coalesced, so playback at 60 Hz isn't writing 60 times a second). Re-opening the same bag with the same URL restores the exact layout and time cursor. Panels for topics that no longer exist are silently dropped.
- **Per-topic export**: every panel header now has an Export menu that downloads the topic as CSV (flattened numeric leaves, one row per message: exactly what `plot.csv` looked like in `rqt_bag`) or NDJSON (the full deserialized message stream, one object per line, with `BigInt` timestamps stringified and `Uint8Array` fields base64-encoded so the file is valid JSON). Caps at 250k messages per topic to keep the in-browser exporter from OOMing on multi-million-message logs.
- **Voxel-grid point accumulation**: the v0.4 ring buffer is now joined by a true voxel-grid downsample mode. Each appended point is snapped to a regular 3D grid keyed by `(floor(x/v), floor(y/v), floor(z/v))` and only the most recent point per cell is kept. The result is a stable map of the visited ground rather than ten ring-buffer copies of the same area. Voxel size is exposed as a 5 cm – 2 m slider in the Display card. Switching modes or voxel size mid-flight clears the accumulator (storage layouts differ).
- **About + Shortcuts modals**: reachable from the BAGEL logo (top-left of the toolbar), the `?` icon in the toolbar, or the keyboard. Generated from the same `SHORTCUTS` table the handler uses, so new bindings auto-appear.
- **Try a sample bag**: a 1.7 MB bundled `tour.mcap` ships in `public/sample-bags/`. It's generated from `scripts/build-sample-bag.mjs` (an idempotent Node script that uses `@mcap/core` + `@foxglove/rosmsg2-serialization` to write a 30-second synthetic `/odom + /imu + /scan + /tf` set), so first-time visitors can exercise every panel without supplying their own data.
- **Accessibility pass**: `role="dialog"` + `aria-modal` on every modal with focus management (close button gets initial focus, previously-focused element restored on dismissal); `aria-label` / `aria-valuemin/now/max` on the timeline scrubber; `role="list"` + per-row `aria-label` on the topic inspector; focus-visible rings on every interactive control via a single CSS pass that suppresses the default outline only on `:focus` (mouse) while keeping it on `:focus-visible` (keyboard); `prefers-reduced-motion` strips animations to a single static frame.
- **Responsive toolbar**: the full stats row collapses to a compact `duration · msgs · topics` strip on tablet-width viewports and stacks below 900 px so portrait iPads no longer push the close button off-screen.

### v0.4: 3D Visualization

Everything in v0.3, plus:

- **ThreeDScene panel**: a Three.js-powered 3D viewer that opens on `sensor_msgs/PointCloud2`, `sensor_msgs/LaserScan`, and pose-bearing topics (`Odometry`, `PoseStamped`, `PoseWithCovarianceStamped`, `TransformStamped`). Orbit controls (drag to rotate, wheel to zoom, right-drag to pan) with damping; ROS Z-up convention so "up" actually points up. A faint ground grid in the XY plane and a world-axis triad keep the user oriented at all zoom levels.
- **PointCloud2 rendering**: decodes the packed binary layout from each message's `fields` array which supports `FLOAT32 / FLOAT64 / INT8…INT32 / UINT8…UINT32` datatypes, the RGB-packed-in-a-float ROS convention, and intensity / ring fields. Colormaps: **height** (z), **intensity** (or ring index if no intensity), and **single colour**. Sub-samples to 250k points per frame so a full 1 M-point sweep doesn't lock the page; reuses GPU buffers across playhead ticks when the point count is stable. A FLOAT32 fast path reads x/y/z through a typed-array view (no DataView dispatch) for typical Velodyne / Ouster / RealSense streams.
- **Livox CustomMsg support**: list-of-struct point clouds (`livox_ros_driver2/msg/CustomMsg` and similar) share the same render pipeline which gets detected by shape, not by hard-coded type name, so converted bags with non-standard package names still work.
- **LaserScan overlay**: lifts the polar `(range, angle)` ring into 3D at `z=0` so it sits naturally on top of the ground grid. Coloured by distance from the sensor (Turbo colormap) so depth is visible at a glance.
- **Pose / Odometry markers**: rendered as a coordinate-frame axes triad with a forward-pointing arrow, oriented by the message's quaternion. Track a robot's pose through the scene in real time as the playhead advances.
- **TF-aware rendering**: when the bag has `/tf` and `/tf_static`, every panel composes the chain from the source topic's `header.frame_id` up to a chosen *world frame* (`map` or `odom` by default) and applies it to the rendered geometry. A dropdown in the panel's Display card lets you switch the world frame at any time. Without TF, panels render directly in the topic's local frame and surface that fact.
- **Custom orbit pivot**: `Shift+Click` anywhere in the 3D viewport sets the orbit centre to that scene point. Raycasts the live cloud (and the accumulator) with a pick threshold tied to the camera view radius, falls back to the `z=0` ground plane when nothing is hit. A wireframe sphere marks the chosen pivot; a `Reset pivot` button reverts to the auto-fit centre without disturbing the camera angle. Solves the case where the cloud isn't centred on its sensor origin and orbit feels off-axis.
- **Range filter**: a `limit range` slider (1–200 m) in the Display card drops returns farther than the cap before bounds + height-colour stats are computed. Recovers useful height colouring on long-range Velodyne / Ouster scans where a handful of 100 m returns would otherwise compress the colormap into a thin slab.
- **Point accumulation**: a ring-buffer mode that builds up a running "map" view from many frames (drone flights, SLAM runs, vehicle traversals). New frames are sub-sampled (`per-frame pts`, 1k–500k) and appended in world frame via the cached source→world TF matrix; oldest points drop FIFO once the budget (0.25M–10M) is hit. Auto-clears on topic / world-frame / up-axis change, and warns when no `/tf` is present (frames will overlap in the sensor frame). Voxel-grid downsampling for "build a 60-second field map" workflows is slated for v0.5.
- **Custom up-axis**: a 6-option selector (`±X / ±Y / ±Z up`) handles bags whose clouds aren't ROS-standard Z-up for upside-down PCDs, drone NED frames, camera-aligned LiDAR rigs. Applied as a pre-multiplication on the TF chain so it composes for free with the existing graph; no decoder changes.
- **Display controls**: per-panel pop-out card with color-mode buttons (PointCloud2), point-size slider, range filter, accumulation controls, grid / axes toggles, up-axis selector, and the world-frame selector.
- **3D quick-button**: `PointCloud2` and `LaserScan` topics expose a `3D` button in the sidebar and default-open the 3D panel on click. Pose-bearing topics gain a `3D` option alongside their existing `Path` and `Plot` buttons.

### v0.3: Trajectory, TF Tree & Web Worker

Everything in v0.2, plus:

- **TrajectoryPlot** panel: click any pose-bearing topic to render its 2D path. Supports `nav_msgs/Odometry`, `geometry_msgs/PoseStamped`, `PoseWithCovarianceStamped`, `Pose`, `Point(Stamped)`, `TransformStamped`, and `sensor_msgs/NavSatFix` (equirectangular projection from the first GPS fix). The polyline runs blue → red along the path, with a playhead marker that follows the bag time and a heading arrow when the source message has an orientation quaternion. Mouse-wheel zoom, drag-to-pan, and a dynamic scale bar in metres / km.
- **TFTree** panel: parses `/tf` and `/tf_static` into a single graph and renders the frame hierarchy as an interactive top-down tree. Click any frame to see its current transform (translation, quaternion, Euler angles in degrees) at the playhead time, and to highlight the root → frame chain. Static and dynamic edges are visually distinct (dashed vs solid).
- **Web Worker parsing**: every heavy operation like initial bag parse, MCAP chunk zstd-decompression, sql.js queries, CDR deserialization which now runs in a dedicated parser worker. The React render loop stays responsive while a topic decodes; scrubbing the timeline, toggling panels, and resizing the layout no longer block on the bag. `@mcap/core`, `sql.js`, `fzstd`, and the `@foxglove/*` libraries live entirely in the worker chunk and never touch the UI thread.
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

v0.8 closes out the ROS1 compatibility story (bz2 + lz4) and adds the marker primitives navigation users rely on. Possible future directions:

| Idea | Notes |
|---|---|
| Multi-bag overlay | Drag two bags in to compare runs side-by-side on the same timeline, including mixing a ROS1 `.bag` with a ROS2 `.mcap`. The architectural lift is per-bag parser workers, per-bag colour tints, and a time-alignment strategy (wall-clock / bag-start / user-anchor). Pencilled in as the v0.9 headline. |
| `nav_msgs/OccupancyGrid` rendering | Render a SLAM-produced map as a textured plane in the 3D scene, posed by `info.origin` and TF-resolved to the world frame. Makes "load a SLAM bag, see the map" a one-drag operation. |
| GPS-on-OpenStreetMap underlay | The existing `TrajectoryPlot` already projects `NavSatFix` to local x/y; an opt-in OSM tile underlay would give a GPS trace real spatial context. Off by default since fetching tiles breaks BAGEL's pure-offline pitch. |
| Light theme | Dark is intentional (data viz reads better on dark backgrounds), but a toggle would help in bright field conditions. |
| Plugin panels | Lets users build custom views (e.g. depth-image colorisation, GPS overlay) against a stable panel API. |
| Cloud-hosted shareable URLs | The local hash is great for personal reuse like a tiny backend would unlock real link-sharing. |

---

## Quick Start

### Use the Live Demo

1. Open [**bagel-ros2.vercel.app**](https://bagel-ros2.vercel.app)
2. Drag your `.mcap`, `.db3`, or `.bag` file onto the page or click **Try a sample bag** for a quick tour
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
      ├── Format detect (.db3, .mcap, or .bag?)
      │     ├── .mcap → @mcap/core IndexedReader (range reads via BlobReadable)
      │     │              └── fzstd (decompress zstd chunks)
      │     ├── .db3  → sql.js (SQLite compiled to WASM)
      │     │              └── nearest-row-at-time SQL
      │     └── .bag  → @foxglove/rosbag (range reads via BlobReader)
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
Vite emits as a sibling of `index.js`. The worker's MCAP reader,
sql.js database, and ROS1 `Bag` instance are held in module-level
caches that survive across panel reads, so opening a second panel on
the same topic doesn't re-pay the parse cost.

### Supported Message Types

BAGEL's built-in type registry covers all standard ROS2 packages:

| Package | Examples |
|---|---|
| `std_msgs` | String, Int32, Float64, Bool, Header |
| `geometry_msgs` | Pose, Twist, Transform, Point, Quaternion |
| `sensor_msgs` | Image, Imu, LaserScan, NavSatFix, PointCloud2 |
| `nav_msgs` | Odometry, Path, OccupancyGrid |
| `tf2_msgs` | TFMessage |
| `visualization_msgs` | Marker, MarkerArray (CUBE / SPHERE / CYLINDER / ARROW / LINE_STRIP / LINE_LIST / CUBE_LIST / SPHERE_LIST / POINTS / TEXT_VIEW_FACING) |
| `rcl_interfaces` | Log, ParameterEvent |
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
│   ├── mcap.ts           # MCAP reader (range reads, fzstd decompress, lazy seek)
│   ├── db3.ts            # SQLite reader (cached Database, nearest-at-time query)
│   ├── bag.ts            # ROS1 .bag reader (cached Bag, type-name normalisation)
│   ├── cdr.ts            # CDR deserializer (cached MessageReader per type)
│   ├── rosbag1.ts        # ROS1 deserializer (cached reader + time-field alias pass)
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
│       └── ThreeDScene/            # Three.js 3D viewer (PointCloud2, LaserScan, Pose, MarkerArray)
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
├── markerObjects.ts          # Per-type factories for visualization_msgs/Marker
├── markerSet.ts              # (ns, id) → Object3D manager + frame-grouped TFs
├── accumulator.ts            # Ring buffer + voxel-grid downsample for accumulation
└── tfTransform.ts            # composeTFChain + pickWorldFrame helpers
```

### Build-time scripts

- `scripts/build-sample-bag.mjs`: generates `public/sample-bags/tour.mcap`, a ~1.8 MB synthetic bag with `/odom`, `/imu/data`, `/scan`, `/tf`, and `/markers` topics over 30 seconds. The `/markers` topic publishes 8 markers at 1 Hz across `status` (base_link, frame-locked) and `planning` (odom) namespaces, so a fresh checkout exercises the v0.8 MarkerArray renderer end-to-end. Idempotent; rerun only if the synthetic data needs changing. The output is committed so a fresh checkout serves the sample without a Node build step.
- `scripts/verify-sample-bag.mjs`: parses the generated bag with `McapIndexedReader` and prints the topic table; smoke-test the writer when you change the synthesiser.
- `scripts/verify-parsers.mjs`: Node-side verification of the `.db3` and `.mcap` parser paths against the real test fixtures in `test_files/`.

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
