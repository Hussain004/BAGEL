/**
 * Audio decoding for both audio_common_msgs variants. PCM bytes are made with
 * Node's Buffer writers (not the decoder under test), in every sample format
 * GStreamer's audio_capture can emit, and a 440 Hz tone must come back as a
 * 440 Hz tone, placed at its log times with gaps as silence.
 */
import { describe, it, expect } from 'vitest';
import { buildTrack, decodeAudioMessage, formatFromInfo, isAudioType, pcmToFloat, waveformPeaks } from '../../src/utils/audio';

const RATE = 16000;
const tone = (n: number, phase = 0) => Array.from({ length: n }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * (i + phase) / RATE));

function pcm(samples: number[], fmt: string): Uint8Array {
  const step = Number(/\d+/.exec(fmt)![0]) / 8;
  const b = Buffer.alloc(samples.length * step);
  samples.forEach((s, i) => {
    const o = i * step;
    switch (fmt) {
      case 'S16LE': b.writeInt16LE(Math.round(s * 32767), o); break;
      case 'S16BE': b.writeInt16BE(Math.round(s * 32767), o); break;
      case 'S24LE': b.writeIntLE(Math.round(s * 8388607), o, 3); break;
      case 'S32LE': b.writeInt32LE(Math.round(s * 2147483647), o); break;
      case 'F32LE': b.writeFloatLE(s, o); break;
      case 'U8': b.writeUInt8(Math.round(s * 127) + 128, o); break;
      case 'S8': b.writeInt8(Math.round(s * 127), o); break;
    }
  });
  return new Uint8Array(b);
}

/** Frequency from zero crossings of a mono signal. */
const freq = (x: ArrayLike<number>, rate: number) => {
  let crossings = 0;
  for (let i = 1; i < x.length; i++) if (x[i - 1]! < 0 && x[i]! >= 0) crossings++;
  return (crossings * rate) / x.length;
};

describe('pcmToFloat', () => {
  it.each(['S16LE', 'S16BE', 'S24LE', 'S32LE', 'F32LE', 'U8', 'S8'])('%s round-trips a tone', (fmt) => {
    const src = tone(1600);
    const out = pcmToFloat(pcm(src, fmt), fmt);
    expect(out.length).toBe(1600);
    const tol = fmt.endsWith('8') ? 0.02 : 1e-3;
    for (let i = 0; i < src.length; i++) expect(Math.abs(out[i]! - src[i]!)).toBeLessThan(tol);
  });
  it('handles negative 24-bit samples, odd trailing bytes, and refuses unknown formats', () => {
    expect(pcmToFloat(new Uint8Array([0, 0, 0x80]), 'S24LE')[0]).toBe(-1);
    expect(pcmToFloat(new Uint8Array([1, 2, 3]), 'S16LE').length).toBe(1);
    expect(() => pcmToFloat(new Uint8Array(4), 'MULAW')).toThrow(/Unknown sample format/);
  });
});

