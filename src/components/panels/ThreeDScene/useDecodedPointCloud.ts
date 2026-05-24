/**
 * Lazy single-frame PointCloud2 / LaserScan loader for the 3D panel.
 *
 * Mirrors the single-flight pattern of `useMessageAtTime` but delegates all
 * decoding to the parser worker, which returns Float32Array positions +
 * colors via transferable buffers — zero-copy back to the main thread.
 *
 * This keeps two big costs off the UI thread on every playhead tick:
 *  - Cloning a 1-12 MB `data: Uint8Array` across the worker boundary
 *  - Walking each point through DataView reads and the Turbo polynomial
 *
 * Compared with `useMessageAtTime` + main-thread decode, this is typically
 * 5-10× faster on a Velodyne-64 / Ouster-OS-1 frame.
 */

import { useEffect, useRef, useState } from 'react';
import { useBagStore } from '../../../store/bagStore';
import { readLaserScanAtTime, readPointCloudAtTime } from '../../../parsers';
import type { ColorMode, PointCloudExtraction } from '../../../utils/pointcloud';
import type { LaserScanExtraction } from '../../../utils/laserscan';

export type DecodedCloud =
  | (PointCloudExtraction & { timestamp: bigint })
  | (LaserScanExtraction & { timestamp: bigint });

export interface DecodedCloudState {
  cloud: DecodedCloud | null;
  loading: boolean;
  error: string | null;
}

export type CloudKind = 'pointcloud' | 'laserscan';

interface Options {
  kind: CloudKind;
  topicName: string;
  timeNs: bigint;
  colorMode?: ColorMode;
  /** Hard cap on points decoded per frame (PointCloud2 only). */
  maxPoints?: number;
}

export function useDecodedCloud({
  kind,
  topicName,
  timeNs,
  colorMode = 'height',
  maxPoints,
}: Options): DecodedCloudState {
  const bag = useBagStore((s) => s.bag);
  const file = useBagStore((s) => s.file);

  const [state, setState] = useState<DecodedCloudState>({
    cloud: null,
    loading: true,
    error: null,
  });

  // Single-flight queue: at most one decode in flight per hook. Rapid playhead
  // updates collapse onto the latest pending target so we never decode frames
  // the user is about to skip past.
  const inflightRef = useRef(false);
  const pendingRef = useRef<{ timeNs: bigint; colorMode: ColorMode; maxPoints: number | undefined } | null>(null);
  const fireRef = useRef<() => void>(() => {});
  // Dedupe: don't re-decode the same (topic, timestamp, colorMode) we already
  // have. We compare the decoded message's timestamp against the last result,
  // not the requested timeNs, since readers snap to the nearest sample.
  const lastResultKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!bag || !file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ cloud: null, loading: false, error: null });
      return;
    }

    let cancelled = false;

    const fire = (): void => {
      if (cancelled || inflightRef.current || pendingRef.current === null) return;
      const target = pendingRef.current;
      pendingRef.current = null;
      inflightRef.current = true;

      const promise: Promise<DecodedCloud | null> =
        kind === 'pointcloud'
          ? readPointCloudAtTime(file, bag.format, topicName, target.timeNs, target.colorMode, target.maxPoints)
          : readLaserScanAtTime(file, bag.format, topicName, target.timeNs);

      promise
        .then((cloud) => {
          inflightRef.current = false;
          if (cancelled) {
            if (pendingRef.current !== null) fireRef.current();
            return;
          }
          if (cloud) {
            const key = `${target.colorMode}|${cloud.timestamp.toString()}`;
            if (lastResultKeyRef.current === key) {
              // Same frame + same color settings; don't notify React (avoids
              // a redundant scene rebuild on the same data).
              setState((s) => ({ ...s, loading: false, error: null }));
            } else {
              lastResultKeyRef.current = key;
              setState({ cloud, loading: false, error: null });
            }
          } else {
            setState({ cloud: null, loading: false, error: null });
          }
          if (pendingRef.current !== null) fire();
        })
        .catch((err: unknown) => {
          inflightRef.current = false;
          if (cancelled) {
            if (pendingRef.current !== null) fireRef.current();
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          setState((s) => ({ ...s, loading: false, error: message }));
          if (pendingRef.current !== null) fire();
        });
    };

    pendingRef.current = { timeNs, colorMode, maxPoints };
    fireRef.current = fire;
    // Only flip the spinner when nothing is in flight, so during playback the
    // existing frame stays painted until the next one arrives (no flicker).
    if (!inflightRef.current) {
      setState((s) => ({ ...s, loading: true, error: null }));
    }
    fire();

    return () => {
      cancelled = true;
    };
  }, [bag, file, topicName, timeNs, colorMode, maxPoints, kind]);

  // When the topic / kind changes, drop the dedupe key so the next decode
  // always emits a new result.
  useEffect(() => {
    lastResultKeyRef.current = null;
  }, [topicName, kind]);

  return state;
}
