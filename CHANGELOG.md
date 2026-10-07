# Changelog

All notable changes to BAGEL are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-version feature detail lives in [FEATURES.md](FEATURES.md). The
[README](README.md) covers current supported formats and panels.

## [Unreleased]

- Two bags can be compared. With two or more bags loaded, the Health panel has a
  "Compare" view that lists, against a bag you choose: topics only in one bag,
  topics whose type changed (ROS 1 and ROS 2 spellings of one type are not
  flagged), and topics whose publish rate differs by more than 10%, including a
  topic that all but stopped publishing. Each row can open the topic from
  either bag, matching topics are an opt-in list, and "Copy report" puts a
  Markdown summary on the clipboard for a bug report. It works from the bag
  summaries alone, so it is instant.
- Plots have a "stats" toggle and CSV / SVG / PNG export of the range you are
  looking at. Zoom into a region (drag on the chart) and the table shows the
  sample count, min, max, mean, standard deviation and RMS of every visible
  series over just that span. Variance is computed with Welford's update, so a
  tiny spread on a large offset stays accurate. The buttons export that range:
  CSV rows, a light print-ready SVG figure (reduced to a per-pixel envelope so a
  million-point series stays small), and a PNG of the chart.
- Fixed the plot's saved zoom lagging one gesture behind. The range was read on
  `pointerup`, before uPlot applied the drag, so a re-dock restored the previous
  zoom rather than the latest.
- New State panel for booleans, strings and integer enums. A control mode, an
  e-stop flag or a behaviour-tree node name is drawn as lanes of coloured runs
  with the value written on each, the current value beside the lane, and a
  hover tooltip with the run's start, end and message count. Click a run to seek
  to the moment that state began. `std_msgs` `Bool` and `String` topics now open
  here by default (a `String` previously landed on a plot with nothing to plot);
  integers offer it alongside the plot. Any scalar field of a message can be
  toggled on as a lane.
- Plots offer roll / pitch / yaw for any quaternion. When the plotted message has
  a complete `x/y/z/w` set (an `Imu`'s orientation, an `Odometry` pose, a bare
  `Quaternion`), a "+ roll/pitch/yaw" button adds three degree series, using the
  ZYX convention ROS uses for rpy. They are ordinary expressions, so they can be
  exported and combined like any other series. Not covered: a 3D IMU view.
- Image panels can draw 2D detection boxes. A "boxes" picker in the image
  header lists the bag's `vision_msgs/Detection2DArray` topics; boxes are drawn
  with their class and score in a stable per-class colour. Both `vision_msgs`
  layouts are read (the newer `center.position` / `hypothesis.class_id` form
  and the older `Pose2D` / `id` form). Boxes follow the image through zoom and
  pan and through "undistort". A detection is matched to an image by header
  stamp and hidden, with the offset shown in the footer, if it is more than
  200 ms away, so a slow detector never paints boxes on the wrong frame.
- The 3D scene draws `nav_msgs/Path`, `geometry_msgs/PoseArray` and
  `PolygonStamped` / `Polygon` topics. Previously these had no 3D view (a path
  opened as a blank pose scene). A path is a line, a polygon a closed outline,
  and a pose array one instanced mesh of arrows (up to 20,000 poses, enough
  for a Nav2 particle cloud). They open as a panel of their own and also join
  the "Overlays" list, so a map, LiDAR scan, odometry and global and local
  plans can share one TF-aligned scene, each with its own colour.
- Time-series plots can show fields from other topics. "+ series" in a plot's
  footer picks any topic (from any loaded bag) and one of its numeric fields and
  draws it on the same axes, aligned on the union of both topics' timestamps.
  Extra series get a name usable in math expressions, so `cmd_x - x` compares a
  command against the measured value; between samples each input is held at its
  last value. A second bag follows the timeline's alignment mode. Extra series
  are kept per panel (they survive docking) but are not part of shared links.