describe('decodeAudioMessage', () => {
  it('ros-drivers AudioDataStamped and bare AudioData, with the AudioInfo format', () => {
    const fmt = formatFromInfo({ channels: 2, sample_rate: 48000, sample_format: 'S16LE', bitrate: 0, coding_format: 'wave' });
    expect(fmt).toEqual({ rate: 48000, channels: 2, sampleFormat: 'S16LE' });
    const data = pcm(tone(200), 'S16LE');
    const a = decodeAudioMessage({ header: {}, audio: { data } }, fmt);
    const b = decodeAudioMessage({ data: Array.from(data) }, fmt);
    expect([a.rate, a.channels, a.samples.length]).toEqual([48000, 2, 200]);
    expect(b.samples).toEqual(a.samples);
  });
  it('refuses mp3-coded audio with a clear message', () => {
    expect(() => formatFromInfo({ channels: 1, sample_rate: 16000, sample_format: 'S16LE', coding_format: 'mp3' })).toThrow(/"mp3"-coded audio is not supported yet/);
  });
  it('mgonzs13 AudioStamped in every PyAudio format it uses', () => {
    const src = tone(320);
    const cases: Array<[number, string, ArrayLike<number>]> = [
      [1, 'float32_data', Float32Array.from(src)],
      [2, 'int32_data', Int32Array.from(src, (s) => Math.round(s * 2147483647))],
      [8, 'int16_data', Int16Array.from(src, (s) => Math.round(s * 32767))],
      [16, 'int8_data', Int8Array.from(src, (s) => Math.round(s * 127))],
      [32, 'uint8_data', Uint8Array.from(src, (s) => Math.round(s * 127) + 128)],
    ];
    for (const [format, field, arr] of cases) {
      const m = { header: {}, audio: { info: { format, channels: 1, rate: 22050, chunk: 320 }, audio_data: { [field]: arr } } };
      const d = decodeAudioMessage(m);
      expect([d.rate, d.channels, d.samples.length], field).toEqual([22050, 1, 320]);
      expect(Math.abs(d.samples[80]! - src[80]!), field).toBeLessThan(0.02);
    }
    expect(() => decodeAudioMessage({ audio: { info: { format: 4, channels: 1, rate: 1 }, audio_data: {} } })).toThrow(/Unsupported PyAudio format 4/);
  });
  it('recognises the audio types of both packages', () => {
    for (const t of ['audio_common_msgs/AudioData', 'audio_common_msgs/msg/AudioDataStamped', 'audio_common_msgs/msg/AudioStamped', 'audio_common_msgs/msg/Audio']) expect(isAudioType(t)).toBe(true);
    expect(isAudioType('audio_common_msgs/msg/AudioInfo')).toBe(false);
  });
});

describe('buildTrack', () => {
  const S = 1_000_000_000n;
  const chunk = (tMs: number, n: number, phase: number) => ({
    timestamp: 100n * S + BigInt(tMs) * 1_000_000n,
    samples: Float32Array.from(tone(n, phase)),
    rate: RATE,
    channels: 1,
  });

  it('keeps a tone continuous across jittery chunk stamps', () => {
    // 50 chunks of 320 samples (20 ms each), stamps jittering by up to 7 ms.
    const chunks = Array.from({ length: 50 }, (_, i) => chunk(i * 20 + ((i * 7) % 8) - 3, 320, i * 320));
    const t = buildTrack(chunks)!;
    const live = t.channels[0]!.subarray(0, 50 * 320);
    expect(freq(live, RATE)).toBeCloseTo(440, -1);
    expect(live.every((v, i) => Math.abs(v - tone(1, i)[0]!) < 1e-6)).toBe(true);
  });

  it('turns a dropout into silence at the right place', () => {
    const t = buildTrack([chunk(0, 1600, 0), chunk(1000, 1600, 16000)])!; // 100 ms of sound, a gap, 100 ms more at 1 s
    const ch = t.channels[0]!;
    expect(Math.max(...ch.subarray(2000, 15000).map(Math.abs))).toBe(0);
    expect(Math.abs(ch[16000 + 40]! - tone(1, 16040)[0]!)).toBeLessThan(1e-6);
    expect(ch.length).toBeGreaterThanOrEqual(16000 + 1600);
  });

  it('splits interleaved stereo, bounds very long tracks, and returns null without samples', () => {
    const st = { timestamp: 0n, samples: Float32Array.from([0.1, -0.1, 0.2, -0.2]), rate: 8000, channels: 2 };
    const t = buildTrack([st])!;
    expect(Array.from(t.channels[0]!.subarray(0, 2))).toEqual([Math.fround(0.1), Math.fround(0.2)]);
    expect(Array.from(t.channels[1]!.subarray(0, 2))).toEqual([Math.fround(-0.1), Math.fround(-0.2)]);
    const long = buildTrack([chunk(0, 10, 0), chunk(3_600_000, 10, 0)], 60)!;
    expect(long.channels[0]!.length).toBe(60 * RATE);
    expect(buildTrack([])).toBeNull();
  });
});

describe('waveformPeaks', () => {
  it('finds each bucket min and max, including buckets past the end', () => {
    const { min, max } = waveformPeaks(Float32Array.from([0, 1, -1, 0.5, -0.25, 0]), 0, 12, 4);
    expect(Array.from(max)).toEqual([1, 0.5, 0, 0]);
    expect(Array.from(min)).toEqual([-1, -0.25, 0, 0]);
  });
});
