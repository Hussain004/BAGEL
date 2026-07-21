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

export function isH264VideoFormat(format: string): boolean {
  const f = format.trim().toLowerCase();
  return f.includes('h264') || f.includes('h.264') || f.includes('avc') || f.includes('avc1');
}

export function isH265VideoFormat(format: string): boolean {
  const f = format.trim().toLowerCase();
  return (
    f.includes('h265') ||
    f.includes('h.265') ||
    f.includes('hevc') ||
    f.includes('hev1') ||
    f.includes('hvc1')
  );
}

export function isVideoFormat(format: string): boolean {
  return isH264VideoFormat(format) || isH265VideoFormat(format);
}

export function isVideoTopicName(topicName: string): boolean {
  return /(?:^|[/_.-])h26[45](?:$|[/_.-])/i.test(topicName);
}

function findAnnexBStartCodes(data: Uint8Array): { offset: number; nalOffset: number }[] {
  const starts: { offset: number; nalOffset: number }[] = [];
  for (let i = 0; i < data.length - 3; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0) continue;
    if (data[i + 2] === 1) {
      starts.push({ offset: i, nalOffset: i + 3 });
      i += 2;
    } else if (i + 3 < data.length && data[i + 2] === 0 && data[i + 3] === 1) {
      starts.push({ offset: i, nalOffset: i + 4 });
      i += 3;
    }
  }
  return starts;
}

export function hasH264AccessUnitDelimiter(data: Uint8Array): boolean {
  for (const code of findAnnexBStartCodes(data)) {
    if (code.nalOffset < data.length && (data[code.nalOffset] & 0x1f) === 9) return true;
  }
  return false;
}

export function hasH264SequenceParameterSet(data: Uint8Array): boolean {
  for (const code of findAnnexBStartCodes(data)) {
    if (code.nalOffset < data.length && (data[code.nalOffset] & 0x1f) === 7) return true;
  }
  return false;
}

export function hasH264IdrSlice(data: Uint8Array): boolean {
  for (const code of findAnnexBStartCodes(data)) {
    if (code.nalOffset < data.length && (data[code.nalOffset] & 0x1f) === 5) return true;
  }
  return false;
}

function hasH264VclNal(data: Uint8Array, start: number, end: number): boolean {
  for (const code of findAnnexBStartCodes(data.subarray(start, end))) {
    const nalOffset = start + code.nalOffset;
    if (nalOffset >= end) continue;
    const nalType = data[nalOffset] & 0x1f;
    if (nalType === 1 || nalType === 5) return true;
  }
  return false;
}

function timestampForOffset(chunks: VideoChunk[], offset: number): bigint {
  let cursor = 0;
  for (const chunk of chunks) {
    const next = cursor + chunk.data.byteLength;
    if (offset < next) return chunk.timestamp;
    cursor = next;
  }
  return chunks[chunks.length - 1]?.timestamp ?? 0n;
}

/**
 * Some ROS H264 CompressedImage producers split one Annex B bytestream across
 * multiple messages. WebCodecs expects decodeable access units, so regroup
 * streams that carry H264 Access Unit Delimiter NALs. Streams without AUDs
 * keep the original chunking used by Foxglove CompressedVideo.
 */
export function coalesceAnnexBVideoChunks(chunks: VideoChunk[], format: string): VideoChunk[] {
  if (chunks.length === 0 || !isH264VideoFormat(format)) return chunks;

  const total = chunks.reduce((n, chunk) => n + chunk.data.byteLength, 0);
  const joined = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    joined.set(chunk.data, cursor);
    cursor += chunk.data.byteLength;
  }

  const audOffsets = findAnnexBStartCodes(joined)
    .filter((code) => code.nalOffset < joined.length && (joined[code.nalOffset] & 0x1f) === 9)
    .map((code) => code.offset);
  if (audOffsets.length === 0) return chunks;

  const out: VideoChunk[] = [];
  let start = 0;
  for (const aud of audOffsets) {
    if (aud > start && hasH264VclNal(joined, start, aud)) {
      const data = joined.slice(start, aud);
      out.push({ data, timestamp: timestampForOffset(chunks, start), isKeyframe: hasH264IdrSlice(data) });
      start = aud;
    }
  }
  if (start < joined.length && hasH264VclNal(joined, start, joined.length)) {
    const data = joined.slice(start);
    out.push({ data, timestamp: timestampForOffset(chunks, start), isKeyframe: hasH264IdrSlice(data) });
  }

  return out;
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

/** Detect keyframe using the codec-appropriate detector. */
export function isVideoKeyframe(data: Uint8Array, format: string): boolean {
  return isH264VideoFormat(format) ? isH264Keyframe(data) : isH265Keyframe(data);
}

/**
 * Parse the H264 SPS NAL unit (type 7) to extract the exact codec string.
 * The SPS contains profile_idc, constraint_flags, and level_idc which map
 * directly to the avc1.PPCCLL codec identifier.
 */
