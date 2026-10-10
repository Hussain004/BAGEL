import { describe, expect, it } from 'vitest';
import { crc32 as nodeCrc32, inflateSync } from 'node:zlib';
import {
  compressedImageFile,
  crc32,
  encodePng,
  framesToCsv,
  headerStampNs,
  imageMessageToFile,
  rawImageToPng,
  topicFolder,
  UnsupportedImage,
  writePcd,
  type FrameRow,
} from '../../src/utils/frameExport';
import { parsePcd, readPointCloudAtTimePcd, disposePcdCache } from '../../src/parsers/pcd';
import { createFileSource } from '../../src/parsers/source';

/** A deliberately independent PNG reader: Node's zlib and CRC, no code from the encoder. */
function readPng(png: Uint8Array) {
  expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let at = 8;
  const chunks: Array<{ type: string; data: Uint8Array }> = [];
  while (at < png.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    // The CRC must match what Node computes over type + data.
    expect(view.getUint32(at + 8 + len), `${type} crc`).toBe(nodeCrc32(png.subarray(at + 4, at + 8 + len)));
    chunks.push({ type, data });
    at += 12 + len;
  }
  expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
  const ihdr = new DataView(chunks[0]!.data.buffer, chunks[0]!.data.byteOffset, 13);
  const width = ihdr.getUint32(0);
  const height = ihdr.getUint32(4);
  const bitDepth = chunks[0]!.data[8]!;
  const colorType = chunks[0]!.data[9]!;
  const channels = { 0: 1, 2: 3, 6: 4 }[colorType as 0 | 2 | 6]!;
  const rowBytes = (width * channels * bitDepth) / 8;
  const raw = inflateSync(chunks[1]!.data);
  expect(raw.length).toBe((rowBytes + 1) * height);
  const pixels = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (rowBytes + 1)], `row ${y} filter`).toBe(0);
    pixels.set(raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1)), y * rowBytes);
  }
  return { width, height, bitDepth, colorType, pixels };
}

describe('crc32', () => {
  it('matches the platform implementation on assorted data', () => {
    for (const bytes of [new Uint8Array(0), new Uint8Array([0]), new TextEncoder().encode('123456789'), Uint8Array.from({ length: 5000 }, (_, i) => (i * 31) & 255)]) {
      expect((crc32(bytes) ^ 0xffffffff) >>> 0).toBe(nodeCrc32(bytes));
    }
  });
});

describe('encodePng', () => {
  it('round-trips rgb, rgba and gray, 8 and 16 bit, through an independent reader', () => {
    const cases: Array<[number, number, 'gray' | 'rgb' | 'rgba', 8 | 16]> = [
      [1, 1, 'rgb', 8],
      [7, 5, 'rgb', 8],
      [4, 3, 'rgba', 8],
      [9, 2, 'gray', 8],
      [6, 4, 'gray', 16],
      [300, 200, 'rgb', 8],
    ];
    for (const [w, h, color, depth] of cases) {
      const channels = { gray: 1, rgb: 3, rgba: 4 }[color];
      const pixels = Uint8Array.from({ length: w * h * channels * (depth / 8) }, (_, i) => (i * 7 + 3) & 255);
      const out = readPng(encodePng(w, h, color, depth, pixels));
      expect([out.width, out.height, out.bitDepth]).toEqual([w, h, depth]);
      expect(Array.from(out.pixels)).toEqual(Array.from(pixels));
    }
  });

  it('refuses nonsense sizes and short data instead of writing a broken file', () => {
    expect(() => encodePng(0, 4, 'rgb', 8, new Uint8Array(100))).toThrow();
    expect(() => encodePng(2.5, 4, 'rgb', 8, new Uint8Array(100))).toThrow();
    expect(() => encodePng(4, 4, 'rgb', 8, new Uint8Array(10))).toThrow(/needed/);
  });
});

