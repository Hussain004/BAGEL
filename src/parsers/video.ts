/**
 * WebCodecs-based video frame decoder for H264/H265 streams.
 *
 * Used by the ImageViewer panel to render foxglove.CompressedVideo topics.
 * The VideoDecoder API runs on the main thread (Chrome 94+, Firefox 130+,
 * Safari 17.4+). The worker returns raw encoded chunks; the main thread
 * decodes them and draws the result onto a canvas.
 *
 * Seeking strategy: H264/H265 P-frames depend on all frames since the last
 * keyframe (I-frame). When the playhead moves to time T, we find the nearest
 * keyframe K <= T, read every frame from K to T, and decode them in sequence
 * so the decoder accumulates the reference state it needs to produce a
 * correct output frame at T.
 */

export interface VideoChunk {
  data: Uint8Array;
  timestamp: bigint;
  isKeyframe: boolean;
}

export interface VideoChunksResult {
  chunks: VideoChunk[];
  format: string;
}

/**
 * Scan an H264 Annex B bitstream for NAL unit types 5 (IDR) or 7 (SPS).
 * Either indicates the start of a keyframe access unit.
 */
export function isH264Keyframe(data: Uint8Array): boolean {
  const limit = Math.min(data.length, 512);
  let i = 0;
  while (i < limit) {
    let nalOffset = -1;
    if (
      i + 4 < limit &&
      data[i] === 0 && data[i + 1] === 0 &&
      data[i + 2] === 0 && data[i + 3] === 1
    ) {
      nalOffset = i + 4;
    } else if (
      i + 3 < limit &&
      data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1
    ) {
      nalOffset = i + 3;
    }
    if (nalOffset >= 0 && nalOffset < data.length) {
      const nalType = data[nalOffset] & 0x1f;
      if (nalType === 5 || nalType === 7) return true; // IDR or SPS
      i = nalOffset + 1;
    } else {
      i++;
    }
  }
  return false;
}

/**
 * Scan an H265 Annex B bitstream for IDR_W_RADL (19), IDR_N_LP (20),
 * or VPS (32) NAL units - all of which appear at the start of a keyframe.
 */
export function isH265Keyframe(data: Uint8Array): boolean {
  const limit = Math.min(data.length, 512);
  let i = 0;
  while (i < limit) {
    let nalOffset = -1;
    if (
      i + 4 < limit &&
      data[i] === 0 && data[i + 1] === 0 &&
      data[i + 2] === 0 && data[i + 3] === 1
    ) {
      nalOffset = i + 4;
    } else if (
      i + 3 < limit &&
      data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1
    ) {
      nalOffset = i + 3;
    }
    if (nalOffset >= 0 && nalOffset < data.length) {
      const nalType = (data[nalOffset] >> 1) & 0x3f;
      if (nalType === 19 || nalType === 20 || nalType === 32) return true;
      i = nalOffset + 1;
    } else {
      i++;
    }
  }
  return false;
}

function isH264Format(format: string): boolean {
  const f = format.toLowerCase();
  return f === 'h264' || f === 'avc' || f === 'avc1';
}

/** Detect keyframe using the codec-appropriate detector. */
export function isVideoKeyframe(data: Uint8Array, format: string): boolean {
  return isH264Format(format) ? isH264Keyframe(data) : isH265Keyframe(data);
}

/**
 * Parse the H264 SPS NAL unit (type 7) to extract the exact codec string.
 * The SPS contains profile_idc, constraint_flags, and level_idc which map
 * directly to the avc1.PPCCLL codec identifier.
 */
function getH264CodecString(keyframeData: Uint8Array): string {
  const limit = Math.min(keyframeData.length, 512);
  let i = 0;
  while (i < limit) {
    let nalOffset = -1;
    if (
      i + 4 < limit &&
      keyframeData[i] === 0 && keyframeData[i + 1] === 0 &&
      keyframeData[i + 2] === 0 && keyframeData[i + 3] === 1
    ) {
      nalOffset = i + 4;
    } else if (
      i + 3 < limit &&
      keyframeData[i] === 0 && keyframeData[i + 1] === 0 && keyframeData[i + 2] === 1
    ) {
      nalOffset = i + 3;
    }
    if (nalOffset >= 0 && nalOffset + 3 < keyframeData.length) {
      const nalType = keyframeData[nalOffset] & 0x1f;
      if (nalType === 7) {
        const p = keyframeData[nalOffset + 1];
        const c = keyframeData[nalOffset + 2];
        const l = keyframeData[nalOffset + 3];
        const h = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
        return `avc1.${h(p)}${h(c)}${h(l)}`;
      }
      i = nalOffset + 1;
    } else {
      i++;
    }
  }
  return 'avc1.42E01F'; // H264 Baseline Level 3.1 fallback
}

/**
 * Decode a sequence of video chunks using the browser WebCodecs VideoDecoder.
 *
 * `chunks` must begin with a keyframe. Returns an ImageBitmap of the last
 * decoded frame (the one at or closest to the requested timestamp).
 *
 * Returns null if WebCodecs is unavailable or decoding fails.
 */
export async function decodeVideoFrames(
  chunks: VideoChunk[],
  format: string,
): Promise<ImageBitmap | null> {
  if (chunks.length === 0) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const VD = (globalThis as unknown as Record<string, unknown>)['VideoDecoder'] as (new (
    init: {
      output: (frame: { close(): void }) => void;
      error: (err: Error) => void;
    },
  ) => {
    configure(config: { codec: string }): void;
    decode(chunk: { type: string; timestamp: number; data: ArrayBufferView }): void;
    flush(): Promise<void>;
    close(): void;
    readonly state: string;
  }) | undefined;

  if (!VD) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const EVC = (globalThis as unknown as Record<string, unknown>)['EncodedVideoChunk'] as (new (
    init: { type: 'key' | 'delta'; timestamp: number; data: ArrayBufferView },
  ) => { type: string; timestamp: number; data: ArrayBufferView }) | undefined;

  if (!EVC) return null;

  const keyframeData = chunks[0].data;
  const codec = isH264Format(format)
    ? getH264CodecString(keyframeData)
    : 'hev1.1.6.L93.B0';

  const frames: Array<{ close(): void }> = [];
  let decodeError: Error | null = null;

  const decoder = new VD({
    output: (frame) => frames.push(frame),
    error: (err) => { decodeError = err; },
  });

  try {
    decoder.configure({ codec });
  } catch {
    return null;
  }

  for (const chunk of chunks) {
    if (decodeError) break;
    decoder.decode(
      new EVC({
        type: chunk.isKeyframe ? 'key' : 'delta',
        // VideoDecoder timestamps are microseconds; MCAP is nanoseconds
        timestamp: Number(chunk.timestamp / 1000n),
        data: chunk.data,
      }),
    );
  }

  try {
    await decoder.flush();
  } catch {
    // flush may throw when decoding failed
  }
  decoder.close();

  if (frames.length === 0) {
    return null;
  }

  const lastFrame = frames[frames.length - 1];
  let bitmap: ImageBitmap | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    bitmap = await createImageBitmap(lastFrame as unknown as ImageBitmapSource);
  } catch {
    bitmap = null;
  } finally {
    for (const f of frames) f.close();
  }
  return bitmap;
}
