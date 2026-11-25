/**
 * Audio topics. Two incompatible audio_common_msgs exist in the wild:
 *
 * - ros-drivers/audio_common (ROS 1 and its ROS 2 port): AudioData or
 *   AudioDataStamped carry raw bytes; the format is on a separate AudioInfo
 *   topic (sample_rate, channels, sample_format like "S16LE",
 *   coding_format "wave" or "mp3").
 * - mgonzs13/audio_common (ROS 2): Audio or AudioStamped carry an inline
 *   AudioInfo (PyAudio format code, channels, rate) and the samples in the
 *   typed array that matches the format.
 *
 * Both decode to interleaved float samples in [-1, 1].
 */

type Obj = Record<string, unknown>;

// The type checks live in messages.ts so routing does not pull this module into the main bundle.
export { isAudioInfoType, isAudioType } from './messages';

export interface AudioFormat {
  rate: number;
  channels: number;
  /** GStreamer-style name: S16LE, S8, U8, S24LE, S32LE, F32LE, and the BE forms. */
  sampleFormat: string;
}

/** Used when a raw-byte topic has no AudioInfo to say otherwise: audio_capture's defaults. */
export const DEFAULT_AUDIO_FORMAT: AudioFormat = { rate: 16000, channels: 1, sampleFormat: 'S16LE' };

/** Format from a ros-drivers AudioInfo message. Throws for compressed (mp3) audio. */
export function formatFromInfo(info: Obj): AudioFormat {
  const coding = String(info.coding_format ?? 'wave').toLowerCase();
  if (coding && coding !== 'wave' && coding !== 'raw' && coding !== 'pcm') {
    throw new Error(`"${coding}"-coded audio is not supported yet; record with coding_format wave (raw PCM).`);
  }
  return {
    rate: Number(info.sample_rate) || DEFAULT_AUDIO_FORMAT.rate,
    channels: Number(info.channels) || 1,
    sampleFormat: String(info.sample_format || 'S16LE').toUpperCase(),
  };
}

function bytesOf(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  if (typeof v === 'string') return Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
  return new Uint8Array(0);
}

/** PCM bytes to floats, by GStreamer sample format name. */
export function pcmToFloat(bytes: Uint8Array, sampleFormat: string): Float32Array {
  const m = /^([SUF])(8|16|24|32)(LE|BE)?$/.exec(sampleFormat.toUpperCase());
  if (!m) throw new Error(`Unknown sample format "${sampleFormat}".`);
  const [, kind, bitsText, endian] = m;
  const bits = Number(bitsText);
  const le = endian !== 'BE';
  const step = bits / 8;
  const n = Math.floor(bytes.length / step);
  const out = new Float32Array(n);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < n; i++) {
    const o = i * step;
    if (kind === 'F' && bits === 32) out[i] = v.getFloat32(o, le);
    else if (kind === 'U' && bits === 8) out[i] = (v.getUint8(o) - 128) / 128;
    else if (bits === 8) out[i] = v.getInt8(o) / 128;
    else if (bits === 16) out[i] = v.getInt16(o, le) / 32768;
    else if (bits === 24) {
      const b0 = v.getUint8(o), b1 = v.getUint8(o + 1), b2 = v.getUint8(o + 2);
      const u = le ? b0 | (b1 << 8) | (b2 << 16) : b2 | (b1 << 8) | (b0 << 16);
      out[i] = ((u << 8) >> 8) / 8388608;
    } else if (bits === 32) out[i] = v.getInt32(o, le) / 2147483648;
    else throw new Error(`Unsupported sample format "${sampleFormat}".`);
  }
  return out;
}

/** PyAudio format codes, as mgonzs13/audio_common uses them. */
const PYAUDIO: Record<number, { field: string; scale: number }> = {
  1: { field: 'float32_data', scale: 1 },
  2: { field: 'int32_data', scale: 2147483648 },
  8: { field: 'int16_data', scale: 32768 },
  16: { field: 'int8_data', scale: 128 },
  32: { field: 'uint8_data', scale: 128 },
};

export interface AudioChunk {
  samples: Float32Array;
  rate: number;
  channels: number;
}

