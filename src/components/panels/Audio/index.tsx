/**
 * Audio panel: the waveform of an audio_common_msgs topic across the whole
 * bag, a playhead line, and sound that follows BAGEL's playback (play, pause,
 * seek, speed). Click the waveform to seek.
 *
 * Decoding is in utils/audio.ts; the track places each chunk at its log time,
 * so a dropout reads as silence and the waveform lines up with the timeline.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { alignedTimeFor, resolveBagEntry, useBagStore } from '../../../store/bagStore';
import { useBagLocalPlayhead } from '../../../hooks/useBagLocalPlayhead';
import { useTopicMessages } from '../../../hooks/useTopicMessages';
import { usePlayheadStore } from '../../../store/playheadStore';
import {
  DEFAULT_AUDIO_FORMAT,
  buildTrack,
  decodeAudioMessage,
  formatFromInfo,
  isAudioInfoType,
  waveformPeaks,
  type AudioTrack,
} from '../../../utils/audio';
import { getTopicColor } from '../../../utils/color';
import { PanelShell } from '../PanelShell';
import { PanelEmptyState, PanelErrorState, PanelLoadingState } from '../shared/PanelStates';

interface Props {
  panelId: string;
  topicName: string;
  type: string;
  bagId?: string;
}

/** Audio chunks run at tens per second; this covers hours and bounds a runaway topic. */
const MESSAGE_LIMIT = 200_000;
const BUCKETS = 1200;
/** Restart the sound when it and the playhead disagree by more than this (a seek). */
const RESYNC_SEC = 0.25;

