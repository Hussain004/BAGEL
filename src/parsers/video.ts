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

export function isVp9VideoFormat(format: string): boolean {
  const f = format.trim().toLowerCase();
  return f.includes('vp9') || f.includes('vp09');
}

export function isAv1VideoFormat(format: string): boolean {
  const f = format.trim().toLowerCase();
  return f.includes('av1') || f.includes('av01');
}

export function isVideoFormat(format: string): boolean {
  return isH264VideoFormat(format) || isH265VideoFormat(format) || isVp9VideoFormat(format) || isAv1VideoFormat(format);
}

/** MSB-first bit reader; throws RangeError past the end, so a truncated header reads as "unknown". */
function bitReader(data: Uint8Array) {
  let bit = 0;
  return (n: number): number => {
    let v = 0;
    for (let k = 0; k < n; k++, bit++) {
      const byte = data[bit >> 3];
      if (byte === undefined) throw new RangeError('truncated');
      v = v * 2 + ((byte >> (7 - (bit & 7))) & 1);
    }
    return v;
  };
}

export interface VideoStreamInfo {
  key: boolean;
  profile: number;
  bitDepth: number;
  /** AV1 seq_level_idx and tier; unknown for VP9, which does not carry a level. */
  level?: number;
  tier?: number;
}

/**
 * The VP9 uncompressed header of the first frame in a message (a superframe
 * starts with its first frame too): key or not, and for a key frame the
 * profile and bit depth the codec string needs.
 */
export function vp9FrameInfo(data: Uint8Array): VideoStreamInfo | null {
  const read = bitReader(data);
  try {
    if (read(2) !== 2) return null; // frame_marker
    const lo = read(1);
    const profile = read(1) * 2 + lo;
    if (profile === 3) read(1); // reserved_zero
    if (read(1)) return { key: false, profile, bitDepth: 8 }; // show_existing_frame
    if (read(1) !== 0) return { key: false, profile, bitDepth: 8 }; // frame_type 0 = KEY_FRAME
    read(2); // show_frame, error_resilient_mode
    if (read(8) !== 0x49 || read(8) !== 0x83 || read(8) !== 0x42) return null; // frame_sync_code
    const bitDepth = profile >= 2 ? (read(1) ? 12 : 10) : 8;
    return { key: true, profile, bitDepth };
  } catch {
    return null;
  }
}

/** The OBUs of an AV1 temporal unit (low overhead bitstream format, as CompressedVideo carries). */
function av1Obus(data: Uint8Array): { type: number; payload: Uint8Array }[] {
  const out: { type: number; payload: Uint8Array }[] = [];
  let i = 0;
  while (i < data.length) {
    const h = data[i]!;
    const type = (h >> 3) & 15;
    i += 1 + ((h >> 2) & 1); // header, plus the extension byte
    let size = data.length - i;
    if ((h >> 1) & 1) {
      size = 0;
      for (let k = 0; k < 8; k++) {
        const b = data[i++];
        if (b === undefined) return out;
        size += (b & 0x7f) * 2 ** (7 * k);
        if (!(b & 0x80)) break;
      }
    }
    out.push({ type, payload: data.subarray(i, Math.min(data.length, i + size)) });
    i += size;
  }
  return out;
}

/** Fields of an AV1 sequence header up to color_config (spec 5.5), enough for the codec string. */
function av1SequenceHeader(p: Uint8Array): { profile: number; level: number; tier: number; bitDepth: number; reduced: boolean } | null {
  const read = bitReader(p);
  let profile = 0, level = 8, tier = 0;
  let reduced = false;
  try {
    profile = read(3);
    read(1); // still_picture
    reduced = read(1) === 1;
    if (reduced) {
      level = read(5);
    } else {
      let decoderModel = false;
      let bufferDelayBits = 0;
      if (read(1)) { // timing_info_present_flag
        read(32); read(32); // num_units_in_display_tick, time_scale
        if (read(1)) { // equal_picture_interval: uvlc num_ticks_per_picture_minus_1
          let zeros = 0;
          while (!read(1)) zeros++;
          read(zeros);
        }
        decoderModel = read(1) === 1;
        if (decoderModel) {
          bufferDelayBits = read(5) + 1;
          read(32); // num_units_in_decoding_tick
          read(5); read(5); // buffer_removal_time_length, frame_presentation_time_length
        }
      }
      const initialDelay = read(1) === 1;
      const ops = read(5) + 1;
      for (let k = 0; k < ops; k++) {
        read(12); // operating_point_idc
        const lv = read(5);
        const tr = lv > 7 ? read(1) : 0;
        if (k === 0) [level, tier] = [lv, tr];
        if (decoderModel && read(1)) { read(bufferDelayBits); read(bufferDelayBits); read(1); }
        if (initialDelay && read(1)) read(4);
      }
    }
    const wBits = read(4) + 1;
    const hBits = read(4) + 1;
    read(wBits); read(hBits);
    if (!reduced && read(1)) { read(4); read(3); } // frame_id_numbers_present_flag
    read(3); // use_128x128_superblock, enable_filter_intra, enable_intra_edge
    let orderHint = false;
    if (!reduced) {
      read(4); // interintra, masked_compound, warped_motion, dual_filter
      orderHint = read(1) === 1;
      if (orderHint) read(2); // jnt_comp, ref_frame_mvs
      const force = read(1) ? 2 : read(1); // seq_choose_screen_content_tools
      if (force > 0 && !read(1)) read(1); // seq_choose_integer_mv
      if (orderHint) read(3);
    }
    read(3); // superres, cdef, restoration
    const high = read(1) === 1;
    const bitDepth = profile === 2 && high ? (read(1) ? 12 : 10) : high ? 10 : 8;
    return { profile, level, tier, bitDepth, reduced };
  } catch {
    // Truncated (the keyframe index peeks at only a few bytes): the profile is still known.
    return { profile, level, tier, bitDepth: profile === 2 ? 10 : 8, reduced };
  }
}

