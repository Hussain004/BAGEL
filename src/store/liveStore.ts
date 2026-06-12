/**
 * Zustand store for live-connection reactive state.
 *
 * Kept separate from bagStore intentionally: this store updates at message
 * rate (up to 60x/s after RAF throttling) for revision bumps, which would
 * cause every bagStore subscriber to re-render on every incoming message.
 * Isolating here means only hooks that explicitly subscribe to liveStore
 * are affected.
 *
 * LiveConnection writes here via bumpRevision/setStatus; hooks and UI
 * components read from here to react to live data.
 */

import { create } from 'zustand';

export type LiveStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error';

interface LiveState {
  /**
   * Per-bag revision counter, bumped (via RAF) on every message push.
   * useTopicMessages / useMessageAtTime subscribe to this to re-render
   * when fresh data arrives for a live bag.
   */
  revisions: Map<string, number>;

  /** Latest message time per bag - the "live edge" that followLive seeks to. */
  edgeTimes: Map<string, bigint>;

  /** Per-bag WebSocket connection status. */
  statuses: Map<string, LiveStatus>;

  /** Optional human-readable status detail (error message, server name...). */
  statusMessages: Map<string, string>;

  /**
   * Whether the playhead auto-follows the live edge. Persisted per session
   * only (not localStorage) since the user's expectation on reconnect is
   * to resume following.
   */
  followLive: boolean;

  bumpRevision: (bagId: string, timeNs: bigint) => void;
  setStatus: (bagId: string, status: LiveStatus, message?: string) => void;
  setFollowLive: (v: boolean) => void;
  removeEntry: (bagId: string) => void;
}

export const useLiveStore = create<LiveState>((set) => ({
  revisions: new Map(),
  edgeTimes: new Map(),
  statuses: new Map(),
  statusMessages: new Map(),
  followLive: true,

  bumpRevision: (bagId, timeNs) =>
    set((s) => {
      const revisions = new Map(s.revisions);
      revisions.set(bagId, (revisions.get(bagId) ?? 0) + 1);
      const edgeTimes = new Map(s.edgeTimes);
      edgeTimes.set(bagId, timeNs);
      return { revisions, edgeTimes };
    }),

  setStatus: (bagId, status, message) =>
    set((s) => {
      const statuses = new Map(s.statuses);
      statuses.set(bagId, status);
      const statusMessages = new Map(s.statusMessages);
      if (message !== undefined) statusMessages.set(bagId, message);
      else statusMessages.delete(bagId);
      return { statuses, statusMessages };
    }),

  setFollowLive: (followLive) => set({ followLive }),

  removeEntry: (bagId) =>
    set((s) => {
      const revisions = new Map(s.revisions);
      const edgeTimes = new Map(s.edgeTimes);
      const statuses = new Map(s.statuses);
      const statusMessages = new Map(s.statusMessages);
      revisions.delete(bagId);
      edgeTimes.delete(bagId);
      statuses.delete(bagId);
      statusMessages.delete(bagId);
      return { revisions, edgeTimes, statuses, statusMessages };
    }),
}));
