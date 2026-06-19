import { describe, it, expect, beforeEach } from 'vitest';
import { extractClockNs } from '../../src/live/liveConnection';
import { useLiveStore } from '../../src/store/liveStore';

// ── extractClockNs ────────────────────────────────────────────────────────────

describe('extractClockNs', () => {
  it('decodes a ROS2 Clock message (nanosec field)', () => {
    const msg = { clock: { sec: 1, nanosec: 500_000_000 } };
    expect(extractClockNs(msg)).toBe(1_500_000_000n);
  });

  it('decodes a ROS1 Clock message (nsec field)', () => {
    const msg = { clock: { sec: 10, nsec: 0 } };
    expect(extractClockNs(msg)).toBe(10_000_000_000n);
  });

  it('prefers nanosec over nsec when both are present', () => {
    const msg = { clock: { sec: 0, nanosec: 100, nsec: 999 } };
    expect(extractClockNs(msg)).toBe(100n);
  });

  it('defaults to 0 subseconds when neither nanosec nor nsec is present', () => {
    const msg = { clock: { sec: 5 } };
    expect(extractClockNs(msg)).toBe(5_000_000_000n);
  });

  it('handles t=0 (sim start before first tick)', () => {
    const msg = { clock: { sec: 0, nanosec: 0 } };
    expect(extractClockNs(msg)).toBe(0n);
  });

  it('handles large sim times (hours of simulation)', () => {
    // 1 hour = 3600 seconds
    const msg = { clock: { sec: 3600, nanosec: 0 } };
    expect(extractClockNs(msg)).toBe(3_600_000_000_000n);
  });

  it('truncates fractional seconds (float clock fields are a Gazebo quirk)', () => {
    const msg = { clock: { sec: 1.9, nanosec: 0 } };
    // Math.trunc(1.9) = 1
    expect(extractClockNs(msg)).toBe(1_000_000_000n);
  });

  it('returns null when clock field is missing', () => {
    expect(extractClockNs({ data: 42 })).toBeNull();
  });

  it('returns null when clock.sec is missing', () => {
    expect(extractClockNs({ clock: { nanosec: 100 } })).toBeNull();
  });

  it('returns null for a completely empty message', () => {
    expect(extractClockNs({})).toBeNull();
  });
});

// ── liveStore simTime ─────────────────────────────────────────────────────────

function resetStore() {
  useLiveStore.setState({
    revisions: new Map(),
    edgeTimes: new Map(),
    statuses: new Map(),
    statusMessages: new Map(),
    followLive: true,
    recording: new Map(),
    simTime: new Map(),
  });
}

describe('liveStore simTime', () => {
  beforeEach(resetStore);

  it('starts with empty simTime map', () => {
    expect(useLiveStore.getState().simTime.size).toBe(0);
  });

  it('setSimTime(true) marks a bag as using sim time', () => {
    useLiveStore.getState().setSimTime('bag1', true);
    expect(useLiveStore.getState().simTime.get('bag1')).toBe(true);
  });

  it('setSimTime(false) removes the entry', () => {
    useLiveStore.getState().setSimTime('bag1', true);
    useLiveStore.getState().setSimTime('bag1', false);
    expect(useLiveStore.getState().simTime.has('bag1')).toBe(false);
  });

  it('tracks multiple bags independently', () => {
    useLiveStore.getState().setSimTime('bag1', true);
    useLiveStore.getState().setSimTime('bag2', false);
    expect(useLiveStore.getState().simTime.has('bag1')).toBe(true);
    expect(useLiveStore.getState().simTime.has('bag2')).toBe(false);
  });

  it('removeEntry clears simTime for that bag', () => {
    useLiveStore.getState().setSimTime('bag1', true);
    useLiveStore.getState().removeEntry('bag1');
    expect(useLiveStore.getState().simTime.has('bag1')).toBe(false);
  });

  it('removeEntry does not affect other bags', () => {
    useLiveStore.getState().setSimTime('bag1', true);
    useLiveStore.getState().setSimTime('bag2', true);
    useLiveStore.getState().removeEntry('bag1');
    expect(useLiveStore.getState().simTime.get('bag2')).toBe(true);
  });
});