/**
 * An AV1 temporal unit is a key frame when its frame header says KEY_FRAME and
 * it carries the sequence header a decoder must start from. When the frame
 * header is not in the bytes given (a short peek), the sequence header alone
 * decides, as encoders send it with key frames.
 */
export function av1FrameInfo(data: Uint8Array): VideoStreamInfo | null {
  let seq: ReturnType<typeof av1SequenceHeader> = null;
  for (const obu of av1Obus(data)) {
    if (obu.type === 1) seq = av1SequenceHeader(obu.payload);
    if (obu.type === 3 || obu.type === 6) { // OBU_FRAME_HEADER, OBU_FRAME
      const b = obu.payload[0];
      if (b === undefined) break;
      const key = seq !== null && (seq.reduced || (!(b >> 7) && ((b >> 5) & 3) === 0));
      return seq ? { key, ...seq } : { key: false, profile: 0, bitDepth: 8 };
    }
  }
  return seq ? { key: true, ...seq } : null;
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
      out.push({ data, timestamp: timestampForOffset(chunks, start), isKeyframe: isVideoKeyframe(data, format) });
      start = aud;
    }
  }
  if (start < joined.length && hasH264VclNal(joined, start, joined.length)) {
    const data = joined.slice(start);
    out.push({ data, timestamp: timestampForOffset(chunks, start), isKeyframe: isVideoKeyframe(data, format) });
  }

  return out;
}

/**
 * Scan an H264 Annex B bitstream for NAL unit types 5 (IDR) or 7 (SPS).
 * Either indicates the start of a keyframe access unit.
 */
export function isH264Keyframe(data: Uint8Array): boolean {
  const limit = data.length;
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
  const limit = data.length;
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
  if (isVp9VideoFormat(format)) return vp9FrameInfo(data)?.key ?? false;
  if (isAv1VideoFormat(format)) return av1FrameInfo(data)?.key ?? false;
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

const pad2 = (n: number) => n.toString().padStart(2, '0');

/** WebCodecs codec string for the stream, from its key frame where the format needs it. */
export function getVideoCodecString(format: string, keyframeData: Uint8Array): string {
  if (isVp9VideoFormat(format)) {
    // VP9 carries no level; 4.1 is a valid catch-all that decoders do not enforce.
    const info = vp9FrameInfo(keyframeData);
    return `vp09.${pad2(info?.profile ?? 0)}.41.${pad2(info?.bitDepth ?? 8)}`;
  }
  if (isAv1VideoFormat(format)) {
    const info = av1FrameInfo(keyframeData);
    return `av01.${info?.profile ?? 0}.${pad2(info?.level ?? 8)}${info?.tier ? 'H' : 'M'}.${pad2(info?.bitDepth ?? 8)}`;
  }
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


interface BrowserVideoFrame {
  close(): void;
}

interface BrowserVideoDecoder {
  configure(config: { codec: string }): void;
  decode(chunk: { type: string; timestamp: number; data: ArrayBufferView }): void;
  flush?(): Promise<void>;
  close(): void;
  readonly state: string;
  readonly decodeQueueSize?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Stateful WebCodecs decoder for forward playback. It does not flush after
 * every frame because a flushed decoder needs another keyframe. The one
 * exception is a decoder that has taken everything it was given and still
 * emitted nothing (a lone keyframe, for example, is held back for reordering):
 * that is flushed once to release the frame, and `requiresReseek` then tells
 * the caller to restart from a keyframe instead of feeding more delta frames.
 */
export class VideoFrameDecoder {
  private decoder: BrowserVideoDecoder | null = null;
  private format = '';
  private frames: BrowserVideoFrame[] = [];
  private decodeError: Error | null = null;
  private needsKeyframe = false;

  /** True after a flush: the next decode must start at a keyframe, so read from one. */
  get requiresReseek(): boolean {
    return this.needsKeyframe;
  }

  reset(): void {
    for (const frame of this.frames) frame.close();
    this.frames = [];
    if (this.decoder) safeCloseCodec(this.decoder);
    this.decoder = null;
    this.format = '';
    this.decodeError = null;
    this.needsKeyframe = false;
  }

  /** Wait for the decoder to produce output, flushing it if it is holding frames back. */
  private async waitForOutput(): Promise<void> {
    const decoder = this.decoder;
    await sleep(30);
    if (!decoder || this.frames.length > 0 || this.decodeError) return;
    // Still working through its queue (a software decoder can be slow): wait.
    const deadline = performance.now() + 500;
    while (
      (decoder.decodeQueueSize ?? 0) > 0 &&
      this.frames.length === 0 &&
      !this.decodeError &&
      performance.now() < deadline
    ) {
      await sleep(5);
    }
    if (this.frames.length > 0 || this.decodeError || !decoder.flush) return;
    try {
      await decoder.flush();
    } catch {
      this.decodeError = new Error('Video decoder failed to flush.');
      return;
    }
    this.needsKeyframe = true;
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
    if (!this.decoder || this.format !== format || first.isKeyframe || this.needsKeyframe) {
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

    await this.waitForOutput();

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
