/**
 * The file formats behind "export frames": PNG for raw images, a binary PCD for
 * a point cloud, and the CSV that ties files to times. Pure and DOM-free (no
 * canvas), so each can be checked byte for byte in Node.
 */

import { zlibSync } from 'fflate';
import { csvCell } from './labels';

// ── PNG ───────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array, init = 0xffffffff): number {
  let c = init;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  // The CRC covers the type and the data, not the length.
  view.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

export type PngColor = 'gray' | 'rgb' | 'rgba';

const COLOR_TYPE: Record<PngColor, number> = { gray: 0, rgb: 2, rgba: 6 };
const CHANNELS: Record<PngColor, number> = { gray: 1, rgb: 3, rgba: 4 };

/**
 * Encode pixels as a PNG. `pixels` are row-major, tightly packed, and for 16-bit
 * depth already big-endian (PNG's byte order). Lossless, no filtering: images
 * from a camera compress about as well either way, and this stays fast.
 */
export function encodePng(width: number, height: number, color: PngColor, bitDepth: 8 | 16, pixels: Uint8Array): Uint8Array {
  const rowBytes = width * CHANNELS[color] * (bitDepth / 8);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error('PNG needs a positive width and height');
  if (pixels.length < rowBytes * height) throw new Error(`PNG pixel data is ${pixels.length} bytes, ${rowBytes * height} needed`);

  const raw = new Uint8Array((rowBytes + 1) * height); // each row starts with filter type 0 (None)
  for (let y = 0; y < height; y++) raw.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);

  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width);
  iv.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = COLOR_TYPE[color];
  // compression, filter and interlace methods: all 0

  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 3 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export interface FrameFile {
  bytes: Uint8Array;
  ext: 'png' | 'jpg';
  /** Something worth telling the person about this file (a conversion that was needed). */
  note?: string;
}

export class UnsupportedImage extends Error {}

type Obj = Record<string, unknown>;

function asBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  return new Uint8Array(0);
}

/**
 * A raw `sensor_msgs/Image` (or `foxglove.RawImage`) as a PNG, keeping the
 * pixel values: 8-bit colour and gray as they are (BGR swapped to RGB), 16-bit
 * gray as 16-bit, and 32-bit float depth converted to 16-bit millimetres
 * (PNG cannot hold floats). Anything else (Bayer, YUV, ...) is refused by name.
 */
export function rawImageToPng(msg: Obj): FrameFile {
  const width = Number(msg.width);
  const height = Number(msg.height);
  const encoding = String(msg.encoding ?? '').toLowerCase();
  const data = asBytes(msg.data);
  const bigEndian = msg.is_bigendian === true || msg.is_bigendian === 1;
  if (!(width >= 1) || !(height >= 1)) throw new UnsupportedImage('the image has no size');
  const n = width * height;

  const need = (bytes: number) => {
    if (data.length < bytes) throw new UnsupportedImage(`the pixel data is ${data.length} bytes, ${bytes} needed for ${width}x${height} ${encoding}`);
  };

  switch (encoding) {
    case 'rgb8':
      need(n * 3);
      return { bytes: encodePng(width, height, 'rgb', 8, data), ext: 'png' };
    case 'rgba8':
      need(n * 4);
      return { bytes: encodePng(width, height, 'rgba', 8, data), ext: 'png' };
    case 'bgr8': {
      need(n * 3);
      const px = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) {
        px[i * 3] = data[i * 3 + 2]!;
        px[i * 3 + 1] = data[i * 3 + 1]!;
        px[i * 3 + 2] = data[i * 3]!;
      }
      return { bytes: encodePng(width, height, 'rgb', 8, px), ext: 'png' };
    }
    case 'bgra8': {
      need(n * 4);
      const px = new Uint8Array(n * 4);
      for (let i = 0; i < n; i++) {
        px[i * 4] = data[i * 4 + 2]!;
        px[i * 4 + 1] = data[i * 4 + 1]!;
        px[i * 4 + 2] = data[i * 4]!;
        px[i * 4 + 3] = data[i * 4 + 3]!;
      }
      return { bytes: encodePng(width, height, 'rgba', 8, px), ext: 'png' };
    }
    case 'mono8':
    case '8uc1':
      need(n);
      return { bytes: encodePng(width, height, 'gray', 8, data), ext: 'png' };
    case 'mono16':
    case '16uc1': {
      need(n * 2);
      // ROS data is little-endian unless flagged; PNG wants big-endian.
      const px = new Uint8Array(n * 2);
      for (let i = 0; i < n; i++) {
        const lo = data[i * 2]!;
        const hi = data[i * 2 + 1]!;
        px[i * 2] = bigEndian ? lo : hi;
        px[i * 2 + 1] = bigEndian ? hi : lo;
      }
      return { bytes: encodePng(width, height, 'gray', 16, px), ext: 'png' };
    }
    case '32fc1': {
      need(n * 4);
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const px = new Uint8Array(n * 2);
      const pv = new DataView(px.buffer);
      for (let i = 0; i < n; i++) {
        const metres = view.getFloat32(i * 4, !bigEndian);
        const mm = Number.isFinite(metres) && metres > 0 ? Math.min(65535, Math.round(metres * 1000)) : 0;
        pv.setUint16(i * 2, mm);
      }
      return { bytes: encodePng(width, height, 'gray', 16, px), ext: 'png', note: 'depth converted from float metres to 16-bit millimetres (0 = no reading)' };
    }
    default:
      throw new UnsupportedImage(`images encoded as "${encoding || 'unknown'}" cannot be exported as PNG yet`);
  }
}