- Split recordings open as one bag. Pick or drop the parts of a
  `ros2 bag record --max-bag-size` / `--max-bag-duration` run (`name_0.mcap`,
  `name_1.mcap`, ...), a ROS1 `--split` recording, or a whole bag folder, and
  BAGEL merges them into a single recording: one topic list, one timeline, and
  reads that cross part boundaries. Works for `.mcap`, `.db3` and `.bag`. A
  `metadata.yaml` in the selection is used as the source of truth for which
  files belong together. Parts are matched by name only when numbered from 0 in
  the same folder, so two unrelated runs (`run_1`, `run_2`) stay separate bags.
  Editing/trimming is not available for split recordings yet.
- The Health panel can put its findings on the timeline. "Mark on timeline"
  adds a rose tick for each topic gap and out-of-order timestamp (bursts merge,
  capped at 200). Ticks follow the bag through alignment changes, are never
  saved or written to shared links, and can be pinned into real bookmarks.
- Depth images get colormaps. Raw `16UC1` and `32FC1` image topics, which
  previously failed with "Unsupported image encoding", now decode, and together
  with `compressedDepth` they share a colormap select (gray, turbo, inverted
  turbo), an auto range (1st to 99th percentile of valid pixels) with
  optional min/max overrides, and a labelled color bar. Invalid pixels
  (0, NaN, Infinity) are always drawn black.

## [1.7.1]

Documentation, robustness, and cleanup release.

- Stopped the 3D scene decode loop from running after a panel unmounts, and
  fixed the map scheme toggle being a no-op.
- Made modal escape handling stack correctly so Esc peels one layer at a time
  instead of dismissing everything.
- Consolidated the spatial-overlay TF transform into one path and documented
  the behaviour.
- Repo-wide ESLint cleanup, including the `react-hooks` v7 rule set.

## [1.7.0]

Gaussian Splat support.

- Splat-flavored `.ply` (detected by header, not extension, so a plain
  colored-point-cloud `.ply` still opens in the regular 3D panel), plus `.splat`
  and `.ksplat`.
- A dedicated Splat panel with outlier-robust camera auto-fit, shift+click
  custom orbit pivot, and keyboard fly-through and orbit controls.
- Splat spin shortcuts on all three axes, independent of camera movement.

## [1.6.1]

Foxglove interoperability.

- Support for Foxglove WebSocket channels using JSON schema encoding
  (`schemaEncoding: "jsonschema"`, `encoding: "json"`).

## [1.6.0]

Standalone point cloud files.

- `.pcd`: all three PCD 0.7 encodings (`ascii`, `binary`, `binary_compressed`
  with LZF), and every color mode (height, intensity, rgb, single).
- `.ply`: ASCII, `binary_little_endian`, and `binary_big_endian`, with RGB from
  `red`/`green`/`blue` uchar properties or a packed `rgb` float.
- Both feed the 3D panel through a synthetic `sensor_msgs/PointCloud2` message,
  so all existing color, range-filter, and accumulation settings apply.

## [1.5.0]

Live connectivity.

- Paste a `ws://` or `wss://` URL to connect to a live robot running
  `foxglove_bridge` or `rosbridge_suite`; every panel updates in real time.
- A per-topic ring buffer holding the last 10,000 messages, with a Follow/Pause
  control for scrubbing back into history without disconnecting.
- Automatic reconnection with exponential backoff.

## Earlier

Earlier release highlights moved out of the README to keep it short. Notable
milestones: the initial parser foundation for `.mcap`, `.db3`, and `.bag`; the
drag-and-drop landing page; the panel layout system with drag-to-dock and
shareable URL state; multi-bag loading; clip export; URDF robot models; the
light theme; and the schema-paste flow for `.db3` bags that ship without
schemas.

Git history for the full detail is available in the
[commit log](https://github.com/Hussain004/BAGEL/commits/main).