export function AudioPanel({ panelId, topicName, type, bagId }: Props) {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const bag = entry?.summary ?? null;
  const infoTopic = bag?.topics.find((t) => isAudioInfoType(t.type))?.name ?? '';
  const { messages, loading, progress, error } = useTopicMessages(topicName, MESSAGE_LIMIT, true, bagId);
  const info = useTopicMessages(infoTopic, 1, !!infoTopic, bagId);
  const playheadNs = useBagLocalPlayhead(bagId);
  const playing = usePlayheadStore((s) => s.playing);
  const speed = usePlayheadStore((s) => s.speed);
  const seek = usePlayheadStore((s) => s.seek);

  const decoded = useMemo((): { track: AudioTrack | null; note: string | null; error: string | null } => {
    if (!messages) return { track: null, note: null, error: null };
    try {
      const infoValue = info.messages?.[0]?.value as Record<string, unknown> | undefined;
      const format = infoValue ? formatFromInfo(infoValue) : DEFAULT_AUDIO_FORMAT;
      const chunks = messages
        .filter((m) => m.value)
        .map((m) => ({ timestamp: m.timestamp, ...decodeAudioMessage(m.value as Record<string, unknown>, format) }));
      const raw = messages.some((m) => !((m.value as { audio?: { info?: unknown } } | null)?.audio?.info));
      const note = raw && !infoValue ? 'No AudioInfo topic in this bag: assuming 16 kHz mono S16LE.' : null;
      return { track: buildTrack(chunks), note, error: null };
    } catch (e) {
      return { track: null, note: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [messages, info.messages]);
  const { track } = decoded;

  const startNs = bag?.startTime ?? 0n;
  const spanNs = bag ? bag.endTime - bag.startTime : 0n;
  const frac = (ns: bigint) => (spanNs > 0n ? Number(ns - startNs) / Number(spanNs) : 0);

  // Waveform over the whole bag, so it lines up with the timeline under it.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !track || spanNs <= 0n) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const ch = track.channels[0]!;
    const rate = track.rate;
    const offset = (Number(startNs - track.startNs) / 1e9) * rate;
    const { min, max } = waveformPeaks(ch, offset, offset + (Number(spanNs) / 1e9) * rate, BUCKETS);
    const h = canvas.height;
    ctx.clearRect(0, 0, BUCKETS, h);
    ctx.fillStyle = getTopicColor(topicName, type);
    for (let b = 0; b < BUCKETS; b++) {
      const y0 = (1 - max[b]!) * (h / 2);
      const y1 = (1 - min[b]!) * (h / 2);
      ctx.fillRect(b, y0, 1, Math.max(1, y1 - y0));
    }
  }, [track, startNs, spanNs, topicName, type]);

  // Sound follows the bag's playback.
  const [soundOn, setSoundOn] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<{ track: AudioTrack; buffer: AudioBuffer } | null>(null);
  const [epoch, setEpoch] = useState(0);
  const playheadRef = useRef(playheadNs);
  useEffect(() => {
    playheadRef.current = playheadNs;
  }, [playheadNs]);
  useEffect(() => {
    if (!soundOn || !playing || !track) return;
    const ctx = (audioCtxRef.current ??= new AudioContext());
    void ctx.resume();
    if (bufferRef.current?.track !== track) {
      const len = track.channels[0]!.length;
      const buffer = ctx.createBuffer(track.channels.length, len, track.rate);
      track.channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
      bufferRef.current = { track, buffer };
    }
    const buffer = bufferRef.current.buffer;
    const offset0 = Number(playheadRef.current - track.startNs) / 1e9;
    if (offset0 >= buffer.duration) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = speed;
    src.connect(ctx.destination);
    const ctxStart = ctx.currentTime;
    src.start(ctxStart + Math.max(0, -offset0) / speed, Math.max(0, offset0));
    // A seek moves the playhead away from where the sound is: restart from there.
    const timer = window.setInterval(() => {
      const expected = offset0 + (ctx.currentTime - ctxStart) * speed;
      const actual = Number(playheadRef.current - track.startNs) / 1e9;
      if (Math.abs(actual - expected) > RESYNC_SEC) setEpoch((n) => n + 1);
    }, 200);
    return () => {
      window.clearInterval(timer);
      try {
        src.stop();
      } catch {
        // already stopped
      }
      src.disconnect();
    };
  }, [soundOn, playing, speed, track, epoch]);
  useEffect(() => () => void audioCtxRef.current?.close(), []);

  const onSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!entry || spanNs <= 0n) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const local = startNs + BigInt(Math.round(Number(spanNs) * f));
    seek(alignedTimeFor(entry, local, useBagStore.getState().alignment));
  };

  const seconds = track ? track.channels[0]!.length / track.rate : 0;
  return (
    <PanelShell panelId={panelId} kind="audio" topicName={topicName} type={type} accentColor={getTopicColor(topicName, type)} bagId={bagId}>
      {loading && !messages && <PanelLoadingState message={`Decoded ${progress.toLocaleString()} messages…`} />}
      {(error || decoded.error) && <PanelErrorState message={(error ?? decoded.error)!} />}
      {messages && !decoded.error && !track && <PanelEmptyState message="This topic has no audio samples." />}
      {track && (
        <div className="flex-1 flex flex-col min-h-0 p-2 gap-2">
          <div className="flex items-center gap-3 text-xs text-text-muted">
            <button
              type="button"
              onClick={() => setSoundOn((v) => !v)}
              aria-pressed={soundOn}
              className={`px-2.5 py-1 rounded-md border transition-colors ${soundOn ? 'border-accent-blue/40 bg-accent-blue/10 text-accent-blue' : 'border-border hover:text-text-primary'}`}
              title="Play the sound along with the bag's playback"
            >
              {soundOn ? 'Sound on' : 'Sound off'}
            </button>
            <span className="mono" aria-label="Audio format">
              {track.rate.toLocaleString()} Hz, {track.channels.length === 1 ? 'mono' : `${track.channels.length} ch`}, {seconds.toFixed(1)} s
            </span>
            {decoded.note && <span className="text-accent-amber">{decoded.note}</span>}
          </div>
          <div className="relative flex-1 min-h-[60px] cursor-pointer rounded border border-border bg-bg-primary/40" onClick={onSeek} aria-label="Waveform, click to seek">
            <canvas ref={canvasRef} width={BUCKETS} height={200} className="absolute inset-0 w-full h-full" />
            <div className="absolute top-0 bottom-0 w-px bg-accent-amber pointer-events-none" style={{ left: `${frac(playheadNs) * 100}%` }} />
          </div>
        </div>
      )}
    </PanelShell>
  );
}
