# Changelog

All notable changes to BAGEL are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Per-version feature detail lives in [FEATURES.md](FEATURES.md). The
[README](README.md) covers current supported formats and panels.

## [Unreleased]

- 2D goal tool for live connections. In a 3D panel's top-down (2D) view, "Goal"
  lets you drag on the floor to place a navigation goal and aim it; it appears
  as an arrow with its position and heading in words, and is sent only when you
  press "Send goal", as a `PoseStamped` on a topic you can change (default
  `/goal_pose`) in the panel's fixed frame. It needs Robot control enabled, and
  its channel is withdrawn when control is turned off or the connection drops.
- Fixed: a ROS 1 `TwistStamped` from the control card was missing the header's
  sequence number, so a ROS 1 bridge would have read it wrongly.
- Service calls from the robot control card. With control enabled and a bridge
  that has the `services` capability, the card lists the services, prefills a
  JSON request from the service's own schema, sends it in the encoding the
  service advertises (CDR, ROS 1 or JSON) and shows the answer or the server's
  failure message. Calls are refused until control is enabled, time out after
  10 s (saying the call may still have run), and fail at once if the connection
  drops. The card is also scrollable on short screens.
- Robot control for live connections. With a Foxglove bridge that allows client
  publishing, the Control button on the toolbar (or "Robot control" in the
  palette) opens a card with a drag pad and W A S D / arrow keys that publish a
  `geometry_msgs/Twist` or `TwistStamped` at 10 Hz in the encoding the server
  accepts (CDR, ROS 1 or JSON). It is off until you press "Enable control", then
  a red banner shows. Speeds are capped by two sliders and by hard ceilings
  (2 m/s, 3 rad/s). Letting go in any way sends a stop: releasing the pad or a
  key, the page losing focus, the tab being hidden, Esc, closing the card,
  disconnecting. A dropped connection disarms without sending, and a reconnect
  starts disarmed. BAGEL adds no authentication; that is the bridge's job.
- Under it, the client side of the Foxglove protocol: advertising a client
  channel, publishing, and service call frames (service calls themselves come
  in a later release).
- PX4 flight logs: drop a `.ulg` file in like any other recording. Every
  logged uORB message becomes a topic (`/vehicle_attitude`, and
  `/sensor_gyro_1` for a second instance), so the plot, raw, state and search
  panels work on them directly. GPS topics also carry latitude, longitude and
  altitude in the NavSatFix shape, so the path view and map tiles work;
  logged text opens in the Log panel at its proper severity; parameters, the
  changes made in flight, the log's info and dropout markers are topics too
  (`/parameters`, `/parameter_changes`, `/info`, `/ulog_dropouts`). Logs from
  crashes are cut off mid-message and still open with everything before the
  cut; a damaged stretch is skipped from the next sync marker rather than
  ending the log. Log editing and the 3D panel do not apply to ULog.
