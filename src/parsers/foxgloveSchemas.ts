/**
 * Foxglove schema translation layer.
 *
 * Foxglove Studio MCAPs encode messages as JSON with Foxglove-specific schema
 * names (e.g. `foxglove.PointCloud`). Field names and data representations
 * differ from their ROS equivalents. These functions remap Foxglove message
 * objects to shapes that the rest of BAGEL can consume without modification.
 *
 * Binary blobs (image data, point cloud data) are base64-encoded in Foxglove
 * JSON messages. They are decoded to Uint8Array here so every downstream
 * consumer sees a typed array, matching the CDR message path.
 */

/**
 * Foxglove NumericType -> ROS PointField datatype.
 * Foxglove: UINT8=1, INT8=2, UINT16=3, INT16=4, UINT32=5, INT32=6, FLOAT32=7, FLOAT64=8
 * ROS:      INT8=1, UINT8=2, INT16=3, UINT16=4, INT32=5, UINT32=6, FLOAT32=7, FLOAT64=8
 */
const FG_NUMERIC_TO_ROS: Record<number, number> = {
  1: 2, // Foxglove UINT8  -> ROS UINT8
  2: 1, // Foxglove INT8   -> ROS INT8
  3: 4, // Foxglove UINT16 -> ROS UINT16
  4: 3, // Foxglove INT16  -> ROS INT16
  5: 6, // Foxglove UINT32 -> ROS UINT32
  6: 5, // Foxglove INT32  -> ROS INT32
  7: 7, // FLOAT32 same
  8: 8, // FLOAT64 same
};

function base64ToUint8Array(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toStamp(ts: unknown): { sec: number; nsec: number; nanosec: number } {
  if (ts && typeof ts === 'object') {
    const t = ts as Record<string, unknown>;
    const nsec =
      typeof t['nsec'] === 'number'
        ? t['nsec']
        : typeof t['nanosec'] === 'number'
          ? t['nanosec']
          : 0;
    // `nanosec` is the ROS1 spelling; emit both aliases so consumers such as
    // the TF graph (which reads `nanosec`) work on foxglove JSON too.
    return { sec: typeof t['sec'] === 'number' ? t['sec'] : 0, nsec, nanosec: nsec };
  }
  return { sec: 0, nsec: 0, nanosec: 0 };
}

function toHeader(
  msg: Record<string, unknown>,
): { stamp: { sec: number; nsec: number; nanosec: number }; frame_id: string } {
  return {
    stamp: toStamp(msg['timestamp']),
    frame_id: typeof msg['frame_id'] === 'string' ? msg['frame_id'] : '',
  };
}

function translateCompressedImage(
  msg: Record<string, unknown>,
): Record<string, unknown> {
  const raw = msg['data'];
  const data = typeof raw === 'string' ? base64ToUint8Array(raw) : raw;
  return {
    header: toHeader(msg),
    format: msg['format'] ?? '',
    data,
  };
}

function translateRawImage(
  msg: Record<string, unknown>,
): Record<string, unknown> {
  const raw = msg['data'];
  const data = typeof raw === 'string' ? base64ToUint8Array(raw) : raw;
  return {
    header: toHeader(msg),
    width: msg['width'] ?? 0,
    height: msg['height'] ?? 0,
    encoding: msg['encoding'] ?? 'rgb8',
    is_bigendian: 0,
    step: msg['step'] ?? 0,
    data,
  };
}

function translatePointCloud(
  msg: Record<string, unknown>,
): Record<string, unknown> {
  const raw = msg['data'];
  const data =
    typeof raw === 'string'
      ? base64ToUint8Array(raw)
      : (raw instanceof Uint8Array ? raw : new Uint8Array(0));
  const pointStep = typeof msg['point_stride'] === 'number' ? msg['point_stride'] : 0;
  const fgFields = Array.isArray(msg['fields'])
    ? (msg['fields'] as Record<string, unknown>[])
    : [];
  const fields = fgFields.map((f) => ({
    name: f['name'] ?? '',
    offset: f['offset'] ?? 0,
    datatype: FG_NUMERIC_TO_ROS[(f['type'] as number) ?? 0] ?? 7,
    count: 1,
  }));
  const width = pointStep > 0 ? Math.floor(data.byteLength / pointStep) : 0;
  return {
    header: toHeader(msg),
    height: 1,
    width,
    fields,
    is_bigendian: false,
    point_step: pointStep,
    row_step: width * pointStep,
    data,
    is_dense: false,
  };
}

function translateLaserScan(
  msg: Record<string, unknown>,
): Record<string, unknown> {
  const startAngle = typeof msg['start_angle'] === 'number' ? msg['start_angle'] : 0;
  const endAngle = typeof msg['end_angle'] === 'number' ? msg['end_angle'] : 0;
  const ranges = Array.isArray(msg['ranges']) ? (msg['ranges'] as number[]) : [];
  const increment =
    ranges.length > 1 ? (endAngle - startAngle) / (ranges.length - 1) : 0;
  const intensities = Array.isArray(msg['intensities']) ? msg['intensities'] : [];
  return {
    header: toHeader(msg),
    angle_min: startAngle,
    angle_max: endAngle,
    angle_increment: increment,
    time_increment: 0,
    scan_time: 0,
    range_min: 0,
    range_max: Infinity,
    ranges,
    intensities,
  };
}

function translateCompressedVideo(
  msg: Record<string, unknown>,
): Record<string, unknown> {
  const raw = msg['data'];
  const data = typeof raw === 'string' ? base64ToUint8Array(raw) : raw;
  return {
    header: toHeader(msg),
    format: msg['format'] ?? 'h264',
    data,
  };
}

function translateFrameTransform(
  msg: Record<string, unknown>,
): Record<string, unknown> {
  return {
    header: {
      stamp: toStamp(msg['timestamp']),
      frame_id:
        typeof msg['parent_frame_id'] === 'string' ? msg['parent_frame_id'] : '',
    },
    child_frame_id:
      typeof msg['child_frame_id'] === 'string' ? msg['child_frame_id'] : '',
    transform: {
      translation: msg['translation'] ?? { x: 0, y: 0, z: 0 },
      rotation: msg['rotation'] ?? { x: 0, y: 0, z: 0, w: 1 },
    },
  };
}

/** foxglove.TFMessage: a list of FrameTransforms, one per TF edge. */
function translateTfMessage(msg: Record<string, unknown>): Record<string, unknown> {
  const transforms = Array.isArray(msg['transforms'])
    ? (msg['transforms'] as Record<string, unknown>[])
    : [];
  return { transforms: transforms.map(translateFrameTransform) };
}

// ── foxglove.SceneUpdate -> visualization_msgs/MarkerArray ─────────────────
//
// A SceneUpdate is a set of entities, each holding primitives (cubes, spheres,
// lines, ...). The marker renderer already handles TF frames, lifetimes,
// namespaces and filtering, so the update is rewritten as a MarkerArray:
//   - each entity is a namespace (its id), each primitive a marker in it;
//   - a Foxglove entity replaces its previous self wholesale, which ROS markers
//     cannot say, so every entity starts with a REPLACE_NAMESPACE marker
//     (action 100, BAGEL-internal) that clears the namespace first;
//   - deletions become the same action (one entity) or DELETEALL (everything).
// Models (3D meshes) are not drawn.

/** Internal marker action: remove every marker in this namespace. */
export const MARKER_ACTION_REPLACE_NAMESPACE = 100;

const MARKER = { ARROW: 0, CUBE: 1, SPHERE: 2, CYLINDER: 3, LINE_STRIP: 4, LINE_LIST: 5, TEXT: 9, TRIANGLE_LIST: 11 } as const;

type Obj = Record<string, unknown>;
const objs = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Obj[]) : []);
const pts = (v: unknown): Obj[] => objs(v);
const n = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/**
 * Lines and text marked scale-invariant are sized in screen pixels, which a
 * world-space marker cannot be; draw them at a fixed modest size instead.
 */
