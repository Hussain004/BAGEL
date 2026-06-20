import { describe, it, expect } from 'vitest';
import {
  isH264Keyframe,
  isH265Keyframe,
  isVideoKeyframe,
} from '../../src/parsers/video';

// Build an H264 Annex B NAL unit with a given type byte.
function h264Nalu(nalTypeByte: number, payloadLen = 4): Uint8Array {
  const buf = new Uint8Array(4 + 1 + payloadLen);
  // 4-byte start code: 00 00 00 01
  buf[2] = 0;
  buf[3] = 1;
  buf[4] = nalTypeByte;
  return buf;
}

// Concatenate two NAL units into one buffer.
function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

describe('isH264Keyframe', () => {
  it('returns true for a NAL unit with IDR type (5)', () => {
    expect(isH264Keyframe(h264Nalu(5))).toBe(true);
  });

  it('returns true for a NAL unit with SPS type (7)', () => {
    expect(isH264Keyframe(h264Nalu(7))).toBe(true);
  });

  it('returns false for a P-frame NAL unit (type 1)', () => {
    expect(isH264Keyframe(h264Nalu(1))).toBe(false);
  });

  it('returns true for SPS + PPS + IDR concatenated (typical keyframe)', () => {
    const sps = h264Nalu(7, 16); // SPS (type 7)
    const pps = h264Nalu(8, 4);  // PPS (type 8)
    const idr = h264Nalu(5, 100); // IDR (type 5)
    expect(isH264Keyframe(concat(sps, pps, idr))).toBe(true);
  });

  it('returns true for 3-byte start code (00 00 01)', () => {
    const buf = new Uint8Array([0x00, 0x00, 0x01, 0x67, 0x00, 0x00, 0x00]); // SPS = 0x67 & 0x1F = 7
    expect(isH264Keyframe(buf)).toBe(true);
  });

  it('returns false for empty buffer', () => {
    expect(isH264Keyframe(new Uint8Array(0))).toBe(false);
  });

  it('returns false for non-IDR P-frame with no SPS', () => {
    // Non-IDR: nal_ref_idc=1, nal_unit_type=1 -> 0x61
    const buf = h264Nalu(0x01);
    expect(isH264Keyframe(buf)).toBe(false);
  });

  it('handles NAL type mask correctly (ignores nal_ref_idc bits)', () => {
    // 0xE5 = 1110 0101 -> nal_ref_idc=7, nal_unit_type=5 (IDR)
    const buf = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0xE5]);
    expect(isH264Keyframe(buf)).toBe(true);
  });
});

describe('isH265Keyframe', () => {
  // H265 NAL header is 2 bytes: [forbidden_zero(1) | nal_unit_type(6) | nuh_layer_id(6) | nuh_temporal_id_plus1(3)]
  // nal_unit_type is bits 9-14 of the 2-byte header, i.e., (byte0 >> 1) & 0x3F

  function h265Nalu(nalType: number): Uint8Array {
    const byte0 = (nalType & 0x3f) << 1;
    return new Uint8Array([0x00, 0x00, 0x00, 0x01, byte0, 0x01, 0x00]);
  }

  it('returns true for IDR_W_RADL (type 19)', () => {
    expect(isH265Keyframe(h265Nalu(19))).toBe(true);
  });

  it('returns true for IDR_N_LP (type 20)', () => {
    expect(isH265Keyframe(h265Nalu(20))).toBe(true);
  });

  it('returns true for VPS (type 32) at start of keyframe', () => {
    expect(isH265Keyframe(h265Nalu(32))).toBe(true);
  });

  it('returns false for TRAIL_R non-keyframe (type 1)', () => {
    expect(isH265Keyframe(h265Nalu(1))).toBe(false);
  });

  it('returns false for empty buffer', () => {
    expect(isH265Keyframe(new Uint8Array(0))).toBe(false);
  });
});

describe('isVideoKeyframe', () => {
  it('routes to H264 detector for h264 format', () => {
    const sps = h264Nalu(7);
    expect(isVideoKeyframe(sps, 'h264')).toBe(true);
    expect(isVideoKeyframe(h264Nalu(1), 'h264')).toBe(false);
  });

  it('routes to H264 detector for avc format alias', () => {
    expect(isVideoKeyframe(h264Nalu(5), 'avc')).toBe(true);
  });

  it('routes to H265 detector for h265 format', () => {
    // IDR_W_RADL (type 19): byte0 = 19 << 1 = 38 = 0x26
    const buf = new Uint8Array([0x00, 0x00, 0x00, 0x01, 0x26, 0x01]);
    expect(isVideoKeyframe(buf, 'h265')).toBe(true);
  });
});
