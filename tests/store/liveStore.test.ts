import { describe, it, expect, beforeEach } from 'vitest';
import { useLiveStore } from '../../src/store/liveStore';

function resetStore() {
  useLiveStore.setState({
    revisions: new Map(),
    edgeTimes: new Map(),
    statuses: new Map(),
    statusMessages: new Map(),
    followLive: true,
  });
}

describe('liveStore', () => {
  beforeEach(resetStore);

  it('starts with empty maps and followLive=true', () => {
    const s = useLiveStore.getState();
    expect(s.revisions.size).toBe(0);
    expect(s.edgeTimes.size).toBe(0);
    expect(s.statuses.size).toBe(0);
    expect(s.followLive).toBe(true);
  });

  describe('bumpRevision', () => {
    it('increments revision from 0 to 1', () => {
      useLiveStore.getState().bumpRevision('bag1', 100n);
      expect(useLiveStore.getState().revisions.get('bag1')).toBe(1);
    });

    it('increments revision monotonically', () => {
      const { bumpRevision } = useLiveStore.getState();
      bumpRevision('bag1', 100n);
      bumpRevision('bag1', 200n);
      bumpRevision('bag1', 300n);
      expect(useLiveStore.getState().revisions.get('bag1')).toBe(3);
    });

    it('updates edgeTime to the latest timeNs', () => {
      const { bumpRevision } = useLiveStore.getState();
      bumpRevision('bag1', 500n);
      bumpRevision('bag1', 999n);
      expect(useLiveStore.getState().edgeTimes.get('bag1')).toBe(999n);
    });

    it('tracks multiple bags independently', () => {
      const { bumpRevision } = useLiveStore.getState();
      bumpRevision('bag1', 100n);
      bumpRevision('bag2', 200n);
      bumpRevision('bag1', 300n);
      const s = useLiveStore.getState();
      expect(s.revisions.get('bag1')).toBe(2);
      expect(s.revisions.get('bag2')).toBe(1);
      expect(s.edgeTimes.get('bag1')).toBe(300n);
      expect(s.edgeTimes.get('bag2')).toBe(200n);
    });
  });

  describe('setStatus', () => {
    it('sets status for a bag', () => {
      useLiveStore.getState().setStatus('bag1', 'connected');
      expect(useLiveStore.getState().statuses.get('bag1')).toBe('connected');
    });

    it('sets statusMessage when provided', () => {
      useLiveStore.getState().setStatus('bag1', 'error', 'connection refused');
      expect(useLiveStore.getState().statusMessages.get('bag1')).toBe('connection refused');
    });

    it('clears statusMessage when no message provided', () => {
      useLiveStore.getState().setStatus('bag1', 'error', 'oops');
      useLiveStore.getState().setStatus('bag1', 'connected');
      expect(useLiveStore.getState().statusMessages.has('bag1')).toBe(false);
    });

    it('handles all valid status values', () => {
      const statuses = ['connecting', 'connected', 'disconnected', 'reconnecting', 'error'] as const;
      for (const status of statuses) {
        useLiveStore.getState().setStatus('bag1', status);
        expect(useLiveStore.getState().statuses.get('bag1')).toBe(status);
      }
    });
  });

  describe('setFollowLive', () => {
    it('toggles followLive to false', () => {
      useLiveStore.getState().setFollowLive(false);
      expect(useLiveStore.getState().followLive).toBe(false);
    });

    it('toggles followLive back to true', () => {
      useLiveStore.getState().setFollowLive(false);
      useLiveStore.getState().setFollowLive(true);
      expect(useLiveStore.getState().followLive).toBe(true);
    });
  });

  describe('removeEntry', () => {
    it('removes all per-bag state', () => {
      const { bumpRevision, setStatus, removeEntry } = useLiveStore.getState();
      bumpRevision('bag1', 100n);
      setStatus('bag1', 'connected', 'TestServer');
      removeEntry('bag1');
      const s = useLiveStore.getState();
      expect(s.revisions.has('bag1')).toBe(false);
      expect(s.edgeTimes.has('bag1')).toBe(false);
      expect(s.statuses.has('bag1')).toBe(false);
      expect(s.statusMessages.has('bag1')).toBe(false);
    });

    it('does not affect other bags', () => {
      const { bumpRevision, setStatus, removeEntry } = useLiveStore.getState();
      bumpRevision('bag1', 100n);
      bumpRevision('bag2', 200n);
      setStatus('bag1', 'connected');
      setStatus('bag2', 'connecting');
      removeEntry('bag1');
      const s = useLiveStore.getState();
      expect(s.revisions.has('bag2')).toBe(true);
      expect(s.statuses.get('bag2')).toBe('connecting');
    });

    it('is a no-op for unknown bagId', () => {
      expect(() => useLiveStore.getState().removeEntry('nonexistent')).not.toThrow();
    });
  });
});
