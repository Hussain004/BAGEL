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
 */

import { useEffect, useRef, useState } from 'react';
import { useBagStore } from '../store/bagStore';
import { readMessageAtTime } from '../parsers';

export interface MessageAtTimeState {
  message: { timestamp: bigint; value: Record<string, unknown> | null } | null;
  loading: boolean;
  error: string | null;
}

export function useMessageAtTime(topicName: string, timeNs: bigint): MessageAtTimeState {
  const bag = useBagStore((s) => s.bag);
  const file = useBagStore((s) => s.file);

  const [state, setState] = useState<MessageAtTimeState>({
    message: null,
    loading: true,
    error: null,
  });

  const inflightRef = useRef(false);
  const pendingTimeRef = useRef<bigint | null>(null);
  // The latest effect's `fire` callable. If an older request resolves
  // *after* a newer effect has replaced this ref, the older resolution
  // hands off through here so the queued target still gets fetched.
  const fireRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!bag || !file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ message: null, loading: false, error: null });
      return;
    }

    let cancelled = false;

    const fire = (): void => {
      if (cancelled || inflightRef.current || pendingTimeRef.current === null) return;
      const target = pendingTimeRef.current;
      pendingTimeRef.current = null;
      inflightRef.current = true;

      readMessageAtTime(file, bag.format, topicName, target)
        .then((msg) => {
          inflightRef.current = false;
          if (cancelled) {
            // This effect's session was torn down (topic / file / time
            // changed). If a newer effect is parked waiting on the
            // in-flight gate, kick it off — its `fire` is on fireRef.
            if (pendingTimeRef.current !== null) fireRef.current();
            return;
          }
          setState({ message: msg, loading: false, error: null });
          if (pendingTimeRef.current !== null) fire();
        })
        .catch((err: unknown) => {
          inflightRef.current = false;
          if (cancelled) {
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

    return () => {
      cancelled = true;
    };
  }, [bag, file, topicName, timeNs]);

  return state;
}
