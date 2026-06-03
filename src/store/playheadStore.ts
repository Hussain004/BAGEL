/**
 * Zustand store for the global playhead.
 *
 * The playhead is a single time cursor (in nanoseconds since epoch) shared
 * across every visualization panel. It can be scrubbed manually, played
 * forward with a configurable speed, or seeked to a specific timestamp.
 *
 * v1.3.3 adds a `loop` flag: when on, hitting the end of the playhead range
 * wraps back to the start instead of pausing. Persisted to localStorage so
 * the user's choice survives a reload (every other playback parameter is
 * either bag-dependent like `startNs/endNs` or transient like `playing`).
 */

import { create } from 'zustand';

const LOOP_STORAGE_KEY = 'bagel:loop:v1';

function readInitialLoop(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LOOP_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistLoop(loop: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOOP_STORAGE_KEY, loop ? '1' : '0');
  } catch {
    // Best-effort persistence (e.g. sandboxed iframes throw).
  }
}

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
  /**
   * When true, `tick` wraps the playhead back to `startNs` instead of
   * pausing when it crosses `endNs`. Useful for short bags that the user
   * wants to inspect repeatedly without manually seeking.
   */
  loop: boolean;

  /** Reset for a newly loaded bag - sets bounds and parks the head at start. */
  initFromBag: (startNs: bigint, endNs: bigint) => void;
  /** Snap the playhead to a specific (clamped) timestamp. */
  seek: (timeNs: bigint) => void;
  /** Snap by a fraction [0, 1] of the bag duration. */
  seekFraction: (fraction: number) => void;
  setPlaying: (playing: boolean) => void;
  setSpeed: (speed: number) => void;
  setLoop: (loop: boolean) => void;
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
  loop: readInitialLoop(),

  initFromBag: (startNs, endNs) => {
    // `loop` is intentionally preserved across bag swaps - it's a user
    // preference, not a per-bag state.
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
  setLoop: (loop) => {
    persistLoop(loop);
    set({ loop });
  },

  tick: (deltaSec) => {
    const { timeNs, startNs, endNs, speed, loop } = get();
    const deltaNs = BigInt(Math.round(deltaSec * speed * 1e9));
    let next = timeNs + deltaNs;
    if (next > endNs) {
      if (loop && endNs > startNs) {
        // Wrap by the overshoot modulo the bag range. Handles the pathological
        // "huge deltaSec on a tiny bag" case (e.g. the tab was backgrounded
        // and the first foreground tick is multi-second on a 1 s bag) without
        // running the wrap loop hundreds of times.
        const range = endNs - startNs;
        const overshoot = next - endNs;
        const wrapped = startNs + (overshoot % range);
        set({ timeNs: wrapped });
        return;
      }
      next = endNs;
      set({ timeNs: next, playing: false });
      return;
    }
    if (next < startNs) next = startNs;
    set({ timeNs: next });
  },
}));