- Two small hints. A 3D view over a bag with no `/tf` now says so ("no /tf in
  this bag: drawn in its own frame"), whether or not the frame is known. An
  image panel whose bag has CameraInfo topics but none that matches the camera
  by name offers "Choose one" instead of leaving undistort and LiDAR projection
  mysteriously unavailable.
- The heavier dialogs (bag editing, clip export, frame export, share, URDF and
  schema paste) now download when first opened: the first screen is about 24 KB
  gzipped lighter, and the size budget for the main chunk is now 200 KB.
- Export frames: turn a stretch of a recording into a dataset. "Export frames"
  (the Labels list, or `Ctrl/Cmd+K` then "frames") writes the images of one
  camera topic over the whole bag or one labelled range into a zip, every Nth
  frame if you like, with a `frames.csv` giving each file's time on the bag's
  clock, the message's own header stamp and the labels covering it. JPEG and
  PNG frames are the recorded bytes, untouched; raw images become lossless PNG
  (BGR is swapped to RGB, 16-bit stays 16-bit, float depth becomes 16-bit
  millimetres and is noted in the CSV). Optionally each frame is paired with
  the nearest point cloud from a topic you pick, written as a binary `.pcd`
  with intensity and ring. It reads the range in small batches so a long bag
  does not fill memory, can be cancelled, stops at a frame limit you set (or
  about 2 GB), and says which frames it left out and why.
- Under it, a range reader (`readMessagesInRange`) for MCAP, ROS 1 and `.db3`
  files that returns a time range in bounded batches.
- The point cloud decoder keeps intensity and ring per point (it already did
  for the hover inspector) and the PCD writer is its inverse.
- Label ranges on the timeline, and export them. Shift+drag along the timeline
  (or press `[` at the start and `]` at the end) to label a stretch of the bag;
  double-click its start tick to rename it. The new Labels list (the button
  beside the bookmark one, or `Ctrl/Cmd+K` then "labels") shows every bookmark
  and range with a note each, and exports them as JSON or CSV:
  `bag, start_ns, end_ns, label, note`, on the bag's own clock, with times as
  exact strings. CSV cells that a spreadsheet would run as a formula are kept
  as text. Ranges ride along in shared links (`bm=1.500~4.250,Turn`; an older
  BAGEL shows them as a bookmark at the start); notes stay on your device.
- Guided tours: a JSON file of steps, each with some text, a panel layout and a
  moment in the bag. A card walks you through them with Back and Next, and the
  panels change under the words. Three ship on the sample data ("What is TF?",
  "Reading a LaserScan", "Why timestamps disagree"); start one from the command
  palette (`Ctrl/Cmd+K`, type "tour") or with a link such as `#tour=tf`. Anyone
  can write their own and host it anywhere. A tour never replaces a bag you
  opened yourself, and a mistake in a tour file is reported by step and field.
  See `docs/TOURS.md`.
- Splat panels can hold more than one splat file. "Add splat" (or dropping files
  on the panel) loads further `.ply`, `.splat`, `.ksplat` or `.spz` files beside
  the one that is open; a scene list lets you pick one, move it (x, y, z),
  scale it, or remove it. The spin keys and V act on the selected scene. Added
  files live for the session only (a shared link carries the bag, not them).
- Hover a point in the 3D view to read its coordinates, intensity and ring (and
  which topic it came from). The decoder now keeps intensity and ring for each
  point whatever the colour mode, so there is no extra trip to the worker. The
  tooltip is off while you measure or drag, and follows the pointer across
  frames during playback. The sample bag's LiDAR now carries a `ring` field.
- `vision_msgs/Detection3DArray` now draws in the 3D scene as wireframe boxes,
  coloured by class (the same colour as the 2D boxes on the camera), placed
  through TF. Open the topic on its own, or add it from the Display card's
  layers list over any other 3D view. The sample bag has a `/detections_3d`
  topic and its 3D view shows it by default.
- Panels now load on demand. The first screen downloads about half as much
  JavaScript (the main chunk went from 346 KB to 185 KB gzipped); the 3D scene,
  Gaussian splat viewer, plot and the other panels download when you first open
  one, and the offline cache still holds them all. Panel labels and tooltips now
  come from one table (`PANEL_META`), so adding a panel kind is a type error until
  every place that needs it is filled in.
- Fixed: with the keyboard, pressing Enter or Space on a topic row's pin or
  panel buttons opened the row's default panel instead of using that button.
  There are now component tests (jsdom and Testing Library, in files that start
  with `// @vitest-environment jsdom`) for the dialog focus trap and Escape
  handling, the Escape layering hook, and topic row keyboard handling.
- CI now fails if the main entry, three.js or parser-worker chunk grows past a
  gzipped size budget (`pnpm check:bundle`), and a new stress test pushes 320
  reads of differently shaped zstd chunks through the shared decoder, so a
  repeat of the 1.6.4 to 1.6.6 corruption bug is caught before release.
- The sample bag is now a street run worth playing, built on one shared 3D world
  so every sensor agrees with the others. It has a 16-beam LiDAR cloud with
  intensity, a rendered 320x240 camera view (barrel distortion included, so
  "undistort" works), boxes from a 2D detector for the cars and people in view,
  a robot state machine (IDLE, EXPLORING, AVOIDING, RETURNING), a battery that
  falls through 20% near the end, log lines telling the story, a planned route
  and a particle cloud. "Explore sample data" now opens four panels: the 3D
  view coloured by intensity with the route and particles over it, the camera
  with the detections and the LiDAR projected onto it, the state timeline, and
  the battery plot. The earlier topics (`/odom`, `/imu/data`, `/scan`, `/tf`,
  `/markers`, `/map`, `/gps/fix`, camera info) are still there, and the 2D scan
  and the map now come from the same world. The file is 3.7 MB with zstd-
  compressed chunks. Regenerate it with `node scripts/build-sample-bag.mjs`.
- The toolbar no longer lets the bag chip overlap the duration, message and
  topic counts on windows around 1440 px wide: the counts keep their icons and
  show their labels on wider screens (the label is still a tooltip).
- The LiDAR projection note in the image panel moved to the panel footer, so it
  no longer covers the picture.
- Start page: the page itself is unchanged, but the three ways in are easier to
  find. "Browse files" is a solid button, "Open a folder" sits inside the drop
  zone, "Remote URL" and "Live robot" are side-by-side tabs instead of a
  vertical list, and "Explore sample data" is a bright button with a line saying
  what it is. `.spz` is listed among the accepted formats. The page still fits
  one screen without scrolling.
- Phones and upright tablets get a layout of their own. Below 768 px, or on a
  touch screen narrower than 1024 px, the panel grid shows one panel at a time
  behind a tab strip (tap a tab to switch; opening a topic shows it), the topic
  list steps aside when the first panel opens, the timeline track and its
  handle grow to touch size, the 3D and topic-row controls that used to appear
  only on hover are always visible, and header drag-to-dock is off for touch.
  Your split arrangement is untouched and returns in landscape or on a wider
  screen. The small-screen notice on the start page now says what to expect
  instead of telling people to go away. Not done: pinch-to-zoom of the
  timeline range.
- New Measure tool in the 3D scene. Turn on "Measure", click two points (on the
  point cloud where there is one, otherwise on the ground plane) and read the
  straight-line distance, the dx / dy / dz between them and the horizontal
  distance, with amber markers and a line drawn over the scene. Orbiting still
  works while the tool is on (a drag is not a click). A third click starts a
  new measurement, Esc clears it and Esc again turns the tool off, and changing
  the frame or up axis clears it. Deltas are in the scene's axes. Not done: a
  hover tooltip with a point's intensity and ring.
- The image viewer can project a LiDAR point cloud onto the picture, the usual
  sanity check for a camera-LiDAR calibration. With a CameraInfo and a
  `PointCloud2` topic in the bag, a "lidar" picker appears in the image header.
  Pick a cloud and its points are moved through the TF tree into the camera's
  frame, projected with the camera intrinsics (and lens distortion, unless the
  frame is being undistorted), and drawn as depth-coloured dots, nearest on top.
  If the points sit on the edges they belong to, the extrinsics are right. A
  note under the image says how many points landed in view, or why none did (no
  TF between the frames, everything behind the camera). Up to 200,000 points
  per frame. Assumes the CameraInfo frame is the optical frame (z forward).
- Empty panels now say why and what to do next. A plot opened on a topic with no numeric fields explains that it holds text or flags and offers the raw inspector and a state timeline; the trajectory view with no usable position offers a plot or the raw inspector; the TF tree with no `/tf` explains why 3D cannot line topics up; an image panel with nothing to show points at the health dashboard.
- `.spz` files (Niantic Scaniverse's compressed Gaussian splat format) now open in the splat viewer, from the file picker, a drop, or the OS "Open with" menu. The splat count in the topic list is read from the file's gzip header without decoding it. An `.spz` served from a URL that has no `.spz` extension is not recognised yet.
- BAGEL is now an installable app. Chromium browsers offer "Install app" in the
  landing page header (and the address bar); once installed, `.mcap`, `.bag`,
  `.db3`, `.pcd`, `.ply`, `.splat` and `.ksplat` files appear in the OS "Open
  with" menu and open straight into BAGEL (several files at once are grouped as
  split recordings, like a drop). A service worker lets the app load with no
  network after a first visit. Ordinary visitors cache only what they use;
  installing precaches every panel, the sample bag and the SQLite engine so
  nothing is missing offline. Offline responses keep their cross-origin
  isolation headers, which the splat viewer needs.
- New `bagel-check` command line tool and GitHub Action. It runs BAGEL's parsers
  in Node (no browser) and fails a pipeline when a recording is missing a
  topic, publishes below a minimum rate, has a silence longer than allowed, or
  is the wrong length. Rules live in a strict JSON file, so a typo is an error
  instead of a check that silently does nothing. Reads `.mcap`, `.db3` and
  `.bag`, treats split recordings and rosbag2 folders as one, prints a table or
  `--json`, and writes a per-topic table to the GitHub job summary. See
  [docs/BAGEL_CHECK.md](docs/BAGEL_CHECK.md).
- Plots can show one field against another. The "x axis" selector under a plot
  switches from time to any visible series (including series from other topics
  and expressions), and every other visible series is drawn against it: a
  command against a measurement, a controller's phase plot, a position's x
  against y. The path is joined and its dots are coloured from early to late
  with a legend, so direction is readable; a ring marks the sample nearest the
  playhead, and clicking a point seeks to its time. "equal scale" gives both
  axes the same pixels per unit so a circle in the data is a circle on screen.
  Series from different topics are paired by holding each at its last value.
  PNG export works in this mode; SVG export stays time-axis only.
- New Find panel: "when did this field meet a condition?". Open it from a topic
  (scalar messages such as a battery, a float or a mode string get a Find
  button), pick a field, a condition (is below / at most / above / at least /
  equals / does not equal / contains text / changes) and a value, and it scans
  the recording while showing progress, with a Cancel. Each hit is a timestamp
  and value; click one to seek there. By default a threshold reports where the
  condition starts (so a noisy signal around the line is one hit per crossing,
  not thousands), with a switch for every matching sample. "Mark on timeline"
  puts a tick on the scrubber for each hit, and those ticks can be pinned into
  bookmarks. Not available for live connections.
- Embed mode. Add `embed=1` to any BAGEL link and it renders only the panels and
  a compact timeline, for an iframe on a paper, dataset page or course. There is
  no toolbar, sidebar, modal or landing page, panels cannot be closed and the
  file cannot be swapped (`O`, `Esc`, `?` and `Cmd+K` are inert), and an "Open in
  BAGEL" link opens the same view in the full app. `theme=light|dark` matches the
  host page without touching the viewer's saved theme, and `autoplay=1&loop=1`
  makes a looping demo. The flag survives the app rewriting its own hash. The
  Share modal's iframe snippet now uses it. Embeds run without cross-origin
  isolation, which works for every bag format; see `docs/DATASET_HOSTING.md`.
  The app also sends `Cross-Origin-Resource-Policy: cross-origin` so a host page
  that itself uses COEP can frame it.
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