/**
 * One message's samples. `rawFormat` is the AudioInfo format for the
 * raw-byte variant (ignored by the variant that carries its own).
 */
export function decodeAudioMessage(value: Obj, rawFormat: AudioFormat = DEFAULT_AUDIO_FORMAT): AudioChunk {
  const audio = (value.audio ?? value) as Obj;
  // mgonzs13: Audio { audio_data, info }
  if (audio.info && audio.audio_data) {
    const info = audio.info as Obj;
    const data = audio.audio_data as Obj;
    const fmt = PYAUDIO[Number(info.format)];
    if (!fmt) throw new Error(`Unsupported PyAudio format ${String(info.format)} (paInt24 and paCustomFormat are not handled).`);
    const src = (data[fmt.field] ?? []) as ArrayLike<number>;
    const offset = fmt.field === 'uint8_data' ? 128 : 0;
    const samples = Float32Array.from({ length: src.length }, (_, i) => (src[i]! - offset) / fmt.scale);
    return { samples, rate: Number(info.rate) || DEFAULT_AUDIO_FORMAT.rate, channels: Number(info.channels) || 1 };
  }
  // ros-drivers: AudioData { data } (inside AudioDataStamped.audio, or bare)
  if ('data' in audio) {
    return { samples: pcmToFloat(bytesOf(audio.data), rawFormat.sampleFormat), rate: rawFormat.rate, channels: rawFormat.channels };
  }
  throw new Error('Not an audio_common_msgs audio message.');
}

export interface AudioTrack {
  /** Per channel, sample i plays at startNs + i / rate seconds. */
  channels: Float32Array[];
  rate: number;
  startNs: bigint;
}

/**
 * Lay chunks out on one track by their log times, so a dropout is silence
 * rather than shifting everything after it. A chunk that arrives a little
 * early (transport jitter) is placed straight after the previous one.
 * `maxSeconds` bounds memory for very long recordings.
 */
export function buildTrack(chunks: Array<{ timestamp: bigint } & AudioChunk>, maxSeconds = 1800): AudioTrack | null {
  const first = chunks.find((c) => c.samples.length > 0);
  if (!first) return null;
  const { rate, channels: nch } = first;
  const startNs = first.timestamp;
  const lastChunk = chunks[chunks.length - 1]!;
  const spanSec = Number(lastChunk.timestamp - startNs) / 1e9 + lastChunk.samples.length / nch / rate;
  const length = Math.min(Math.ceil(Math.max(0, spanSec) * rate) + 1, Math.ceil(maxSeconds * rate));
  const channels = Array.from({ length: nch }, () => new Float32Array(length));
  let cursor = 0;
  for (const c of chunks) {
    if (c.rate !== rate || c.channels !== nch || c.samples.length === 0) continue;
    const frames = Math.floor(c.samples.length / nch);
    const at = Math.round((Number(c.timestamp - startNs) / 1e9) * rate);
    // Within 50 ms of the cursor counts as contiguous: stamps jitter, audio does not.
    let pos = Math.abs(at - cursor) < rate * 0.05 ? cursor : Math.max(at, cursor);
    for (let f = 0; f < frames && pos < length; f++, pos++) {
      for (let ch = 0; ch < nch; ch++) channels[ch]![pos] = c.samples[f * nch + ch]!;
    }
    cursor = pos;
  }
  return { channels, rate, startNs };
}

/** Min and max of `ch` over each of `buckets` equal slices of [from, to) samples, for a waveform. */
export function waveformPeaks(ch: Float32Array, from: number, to: number, buckets: number): { min: Float32Array; max: Float32Array } {
  const min = new Float32Array(buckets);
  const max = new Float32Array(buckets);
  const span = (to - from) / buckets;
  for (let b = 0; b < buckets; b++) {
    const s = Math.max(0, Math.floor(from + b * span));
    const e = Math.min(ch.length, Math.max(s + 1, Math.floor(from + (b + 1) * span)));
    let lo = 0, hi = 0;
    for (let i = s; i < e; i++) {
      const v = ch[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max };
}
