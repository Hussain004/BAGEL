/**
 * useMessageAtTime — Lazy-fetch the single message nearest a given playhead
 * timestamp for a topic. Used by panels (Image, Raw inspector) that only
 * need the current frame, not the whole stream.
 *
 * Single-flight scheduling: at most one `readMessageAtTime` request is in
 * flight per hook instance. Rapid playhead updates during playback (the
 * timeline ticks at 60 Hz) collapse onto the latest pending timestamp, so
 * intermediate frames the user would never see don't queue work on the
 * worker. When the in-flight request resolves, the latest pending target
 * is fired immediately. The previous decoded message stays on-screen
 * during the in-flight window to avoid flicker.
 *
 * Cancellation is **session-scoped** — keyed on (bag, file, topic), not on
 * timeNs. A timeNs change updates `pendingTimeRef` and triggers a new fire
 * once the in-flight settles. If cancellation followed the per-effect
 * `cancelled` flag, every in-flight request would be invalidated by the
 * next playhead tick (~16 ms), and during playback the worker would
 * happily decode frames whose results we then refused to apply — the
 * panel would stay frozen until the user paused, which is exactly the
 * regression we hit in v0.4.
 *
 * v0.9 multi-bag: callers pass a `bagId` to read from a specific bag. When
 * omitted, the hook falls back to the focused bag.
 */

import { useEffect, useRef, useState } from 'react';
import { useBagStore, resolveBagEntry } from '../store/bagStore';
import { useLiveStore } from '../store/liveStore';
import { readMessageAtTime } from '../parsers';

export interface MessageAtTimeState {
  message: { timestamp: bigint; value: Record<string, unknown> | null } | null;
  loading: boolean;
  error: string | null;
}

export function useMessageAtTime(
  topicName: string,
  timeNs: bigint,
  bagId?: string,
): MessageAtTimeState {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));

  // Subscribe to live revisions so we re-render when a new frame arrives.
  const liveRevision = useLiveStore((s) =>
    entry?.kind === 'live' ? (s.revisions.get(entry.id) ?? 0) : 0,
  );

  const [state, setState] = useState<MessageAtTimeState>({
    message: null,
    loading: true,
    error: null,
  });

  const inflightRef = useRef(false);
  const pendingTimeRef = useRef<bigint | null>(null);
  // Session id is bumped whenever the bag/file/topic changes. In-flight
  // requests carry the session they were issued under and bail when it
  // no longer matches — timeNs ticks do NOT bump the session.
  const sessionRef = useRef(0);
  const fireRef = useRef<() => void>(() => {});

  // ── Live path: synchronous ring-buffer lookup, no worker involved.
  useEffect(() => {
    if (!entry || !topicName || entry.kind !== 'live' || !entry.liveConn) return;
    const raw = entry.liveConn.ringBuffer.getMessageAtTime(topicName, timeNs);
    const msg = raw ? { timestamp: raw.timeNs, value: raw.value } : null;
    // Reflecting an external, non-reactive ring buffer into React state -
    // there's no subscription to hook a useSyncExternalStore up to here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ message: msg, loading: false, error: null });
  }, [entry, topicName, timeNs, liveRevision]);

  // ── File / URL path: session management. Bump when bag/topic changes to
  // invalidate any in-flight worker requests from the previous session.
  useEffect(() => {
    sessionRef.current++;
    pendingTimeRef.current = null;
    inflightRef.current = false;
    if (!entry || entry.kind === 'live') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ message: null, loading: false, error: null });
    }
    return () => {
      // Intentional: bumping the session ref on unmount is what invalidates
      // in-flight requests so their `.then` doesn't poke setState after we
      // tear down. The "ref will have changed" lint targets ref-to-DOM
      // cleanup; that warning isn't applicable here.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      sessionRef.current++;
    };
  }, [entry, topicName]);

  useEffect(() => {
    if (!entry || entry.kind === 'live' || !entry.source) return;

    const mySession = sessionRef.current;
    const { id: workerBagId, summary: bag, source } = entry;

    const fire = (): void => {
      if (inflightRef.current || pendingTimeRef.current === null) return;
      if (sessionRef.current !== mySession) return;
      const target = pendingTimeRef.current;
      pendingTimeRef.current = null;
      inflightRef.current = true;

      readMessageAtTime(workerBagId, source, bag.format, topicName, target)
        .then((msg) => {
          inflightRef.current = false;
          if (sessionRef.current !== mySession) {
            // Bag/topic changed mid-flight. Hand off to the latest fire so
            // its pending target still gets serviced if there is one.
            if (pendingTimeRef.current !== null) fireRef.current();
            return;
          }
          setState({ message: msg, loading: false, error: null });
          if (pendingTimeRef.current !== null) fire();
        })
        .catch((err: unknown) => {
          inflightRef.current = false;
          if (sessionRef.current !== mySession) {
            if (pendingTimeRef.current !== null) fireRef.current();
            return;
          }
          const message = err instanceof Error ? err.message : String(err);
          setState((s) => ({ ...s, loading: false, error: message }));
          if (pendingTimeRef.current !== null) fire();
        });
    };

    pendingTimeRef.current = timeNs;
    fireRef.current = fire;
    // Only flip the spinner on if we're actually about to dispatch; while
    // an older request is still resolving we want to keep the prior frame
    // visible to avoid a flash of loading state on every playhead tick.
    if (!inflightRef.current) {
      setState((s) => ({ ...s, loading: true, error: null }));
    }
    fire();
  }, [entry, topicName, timeNs]);

  return state;
}
