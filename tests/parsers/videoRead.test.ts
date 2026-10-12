import { describe, it, expect } from 'vitest';
import { readVideoChunksMcap } from '../../src/parsers/mcap';
import { writeJsonMcap } from '../fixtures/jsonMcap';

// Annex B: AUD, SPS (type 7), IDR slice (type 5) for a keyframe; AUD + P slice for a delta.
const KEY = [0, 0, 0, 1, 0x09, 0x10, 0, 0, 0, 1, 0x67, 0x64, 0x00, 0x1f, 0, 0, 0, 1, 0x65, 0x88, 0x84];
const DELTA = [0, 0, 0, 1, 0x09, 0x30, 0, 0, 0, 1, 0x41, 0x9a, 0x3b];
const b64 = (bytes: number[]): string => Buffer.from(bytes).toString('base64');
const msg = (ms: number, bytes: number[]) => ({
  logTime: BigInt(ms) * 1_000_000n,
  value: { timestamp: { sec: 0, nsec: 0 }, frame_id: 'cam', data: b64(bytes), format: 'h264' },
});

async function source() {
  // Video starts at 14 ms: keyframes at 14 and 200, deltas between.
  const bytes = await writeJsonMcap([
    {
      topic: '/cam/video',
      schemaName: 'foxglove.CompressedVideo',
      messages: [msg(14, KEY), msg(50, DELTA), msg(90, DELTA), msg(200, KEY), msg(240, DELTA)],
    },
  ]);
  return { kind: 'file' as const, file: new File([bytes as BlobPart], 'video.mcap') };
}

describe('readVideoChunksMcap keyframe lookup', () => {
  it('returns the first keyframe when the playhead is before the first video message', async () => {
    const r = await readVideoChunksMcap(await source(), '/cam/video', 0n);
    expect(r).not.toBeNull();
    expect(r!.chunks[0]!.isKeyframe).toBe(true);
    expect(r!.chunks[0]!.timestamp).toBe(14_000_000n);
  });

  it('still reads from the latest keyframe at or before a later playhead', async () => {
    const r = await readVideoChunksMcap(await source(), '/cam/video', 95_000_000n);
    expect(r!.chunks[0]!.timestamp).toBe(14_000_000n);
    expect(r!.chunks.at(-1)!.timestamp).toBeGreaterThanOrEqual(90_000_000n);
    const later = await readVideoChunksMcap(await source(), '/cam/video', 210_000_000n);
    expect(later!.chunks[0]!.timestamp).toBe(200_000_000n);
  });
});