describe('rawImageToPng', () => {
  const img = (encoding: string, width: number, height: number, data: number[] | Uint8Array, extra = {}) => ({ encoding, width, height, data: data instanceof Uint8Array ? data : Uint8Array.from(data), ...extra });

  it('keeps rgb8 pixels as they are', () => {
    const out = readPng(rawImageToPng(img('rgb8', 2, 1, [1, 2, 3, 4, 5, 6])).bytes);
    expect(out.colorType).toBe(2);
    expect(Array.from(out.pixels)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('swaps bgr8 to rgb and bgra8 to rgba', () => {
    expect(Array.from(readPng(rawImageToPng(img('bgr8', 2, 1, [3, 2, 1, 6, 5, 4])).bytes).pixels)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(Array.from(readPng(rawImageToPng(img('bgra8', 1, 1, [3, 2, 1, 9])).bytes).pixels)).toEqual([1, 2, 3, 9]);
  });

  it('writes mono8 as 8-bit gray', () => {
    const out = readPng(rawImageToPng(img('mono8', 3, 1, [0, 128, 255])).bytes);
    expect([out.colorType, out.bitDepth]).toEqual([0, 8]);
    expect(Array.from(out.pixels)).toEqual([0, 128, 255]);
  });

  it('writes 16-bit gray big-endian whichever way the message was stored', () => {
    // 0x1234 and 0xABCD, little-endian then big-endian in the message.
    const le = readPng(rawImageToPng(img('16UC1', 2, 1, [0x34, 0x12, 0xcd, 0xab], { is_bigendian: false })).bytes);
    expect(Array.from(le.pixels)).toEqual([0x12, 0x34, 0xab, 0xcd]);
    const be = readPng(rawImageToPng(img('mono16', 2, 1, [0x12, 0x34, 0xab, 0xcd], { is_bigendian: true })).bytes);
    expect(Array.from(be.pixels)).toEqual([0x12, 0x34, 0xab, 0xcd]);
    expect(be.bitDepth).toBe(16);
  });

  it('turns float depth into millimetres, with no reading as zero, and says so', () => {
    const f = new Float32Array([1.5, NaN, Infinity, -2, 0.0004, 100]);
    const file = rawImageToPng(img('32FC1', 6, 1, new Uint8Array(f.buffer)));
    expect(file.note).toMatch(/millimetres/);
    const px = readPng(file.bytes).pixels;
    const v = new DataView(px.buffer);
    expect([0, 1, 2, 3, 4, 5].map((i) => v.getUint16(i * 2))).toEqual([1500, 0, 0, 0, 0, 65535]);
  });

  it('names what it cannot do, and refuses short or empty data', () => {
    expect(() => rawImageToPng(img('bayer_rggb8', 2, 2, [0, 0, 0, 0]))).toThrow(/bayer_rggb8.*cannot be exported/);
    expect(() => rawImageToPng(img('yuv422', 2, 2, [0, 0, 0, 0]))).toThrow(UnsupportedImage);
    expect(() => rawImageToPng(img('rgb8', 4, 4, [1, 2, 3]))).toThrow(/needed/);
    expect(() => rawImageToPng(img('rgb8', 0, 0, []))).toThrow(/no size/);
  });
});

describe('compressedImageFile', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const png = encodePng(1, 1, 'rgb', 8, new Uint8Array(3));

  it('passes the bytes through untouched, keyed off what they are, not what they are called', () => {
    const a = compressedImageFile({ format: 'jpeg', data: jpeg });
    expect(a.ext).toBe('jpg');
    expect(a.bytes).toBe(jpeg);
    expect(compressedImageFile({ format: 'jpeg', data: png }).ext).toBe('png'); // a driver that mislabels a PNG
    expect(compressedImageFile({ format: 'rgb8; jpeg compressed bgr8', data: jpeg }).ext).toBe('jpg');
  });

  it('refuses compressedDepth, unknown payloads and empty data', () => {
    expect(() => compressedImageFile({ format: '16UC1; compressedDepth png', data: png })).toThrow(/compressedDepth/);
    expect(() => compressedImageFile({ format: 'webp', data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) })).toThrow(/neither/);
    expect(() => compressedImageFile({ format: 'jpeg', data: new Uint8Array(0) })).toThrow(/no data/);
  });

  it('imageMessageToFile picks by shape', () => {
    expect(imageMessageToFile({ format: 'jpeg', data: jpeg }).ext).toBe('jpg');
    expect(imageMessageToFile({ encoding: 'mono8', width: 1, height: 1, data: new Uint8Array([7]) }).ext).toBe('png');
  });
});

describe('writePcd', () => {
  const positions = Float32Array.from([1, 2, 3, -4.5, 5, 6.25, 0, 0, 0]);

  it('is read back by the app\'s own PCD parser with the same points', async () => {
    disposePcdCache();
    const bytes = writePcd({ positions, intensity: Float32Array.from([10, 20, 30]), ring: Float32Array.from([0, 7, 15]) });
    const source = createFileSource(new File([bytes], 'out.pcd'));
    const summary = await parsePcd(source);
    expect(summary.topics[0]!.messageCount).toBeGreaterThan(0);
    const cloud = await readPointCloudAtTimePcd(source);
    expect(cloud!.pointCount).toBe(3);
    expect(Array.from(cloud!.positions)).toEqual(Array.from(positions));
    expect(cloud!.fieldNames).toEqual(['x', 'y', 'z', 'intensity', 'ring']);
    expect(Array.from(cloud!.intensity!)).toEqual([10, 20, 30]);
    expect(Array.from(cloud!.ring!)).toEqual([0, 7, 15]);
  });

  it('writes only the fields it has, and an honest header', () => {
    const bare = writePcd({ positions });
    const header = new TextDecoder().decode(bare);
    expect(header).toContain('FIELDS x y z\n');
    expect(header).toContain('POINTS 3\n');
    expect(header).toContain('DATA binary\n');
    // Mismatched optional arrays are left out rather than written wrong.
    expect(new TextDecoder().decode(writePcd({ positions, intensity: Float32Array.from([1]) }))).toContain('FIELDS x y z\n');
  });

  it('handles an empty cloud and refuses ragged positions', () => {
    expect(writePcd({ positions: new Float32Array(0) }).length).toBeGreaterThan(50);
    expect(() => writePcd({ positions: new Float32Array(4) })).toThrow();
  });
});

describe('csv and names', () => {
  const row = (extra: Partial<FrameRow> = {}): FrameRow => ({ file: 'cam/1.png', topic: '/cam', timestamp_ns: '1700000000123456789', header_stamp_ns: '', label: '', cloud_file: '', cloud_dt_ns: '', note: '', ...extra });

  it('has the columns, CRLF, exact big times, and guards formulas', () => {
    const csv = framesToCsv([row({ label: 'turn|brake', note: '=bad' }), row({ cloud_file: 'lidar/1.pcd', cloud_dt_ns: '-5000000' })]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('file,topic,timestamp_ns,header_stamp_ns,label,cloud_file,cloud_dt_ns,note');
    expect(lines[1]).toBe("cam/1.png,/cam,1700000000123456789,,turn|brake,,,'=bad");
    // A negative gap is a number, not a formula.
    expect(lines[2]).toBe('cam/1.png,/cam,1700000000123456789,,,lidar/1.pcd,-5000000,');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('topicFolder is one safe path segment', () => {
    expect(topicFolder('/camera/image_raw')).toBe('camera_image_raw');
    expect(topicFolder('/a b/../c')).toBe('a_b_.._c');
    expect(topicFolder('///')).toBe('topic');
    expect(topicFolder('/lidar/points')).not.toContain('/');
  });

  it('headerStampNs reads both stamp spellings exactly, and tolerates no header', () => {
    expect(headerStampNs({ header: { stamp: { sec: 1700000000, nanosec: 123456789 } } })).toBe('1700000000123456789');
    expect(headerStampNs({ header: { stamp: { secs: 5, nsecs: 7 } } })).toBe('5000000007');
    expect(headerStampNs({ header: { stamp: { sec: 3n, nanosec: 4n } } })).toBe('3000000004');
    expect(headerStampNs({})).toBe('');
    expect(headerStampNs(null)).toBe('');
    expect(headerStampNs({ header: { stamp: { sec: 'x' } } })).toBe('');
  });
});
