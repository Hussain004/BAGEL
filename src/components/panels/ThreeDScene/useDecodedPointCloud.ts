/**
 * Lazy single-frame PointCloud2 / LaserScan loader for the 3D panel.
 *
 * Mirrors the single-flight pattern of `useMessageAtTime` but delegates all
 * decoding to the parser worker, which returns Float32Array positions +
 * colors via transferable buffers - zero-copy back to the main thread.
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
 * 16 ms tick and its decoded cloud would never reach state - the scene
 * froze until the user paused.
 *
 * v0.9 multi-bag: accepts an optional `bagId` to read from a specific bag.
 */

import { useEffect, useRef, useState } from 'react';
import { useBagStore, resolveBagEntry } from '../../../store/bagStore';
import { readLaserScanAtTime, readPointCloudAtTime } from '../../../parsers';
import type { AxisClip, ColorMode, HeightAxis, PointCloudExtraction } from '../../../utils/pointcloud';
import type { LaserScanExtraction } from '../../../utils/laserscan';

export type DecodedCloud =
  | (PointCloudExtraction & { timestamp: bigint })
  | (LaserScanExtraction & { timestamp: bigint });

export interface DecodedCloudState {
  cloud: DecodedCloud | null;
  loading: boolean;
  error: string | null;
}

/**
 * Settle a decode result into `prev`. Returns `prev` *unchanged* (same
 * object reference) when it already reads `{loading: false, error: null}`,
 * so React's state bailout skips the re-render entirely. This is what keeps
 * a duplicate result key (same frame, same colour settings) from feeding a
 * fresh state object back into the effect that produced it.
 */
export function settleCloudState(prev: DecodedCloudState): DecodedCloudState {
  if (!prev.loading && prev.error === null) return prev;
  return { ...prev, loading: false, error: null };
}

type CloudKind = 'pointcloud' | 'laserscan';

interface Options {
  kind: CloudKind;
  topicName: string;
  timeNs: bigint;
  /**
   * Gate the worker RPC, mirroring `useTopicMessages`' `enabled` flag. The
   * 3D panel mounts this hook unconditionally (rules of hooks) but only
   * cloud-shaped panels want a decode; pose / map / marker panels pass
   * `false` so they don't burn a worker round-trip per playhead tick on a
   * result nobody reads.
   */
  enabled?: boolean;
  colorMode?: ColorMode;
  /** Hard cap on points decoded per frame (PointCloud2 only). */
  maxPoints?: number;
  /** Drop points farther than this from the sensor origin (PointCloud2 only). */
  maxRange?: number;
  /**
   * Source-frame axis the height colormap samples. Tied to the panel's
   * up-axis selector so flipping up redirects the gradient too.
   * (PointCloud2 / CustomCloud only - LaserScan is colored by range.)
   */
  heightAxis?: HeightAxis;
  /** Per-axis clip box. Drop points outside any active bound (PointCloud2 only). */
  axisClip?: AxisClip;
  /** Optional bag id; defaults to the focused bag. */
  bagId?: string;
}

export function useDecodedCloud({
  kind,
  topicName,
  timeNs,
  enabled = true,
  colorMode = 'height',
  maxPoints,
  maxRange,
  heightAxis,
  axisClip,
  bagId,
}: Options): DecodedCloudState {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));

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
    axisClip: AxisClip | undefined;
  } | null>(null);
  const fireRef = useRef<() => void>(() => {});
  // Session id keyed on (bag, file, topic, kind). Bumped only when one of
  // these changes - never on timeNs ticks, so playback doesn't cancel its
  // own decodes.
  const sessionRef = useRef(0);
  // Dedupe: don't re-decode the same (topic, timestamp, colorMode) we already
  // have. We compare the decoded message's timestamp against the last result,
  // not the requested timeNs, since readers snap to the nearest sample.
  const lastResultKeyRef = useRef<string | null>(null);

  // Each (bag, file, topic, kind) tuple is a session. Bump on entry and exit
  // so any in-flight decode from the previous session bails before it calls
  // setState (which would either land on the wrong topic or - on unmount -
  // poke an already-torn-down component).
  useEffect(() => {
    sessionRef.current++;
    pendingRef.current = null;
    inflightRef.current = false;
    lastResultKeyRef.current = null;
    if (!enabled) {
      // Caller doesn't want this stream (pose / map / marker panel). Idle
      // state, matching `useTopicMessages`' disabled path.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ cloud: null, loading: false, error: null });
    } else if (!entry) {
      setState({ cloud: null, loading: false, error: null });
    } else if (entry.kind === 'live') {
      // Live bags have no worker decode path for cloud payloads yet (the
      // decode effect below bails on `entry.kind === 'live'`), so without
      // this the initial spinner would never clear. Surface a real error
      // instead of an infinite "Loading frame..." state.
      setState({
        cloud: null,
        loading: false,
        error: 'Live point clouds are not supported yet',
      });
    }
    return () => {
      // Intentional: bumping the session ref on unmount is what invalidates
      // in-flight decodes so their `.then` doesn't poke setState after we
      // tear down. The "ref will have changed" lint targets ref-to-DOM
      // cleanup; that warning isn't applicable here.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sessionRef.current++;
    };
  }, [entry, topicName, kind, enabled]);

  useEffect(() => {
    if (!enabled || !entry || entry.kind === 'live' || !entry.source) return;
    const mySession = sessionRef.current;
    const { id: workerBagId, summary: bag, source } = entry;

    const fire = (): void => {
      if (inflightRef.current || pendingRef.current === null) return;
      if (sessionRef.current !== mySession) return;
      const target = pendingRef.current;
      pendingRef.current = null;
      inflightRef.current = true;

      const promise: Promise<DecodedCloud | null> =
        kind === 'pointcloud'
          ? readPointCloudAtTime(
              workerBagId,
              source,
              bag.format,
              topicName,
              target.timeNs,
              target.colorMode,
              target.maxPoints,
              target.maxRange,
              target.heightAxis,
              target.axisClip,
            )
          : readLaserScanAtTime(workerBagId, source, bag.format, topicName, target.timeNs);

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
            const ac = target.axisClip;
            const clipKey = ac
              ? `${ac.xMin ?? ''}:${ac.xMax ?? ''}:${ac.yMin ?? ''}:${ac.yMax ?? ''}:${ac.zMin ?? ''}:${ac.zMax ?? ''}`
              : '';
            const key = `${target.colorMode}|${target.maxRange ?? 0}|${target.heightAxis ?? '+z'}|${clipKey}|${cloud.timestamp.toString()}`;
            if (lastResultKeyRef.current === key) {
              // Same frame + same color settings; don't notify React (avoids
              // a redundant scene rebuild on the same data). `settleCloudState`
              // hands back `prev` unchanged when already settled, so no new
              // state object lands in this effect's deps by way of a
              // re-render.
              setState((s) => settleCloudState(s));
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

    pendingRef.current = { timeNs, colorMode, maxPoints, maxRange, heightAxis, axisClip };
    fireRef.current = fire;
    // Only flip the spinner when nothing is in flight, so during playback the
    // existing frame stays painted until the next one arrives (no flicker).
    // Bail without a new object when the spinner is already up and no error
    // is pending - an avoidable new state object here would re-render the
    // panel for nothing.
    if (!inflightRef.current) {
      setState((s) =>
        s.loading && s.error === null ? s : { ...s, loading: true, error: null },
      );
    }
    fire();
  }, [entry, topicName, timeNs, enabled, colorMode, maxPoints, maxRange, heightAxis, axisClip, kind]);

  return state;
}
