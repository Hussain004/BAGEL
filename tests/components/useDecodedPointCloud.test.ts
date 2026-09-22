/**
 * Pure-function tests for `settleCloudState`, the dedupe bailout used by
 * `useDecodedCloud` when a decode result matches the frame already in state.
 *
 * Only the pure helper is covered here: the hook itself needs a DOM + React
 * renderer, which this suite (node environment) doesn't have.
 */
import { describe, expect, it } from 'vitest';
import {
  settleCloudState,
  type DecodedCloudState,
} from '../../src/components/panels/ThreeDScene/useDecodedPointCloud';

describe('settleCloudState', () => {
  it('returns the exact same reference when already settled', () => {
    const settled: DecodedCloudState = { cloud: null, loading: false, error: null };
    expect(settleCloudState(settled)).toBe(settled);
  });

  it('clears the spinner without touching the cloud', () => {
    const cloud = { fake: true } as unknown as DecodedCloudState['cloud'];
    const next = settleCloudState({ cloud, loading: true, error: null });
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
    expect(next.cloud).toBe(cloud);
  });

  it('clears a pending error while keeping the previous frame painted', () => {
    const cloud = { fake: true } as unknown as DecodedCloudState['cloud'];
    const next = settleCloudState({ cloud, loading: false, error: 'boom' });
    expect(next).toEqual({ cloud, loading: false, error: null });
  });

  it('settles a spinner+error state in one pass', () => {
    const next = settleCloudState({ cloud: null, loading: true, error: 'boom' });
    expect(next).toEqual({ cloud: null, loading: false, error: null });
    // And a second call is a bailout again.
    expect(settleCloudState(next)).toBe(next);
  });
});
