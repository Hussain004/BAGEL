/**
 * useLivePlayhead - keeps the playhead range and cursor in sync with the live
 * ring buffer as data arrives.
 *
 * Behaviour:
 *   - On every revision bump, update playheadStore.startNs/endNs to match
 *     the ring buffer's actual time coverage (accounts for evictions at the
 *     front and new data at the back).
 *   - When followLive is true, also seek the cursor to the live edge so the
 *     user always sees the most recent data.
 *   - When followLive is false, the cursor stays where it is (the user is
 *     scrubbing through history) but the range still expands so they can
 *     always seek forward to fresh data.
 *
 * Called once from App.tsx so it's active for the whole session.
 */

import { useEffect } from 'react';
import { useBagStore } from '../store/bagStore';
import { useLiveStore } from '../store/liveStore';
import { usePlayheadStore } from '../store/playheadStore';

export function useLivePlayhead(): void {
  const focusBagId = useBagStore((s) => s.focusBagId);
  const bags = useBagStore((s) => s.bags);
  const followLive = useLiveStore((s) => s.followLive);
  const edgeTimes = useLiveStore((s) => s.edgeTimes);

  useEffect(() => {
    if (!focusBagId) return;
    const entry = bags.get(focusBagId);
    if (entry?.kind !== 'live' || !entry.liveConn) return;

    const range = entry.liveConn.ringBuffer.getTimeRange();
    if (!range) return;

    // Keep playhead boundaries current so the scrubber always spans the
    // full buffered window.
    usePlayheadStore.setState({
      startNs: range.startNs,
      endNs: range.endNs,
    });

    if (followLive) {
      usePlayheadStore.getState().seek(range.endNs);
    }
  }, [focusBagId, bags, followLive, edgeTimes]);
}