/** A `CompressedImage` payload is already a JPEG or PNG: written as it is, untouched. */
export function compressedImageFile(msg: Obj): FrameFile {
  const format = String(msg.format ?? '').toLowerCase();
  const bytes = asBytes(msg.data);
  if (bytes.length === 0) throw new UnsupportedImage('the image has no data');
  if (format.includes('compresseddepth')) throw new UnsupportedImage('compressedDepth images carry a transport header and are not exported as plain files yet');
  // Trust the bytes over the label: some drivers write "jpeg" for a PNG.
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return { bytes, ext: 'jpg' };
  if (bytes.length > 7 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { bytes, ext: 'png' };
  throw new UnsupportedImage(`the "${format || 'unlabelled'}" payload is neither a JPEG nor a PNG`);
}

/** Pick the right conversion for an image message: compressed ones pass through, raw ones become PNG. */
export function imageMessageToFile(msg: Obj): FrameFile {
  return typeof msg.encoding === 'string' && msg.width !== undefined ? rawImageToPng(msg) : compressedImageFile(msg);
}

// ── PCD ───────────────────────────────────────────────────────────────────

export interface CloudForPcd {
  /** x, y, z per point. */
  positions: Float32Array;
  intensity?: Float32Array;
  ring?: Float32Array;
}

/**
 * A binary PCD 0.7 file: x y z (float32), plus intensity (float32) and ring
 * (uint16) when the cloud has them. The inverse of `parsers/pcd.ts`.
 */
export function writePcd(cloud: CloudForPcd): Uint8Array {
  const points = cloud.positions.length / 3;
  if (!Number.isInteger(points)) throw new Error('positions must hold x, y, z for every point');
  const hasI = !!cloud.intensity && cloud.intensity.length === points;
  const hasR = !!cloud.ring && cloud.ring.length === points;
  const fields = ['x', 'y', 'z', ...(hasI ? ['intensity'] : []), ...(hasR ? ['ring'] : [])];
  const sizes = [4, 4, 4, ...(hasI ? [4] : []), ...(hasR ? [2] : [])];
  const types = ['F', 'F', 'F', ...(hasI ? ['F'] : []), ...(hasR ? ['U'] : [])];
  const header =
    `# .PCD v0.7 - Point Cloud Data file format\nVERSION 0.7\nFIELDS ${fields.join(' ')}\nSIZE ${sizes.join(' ')}\nTYPE ${types.join(' ')}\n` +
    `COUNT ${fields.map(() => 1).join(' ')}\nWIDTH ${points}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS ${points}\nDATA binary\n`;
  const head = new TextEncoder().encode(header);
  const step = sizes.reduce((a, b) => a + b, 0);
  const out = new Uint8Array(head.length + points * step);
  out.set(head);
  const view = new DataView(out.buffer);
  let at = head.length;
  for (let i = 0; i < points; i++) {
    view.setFloat32(at, cloud.positions[i * 3]!, true);
    view.setFloat32(at + 4, cloud.positions[i * 3 + 1]!, true);
    view.setFloat32(at + 8, cloud.positions[i * 3 + 2]!, true);
    let o = at + 12;
    if (hasI) {
      view.setFloat32(o, cloud.intensity![i]!, true);
      o += 4;
    }
    if (hasR) view.setUint16(o, Math.max(0, Math.min(65535, Math.round(cloud.ring![i]!))), true);
    at += step;
  }
  return out;
}

// ── Names and the CSV ─────────────────────────────────────────────────────

/** `/camera/image_raw` becomes `camera_image_raw`: one safe folder name. */
export function topicFolder(topic: string): string {
  return topic.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '') || 'topic';
}

export interface FrameRow {
  file: string;
  topic: string;
  /** The message's log time on the bag clock, as an exact string. */
  timestamp_ns: string;
  /** The header stamp inside the message, when it has one. */
  header_stamp_ns: string;
  /** Labels covering this frame, joined with `|`. */
  label: string;
  /** The paired point cloud file, or empty. */
  cloud_file: string;
  /** Signed gap to that cloud in nanoseconds, or empty. */
  cloud_dt_ns: string;
  note: string;
}

const FRAME_COLUMNS: ReadonlyArray<keyof FrameRow> = ['file', 'topic', 'timestamp_ns', 'header_stamp_ns', 'label', 'cloud_file', 'cloud_dt_ns', 'note'];

export function framesToCsv(rows: readonly FrameRow[]): string {
  const numeric = new Set<keyof FrameRow>(['timestamp_ns', 'header_stamp_ns', 'cloud_dt_ns']);
  const lines = [FRAME_COLUMNS.join(',')];
  for (const row of rows) lines.push(FRAME_COLUMNS.map((c) => csvCell(row[c], numeric.has(c))).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** `header.stamp` of a message as exact nanoseconds, or '' when it has none. */
export function headerStampNs(msg: Obj | null): string {
  const stamp = (msg?.header as Obj | undefined)?.stamp as Obj | undefined;
  if (!stamp) return '';
  const sec = stamp.sec ?? stamp.secs;
  const nsec = stamp.nanosec ?? stamp.nsec ?? stamp.nsecs ?? 0;
  if (typeof sec !== 'number' && typeof sec !== 'bigint') return '';
  try {
    return (BigInt(sec) * 1_000_000_000n + BigInt(nsec as number | bigint)).toString();
  } catch {
    return '';
  }
}
