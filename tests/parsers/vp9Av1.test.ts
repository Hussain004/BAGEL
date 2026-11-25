/**
 * VP9 and AV1 CompressedVideo, on real streams from libvpx, libaom and
 * SVT-AV1 (tests/fixtures/video/make_fixtures.sh). ffprobe's keyframe flags
 * are the ground truth.
 */
import { describe, it, expect } from 'vitest';
import { KEYFRAMES, readIvf } from '../fixtures/video/ivf';
import { av1FrameInfo, getVideoCodecString, isVideoFormat, isVideoKeyframe, vp9FrameInfo } from '../../src/parsers/video';
import { readVideoChunksMcap } from '../../src/parsers/mcap';
import { writeJsonMcap } from '../fixtures/jsonMcap';

const STREAMS = [
  { name: 'vp9_libvpx', format: 'vp9', fourcc: 'VP90', codec: 'vp09.00.41.08' },
  { name: 'vp9_10bit', format: 'vp9', fourcc: 'VP90', codec: 'vp09.02.41.10' },
  { name: 'av1_libaom', format: 'av1', fourcc: 'AV01', codec: 'av01.0.00M.08' },
  { name: 'av1_svt', format: 'av1', fourcc: 'AV01', codec: 'av01.0.00M.08' },
];

describe.each(STREAMS)('$name', ({ name, format, fourcc, codec }) => {
  const { fourcc: got, frames } = readIvf(name);

  it('is the stream the fixture script made', () => {
    expect(got).toBe(fourcc);
    expect(frames.length).toBe(KEYFRAMES[name]!.length);
  });

  it("finds exactly ffprobe's keyframes", () => {
    expect(frames.map((f) => (isVideoKeyframe(f, format) ? 1 : 0))).toEqual(KEYFRAMES[name]);
  });

  it('finds keyframes from the first 18 bytes too, as the keyframe index peeks', () => {
    expect(frames.map((f) => (isVideoKeyframe(f.subarray(0, 18), format) ? 1 : 0))).toEqual(KEYFRAMES[name]);
  });

  it('builds the codec string from a key frame', () => {
    const s = getVideoCodecString(format, frames[0]!);
    if (typeof codec === 'string') expect(s).toBe(codec);
    else expect(s).toMatch(codec);
  });
});

describe('VP9 / AV1 headers', () => {
  it('reads AV1 level and tier, and a 10-bit stream as 10-bit', () => {
    const info = av1FrameInfo(readIvf('av1_libaom').frames[0]!)!;
    expect(info.key).toBe(true);
    expect(info.level).toBeGreaterThanOrEqual(0);
    expect(info.level).toBeLessThan(24);
    expect(vp9FrameInfo(readIvf('vp9_10bit').frames[0]!)).toMatchObject({ key: true, profile: 2, bitDepth: 10 });
  });

  it('treats empty, truncated and foreign bytes as not a keyframe, without throwing', () => {
    const h264Idr = new Uint8Array([0, 0, 0, 1, 0x65, 0x88]);
    for (const format of ['vp9', 'av1']) {
      for (const data of [new Uint8Array(0), new Uint8Array([0x82]), h264Idr, new Uint8Array(64).fill(0xff)]) {
        expect(() => isVideoKeyframe(data, format)).not.toThrow();
      }
      expect(isVideoKeyframe(new Uint8Array(0), format)).toBe(false);
    }
    // A sequence header alone (cut off before the frame) still reads as a keyframe start.
    expect(av1FrameInfo(readIvf('av1_svt').frames[0]!.subarray(0, 6))).toBeDefined();
  });

  it('routes the format names producers use', () => {
    for (const f of ['vp9', 'VP9', 'vp09.00.10.08', 'av1', 'AV1', 'av01.0.04M.08', 'h264', 'h265']) expect(isVideoFormat(f), f).toBe(true);
    expect(isVideoFormat('jpeg')).toBe(false);
  });
});

describe('readVideoChunksMcap on a VP9 / AV1 topic', () => {
  for (const { name, format } of STREAMS) {
    it(`${name}: seeks back to the keyframe before the playhead`, async () => {
      const { frames } = readIvf(name);
      const keys = KEYFRAMES[name]!;
      const bytes = await writeJsonMcap([{
        topic: '/cam/video',
        schemaName: 'foxglove.CompressedVideo',
        messages: frames.map((f, i) => ({
          logTime: BigInt(i + 1) * 100_000_000n,
          value: { timestamp: { sec: 0, nsec: 0 }, frame_id: 'cam', data: Buffer.from(f).toString('base64'), format },
        })),
      }]);
      const source = { kind: 'file' as const, file: new File([bytes as BlobPart], `${name}.mcap`) };
      // Playhead on the last frame: reading must start at the last keyframe and cover every frame after it.
      const last = frames.length - 1;
      const lastKey = keys.lastIndexOf(1);
      const r = (await readVideoChunksMcap(source, '/cam/video', BigInt(last + 1) * 100_000_000n))!;
      expect(r.format).toBe(format);
      expect(r.chunks[0]!.isKeyframe).toBe(true);
      expect(r.chunks[0]!.timestamp).toBe(BigInt(lastKey + 1) * 100_000_000n);
      expect(r.chunks.length).toBeGreaterThanOrEqual(last - lastKey + 1);
      expect(Buffer.from(r.chunks[0]!.data).equals(Buffer.from(frames[lastKey]!))).toBe(true);
    });
  }
});
