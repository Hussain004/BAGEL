/**
 * Zustand store for the global playhead.
 *
 * The playhead is a single time cursor (in nanoseconds since epoch) shared
 * across every visualization panel. It can be scrubbed manually, played
 * forward with a configurable speed, or seeked to a specific timestamp.
 */

import { create } from 'zustand';

interface PlayheadState {
  /** Current playhead time in nanoseconds. 0n until a bag is loaded. */
  timeNs: bigint;
  /** Bag start time, mirrored here so utilities can clamp without touching bagStore. */
  startNs: bigint;
  /** Bag end time. */
  endNs: bigint;
  /** Whether the playhead is currently advancing automatically. */
  playing: boolean;
  /** Playback speed multiplier (1 = real time). */
  speed: number;

  /** Reset for a newly loaded bag — sets bounds and parks the head at start. */
  initFromBag: (startNs: bigint, endNs: bigint) => void;
  /** Snap the playhead to a specific (clamped) timestamp. */
  seek: (timeNs: bigint) => void;
  /** Snap by a fraction [0, 1] of the bag duration. */
  seekFraction: (fraction: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  /** Advance the playhead by `deltaSec` real-time seconds, scaled by speed. */
  tick: (deltaSec: number) => void;
}

function clamp(t: bigint, lo: bigint, hi: bigint): bigint {
  if (t < lo) return lo;
  if (t > hi) return hi;
  return t;
}

export const usePlayheadStore = create<PlayheadState>((set, get) => ({
  timeNs: 0n,
  startNs: 0n,
  endNs: 0n,
  playing: false,
  speed: 1,

  initFromBag: (startNs, endNs) => {
    set({ startNs, endNs, timeNs: startNs, playing: false, speed: 1 });
  },

  seek: (timeNs) => {
    const { startNs, endNs } = get();
    set({ timeNs: clamp(timeNs, startNs, endNs) });
  },

  seekFraction: (fraction) => {
    const { startNs, endNs } = get();
    const f = Math.max(0, Math.min(1, fraction));
    const range = endNs - startNs;
    const offsetNs = BigInt(Math.floor(Number(range) * f));
    set({ timeNs: startNs + offsetNs });
  },

  setPlaying: (playing) => set({ playing }),
  setSpeed: (speed) => set({ speed }),

  tick: (deltaSec) => {
    const { timeNs, startNs, endNs, speed } = get();
    const deltaNs = BigInt(Math.round(deltaSec * speed * 1e9));
    let next = timeNs + deltaNs;
    if (next > endNs) {
      next = endNs;
      set({ timeNs: next, playing: false });
      return;
    }
    if (next < startNs) next = startNs;
    set({ timeNs: next });
  },
}));
