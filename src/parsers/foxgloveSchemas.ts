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

function toStamp(ts: unknown): { sec: number; nsec: number } {
  if (ts && typeof ts === 'object') {
    const t = ts as Record<string, unknown>;
    return {
      sec: typeof t['sec'] === 'number' ? t['sec'] : 0,
      nsec: typeof t['nsec'] === 'number' ? t['nsec'] : 0,
    };
  }
  return { sec: 0, nsec: 0 };
}

function toHeader(
  msg: Record<string, unknown>,
): { stamp: { sec: number; nsec: number }; frame_id: string } {
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

type Translator = (msg: Record<string, unknown>) => Record<string, unknown>;

const TRANSLATORS: Record<string, Translator> = {
  'foxglove.CompressedImage': translateCompressedImage,
  'foxglove.RawImage': translateRawImage,
  'foxglove.CompressedVideo': translateCompressedVideo,
  'foxglove.PointCloud': translatePointCloud,
  'foxglove.LaserScan': translateLaserScan,
  'foxglove.FrameTransform': translateFrameTransform,
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
