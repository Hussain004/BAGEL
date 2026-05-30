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
 *
 * Cancellation is **session-scoped** (see useMessageAtTime for the full
 * rationale). Per-tick effect cleanup is fatal here: when the playhead
 * is moving, every in-flight request would be invalidated by the next
 * 16 ms tick and its decoded cloud would never reach state — the scene
 * froze until the user paused.
 */

import { useEffect, useRef, useState } from 'react';
import { useBagStore } from '../../../store/bagStore';
import { readLaserScanAtTime, readPointCloudAtTime } from '../../../parsers';
import type { ColorMode, HeightAxis, PointCloudExtraction } from '../../../utils/pointcloud';
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
  /** Drop points farther than this from the sensor origin (PointCloud2 only). */
  maxRange?: number;
  /**
   * Source-frame axis the height colormap samples. Tied to the panel's
   * up-axis selector so flipping up redirects the gradient too.
   * (PointCloud2 / CustomCloud only — LaserScan is colored by range.)
   */
  heightAxis?: HeightAxis;
}

export function useDecodedCloud({
  kind,
  topicName,
  timeNs,
  colorMode = 'height',
  maxPoints,
  maxRange,
  heightAxis,
}: Options): DecodedCloudState {
  const bag = useBagStore((s) => s.bag);
  const source = useBagStore((s) => s.source);

  const [state, setState] = useState<DecodedCloudState>({
    cloud: null,
    loading: true,
    error: null,
  });

  // Single-flight queue: at most one decode in flight per hook. Rapid playhead
  // updates collapse onto the latest pending target so we never decode frames
  // the user is about to skip past.
  const inflightRef = useRef(false);
  const pendingRef = useRef<{
    timeNs: bigint;
    colorMode: ColorMode;
    maxPoints: number | undefined;
    maxRange: number | undefined;
    heightAxis: HeightAxis | undefined;
  } | null>(null);
  const fireRef = useRef<() => void>(() => {});
  // Session id keyed on (bag, file, topic, kind). Bumped only when one of
  // these changes — never on timeNs ticks, so playback doesn't cancel its
  // own decodes.
  const sessionRef = useRef(0);
  // Dedupe: don't re-decode the same (topic, timestamp, colorMode) we already
  // have. We compare the decoded message's timestamp against the last result,
  // not the requested timeNs, since readers snap to the nearest sample.
  const lastResultKeyRef = useRef<string | null>(null);

  // Each (bag, file, topic, kind) tuple is a session. Bump on entry and exit
  // so any in-flight decode from the previous session bails before it calls
  // setState (which would either land on the wrong topic or — on unmount —
  // poke an already-torn-down component).
  useEffect(() => {
    sessionRef.current++;
    pendingRef.current = null;
    inflightRef.current = false;
    lastResultKeyRef.current = null;
    if (!bag || !source) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ cloud: null, loading: false, error: null });
    }
    return () => {
      // Intentional: bumping the session ref on unmount is what invalidates
      // in-flight decodes so their `.then` doesn't poke setState after we
      // tear down. The "ref will have changed" lint targets ref-to-DOM
      // cleanup; that warning isn't applicable here.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sessionRef.current++;
    };
  }, [bag, source, topicName, kind]);

  useEffect(() => {
    if (!bag || !source) return;

    const mySession = sessionRef.current;

    const fire = (): void => {
      if (inflightRef.current || pendingRef.current === null) return;
      if (sessionRef.current !== mySession) return;
      const target = pendingRef.current;
      pendingRef.current = null;
      inflightRef.current = true;

      const promise: Promise<DecodedCloud | null> =
        kind === 'pointcloud'
          ? readPointCloudAtTime(
              source,
              bag.format,
              topicName,
              target.timeNs,
              target.colorMode,
              target.maxPoints,
              target.maxRange,
              target.heightAxis,
            )
          : readLaserScanAtTime(source, bag.format, topicName, target.timeNs);

      promise
        .then((cloud) => {
          inflightRef.current = false;
          if (sessionRef.current !== mySession) {
            if (pendingRef.current !== null) fireRef.current();
            return;
          }
          if (cloud) {
            // heightAxis is in the cache key so flipping the up-axis triggers
            // a re-decode (otherwise the same-timestamp dedupe would suppress it).
            const key = `${target.colorMode}|${target.maxRange ?? 0}|${target.heightAxis ?? '+z'}|${cloud.timestamp.toString()}`;
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
          if (sessionRef.current !== mySession) {
            if (pendingRef.current !== null) fireRef.current();
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          setState((s) => ({ ...s, loading: false, error: message }));
          if (pendingRef.current !== null) fire();
        });
    };

    pendingRef.current = { timeNs, colorMode, maxPoints, maxRange, heightAxis };
    fireRef.current = fire;
    // Only flip the spinner when nothing is in flight, so during playback the
    // existing frame stays painted until the next one arrives (no flicker).
    if (!inflightRef.current) {
      setState((s) => ({ ...s, loading: true, error: null }));
    }
    fire();
  }, [bag, source, topicName, timeNs, colorMode, maxPoints, maxRange, heightAxis, kind]);

  return state;
}