const SCALE_INVARIANT_LINE_M = 0.03;
const SCALE_INVARIANT_TEXT_M = 0.25;
const IDENTITY_POSE = { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } };
const pose = (v: unknown) => (v && typeof v === 'object' ? v : IDENTITY_POSE);
const color = (v: unknown) => (v && typeof v === 'object' ? v : { r: 1, g: 1, b: 1, a: 1 });

function toDuration(d: unknown): { sec: number; nanosec: number } {
  const o = (d && typeof d === 'object' ? d : {}) as Obj;
  return { sec: n(o['sec']), nanosec: n(o['nsec'] ?? o['nanosec']) };
}

/** Vertices in draw order: via `indices` when the primitive has them, else as listed. */
function indexed(points: Obj[], colors: Obj[], indices: unknown): { points: Obj[]; colors: Obj[] } {
  const idx = Array.isArray(indices) ? (indices as unknown[]).filter((i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < points.length) : [];
  if (idx.length === 0) return { points, colors: colors.length === points.length ? colors : [] };
  return { points: idx.map((i) => points[i]!), colors: colors.length === points.length ? idx.map((i) => colors[i]!) : [] };
}

function translateEntity(e: Obj): Obj[] {
  const ns = typeof e['id'] === 'string' ? e['id'] : '';
  const header = { stamp: toStamp(e['timestamp']), frame_id: typeof e['frame_id'] === 'string' ? e['frame_id'] : '' };
  const lifetime = toDuration(e['lifetime']);
  const frame_locked = e['frame_locked'] === true;
  let id = 0;
  const marker = (type: number, extra: Obj): Obj => ({
    header, ns, id: id++, type, action: 0, lifetime, frame_locked,
    pose: IDENTITY_POSE, scale: { x: 1, y: 1, z: 1 }, color: { r: 1, g: 1, b: 1, a: 1 }, points: [], colors: [], text: '', ...extra,
  });
  const out: Obj[] = [{ header, ns, id: 0, type: 0, action: MARKER_ACTION_REPLACE_NAMESPACE }];

  for (const c of objs(e['cubes'])) out.push(marker(MARKER.CUBE, { pose: pose(c['pose']), scale: c['size'] ?? { x: 1, y: 1, z: 1 }, color: color(c['color']) }));
  for (const c of objs(e['spheres'])) out.push(marker(MARKER.SPHERE, { pose: pose(c['pose']), scale: c['size'] ?? { x: 1, y: 1, z: 1 }, color: color(c['color']) }));
  for (const c of objs(e['cylinders'])) out.push(marker(MARKER.CYLINDER, { pose: pose(c['pose']), scale: c['size'] ?? { x: 1, y: 1, z: 1 }, color: color(c['color']) }));
  for (const a of objs(e['arrows'])) {
    const head = n(a['head_diameter'], 0.1);
    out.push(marker(MARKER.ARROW, { pose: pose(a['pose']), scale: { x: n(a['shaft_length'], 1) + n(a['head_length'], 0.2), y: head, z: head }, color: color(a['color']) }));
  }
  for (const l of objs(e['lines'])) {
    // type: 0 strip, 1 loop, 2 list (numbers, or the enum names)
    const kind = String(l['type']);
    const isList = kind === '2' || kind === 'LINE_LIST';
    const isLoop = kind === '1' || kind === 'LINE_LOOP';
    const { points, colors } = indexed(pts(l['points']), objs(l['colors']), l['indices']);
    if (points.length < 2) continue;
    out.push(marker(isList ? MARKER.LINE_LIST : MARKER.LINE_STRIP, {
      pose: pose(l['pose']), scale: { x: l['scale_invariant'] === true ? SCALE_INVARIANT_LINE_M : n(l['thickness'], 1), y: 1, z: 1 }, color: color(l['color']),
      points: isLoop ? [...points, points[0]!] : points, colors: isLoop && colors.length ? [...colors, colors[0]!] : colors,
    }));
  }
  for (const t of objs(e['triangles'])) {
    const { points, colors } = indexed(pts(t['points']), objs(t['colors']), t['indices']);
    if (points.length < 3) continue;
    out.push(marker(MARKER.TRIANGLE_LIST, { pose: pose(t['pose']), color: color(t['color']), points: points.slice(0, points.length - (points.length % 3)), colors }));
  }
  for (const t of objs(e['texts'])) {
    out.push(marker(MARKER.TEXT, { pose: pose(t['pose']), scale: { x: 1, y: 1, z: t['scale_invariant'] === true ? SCALE_INVARIANT_TEXT_M : n(t['font_size'], 1) }, color: color(t['color']), text: typeof t['text'] === 'string' ? t['text'] : '' }));
  }
  return out;
}

function translateSceneUpdate(msg: Record<string, unknown>): Record<string, unknown> {
  const markers: Obj[] = [];
  for (const d of objs(msg['deletions'])) {
    const kind = String(d['type']);
    if (kind === '1' || kind === 'ALL') markers.push({ ns: '', id: 0, type: 0, action: 3 });
    else markers.push({ ns: typeof d['id'] === 'string' ? d['id'] : '', id: 0, type: 0, action: MARKER_ACTION_REPLACE_NAMESPACE });
  }
  for (const e of objs(msg['entities'])) markers.push(...translateEntity(e));
  return { markers };
}

type Translator = (msg: Record<string, unknown>) => Record<string, unknown>;

const TRANSLATORS: Record<string, Translator> = {
  'foxglove.CompressedImage': translateCompressedImage,
  'foxglove.RawImage': translateRawImage,
  'foxglove.CompressedVideo': translateCompressedVideo,
  'foxglove.PointCloud': translatePointCloud,
  'foxglove.LaserScan': translateLaserScan,
  'foxglove.FrameTransform': translateFrameTransform,
  'foxglove.TFMessage': translateTfMessage,
  'foxglove.SceneUpdate': translateSceneUpdate,
};

/** True if we have a translation registered for this Foxglove schema name. */
export function isFoxgloveSchema(schemaName: string): boolean {
  return Object.prototype.hasOwnProperty.call(TRANSLATORS, schemaName);
}

/**
 * Translate a Foxglove JSON message to a ROS-compatible shape.
 * Returns the input unchanged if no translator is registered for the schema.
 */
export function translateFoxgloveMessage(
  schemaName: string,
  msg: Record<string, unknown>,
): Record<string, unknown> {
  const translate = TRANSLATORS[schemaName];
  return translate ? translate(msg) : msg;
}