function safeCloseCodec(codec: { close(): void; readonly state?: string }): void {
  try {
    if (codec.state !== 'closed') codec.close();
  } catch {
    // Some WebCodecs implementations throw if close races with an error callback.
  }
}

function getVideoCodecString(format: string, keyframeData: Uint8Array): string {
  return isH264VideoFormat(format) ? getH264CodecString(keyframeData) : 'hev1.1.6.L93.B0';
}

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

  const EVC = (globalThis as unknown as Record<string, unknown>)['EncodedVideoChunk'] as (new (
    init: { type: 'key' | 'delta'; timestamp: number; data: ArrayBufferView },
  ) => { type: string; timestamp: number; data: ArrayBufferView }) | undefined;

  if (!EVC) return null;

  const firstKeyIndex = chunks.findIndex((chunk) => chunk.isKeyframe);
  if (firstKeyIndex < 0) return null;
  const decodeChunks = firstKeyIndex === 0 ? chunks : chunks.slice(firstKeyIndex);

  const keyframeData = decodeChunks[0].data;
  const codec = getVideoCodecString(format, keyframeData);

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

  for (const chunk of decodeChunks) {
    if (decodeError) break;
    try {
      decoder.decode(
        new EVC({
          type: chunk.isKeyframe ? 'key' : 'delta',
          // VideoDecoder timestamps are microseconds; MCAP is nanoseconds
          timestamp: Number(chunk.timestamp / 1000n),
          data: chunk.data,
        }),
      );
    } catch {
      decodeError = new Error('Video decoder rejected the encoded frame sequence.');
      break;
    }
  }

  try {
    await decoder.flush();
  } catch {
    // flush may throw when decoding failed
  }
  safeCloseCodec(decoder);

  if (frames.length === 0) {
    return null;
  }

  const lastFrame = frames[frames.length - 1];
  try {
    return await createImageBitmap(lastFrame as unknown as ImageBitmapSource);
  } catch {
    return null;
  } finally {
    for (const f of frames) f.close();
  }
}


interface BrowserVideoFrame {
  close(): void;
}

interface BrowserVideoDecoder {
  configure(config: { codec: string }): void;
  decode(chunk: { type: string; timestamp: number; data: ArrayBufferView }): void;
  close(): void;
  readonly state: string;
}

/**
 * Stateful WebCodecs decoder for forward playback. It never calls flush()
 * between frames because some H264 decoders then require another keyframe.
 */
export class VideoFrameDecoder {
  private decoder: BrowserVideoDecoder | null = null;
  private format = '';
  private frames: BrowserVideoFrame[] = [];
  private decodeError: Error | null = null;

  reset(): void {
    for (const frame of this.frames) frame.close();
    this.frames = [];
    if (this.decoder) safeCloseCodec(this.decoder);
    this.decoder = null;
    this.format = '';
    this.decodeError = null;
  }

  close(): void {
    this.reset();
  }

  async decode(chunks: VideoChunk[], format: string): Promise<ImageBitmap | null> {
    if (chunks.length === 0) return null;

    const VD = (globalThis as unknown as Record<string, unknown>)['VideoDecoder'] as (new (
      init: {
        output: (frame: BrowserVideoFrame) => void;
        error: (err: Error) => void;
      },
    ) => BrowserVideoDecoder) | undefined;
    const EVC = (globalThis as unknown as Record<string, unknown>)['EncodedVideoChunk'] as (new (
      init: { type: 'key' | 'delta'; timestamp: number; data: ArrayBufferView },
    ) => { type: string; timestamp: number; data: ArrayBufferView }) | undefined;
    if (!VD || !EVC) return null;

    const first = chunks[0]!;
    if (!this.decoder || this.format !== format || first.isKeyframe) {
      this.reset();
      if (!first.isKeyframe) return null;
      const codec = getVideoCodecString(format, first.data);
      this.decoder = new VD({
        output: (frame) => { this.frames.push(frame); },
        error: (err) => { this.decodeError = err; },
      });
      try {
        this.decoder.configure({ codec });
      } catch {
        this.reset();
        return null;
      }
      this.format = format;
    }

    for (const chunk of chunks) {
      if (!this.decoder || this.decodeError) break;
      try {
        this.decoder.decode(new EVC({
          type: chunk.isKeyframe ? 'key' : 'delta',
          timestamp: Number(chunk.timestamp / 1000n),
          data: chunk.data,
        }));
      } catch {
        this.decodeError = new Error('Video decoder rejected the encoded frame sequence.');
        break;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 30));

    if (this.decodeError) {
      this.reset();
      return null;
    }

    let latest: ImageBitmap | null = null;
    for (;;) {
      const frame = this.frames.shift();
      if (!frame) break;
      try {
        const bitmap = await createImageBitmap(frame as unknown as ImageBitmapSource);
        latest?.close();
        latest = bitmap;
      } catch {
        // Keep draining later frames.
      } finally {
        frame.close();
      }
    }
    return latest;
  }
}
