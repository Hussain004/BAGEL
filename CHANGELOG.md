# Changelog

All notable changes to BAGEL are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-version feature detail lives in [FEATURES.md](FEATURES.md). The
[README](README.md) covers current supported formats and panels.

## [Unreleased]

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