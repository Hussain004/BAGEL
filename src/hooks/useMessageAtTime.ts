/**
 * useMessageAtTime — Lazy-fetch the single message nearest a given playhead
 * timestamp for a topic. Used by panels (Image, Raw inspector) that only
 * need the current frame, not the whole stream.
 *
 * - Coalesces rapid playhead changes so we don't fire a read per pixel of
 *   scrubbing — the latest target time wins.
 * - Keeps showing the previous decoded message while the next read is in
 *   flight to avoid flicker on the canvas / JSON tree.
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

  // Each effect run gets a sequence number so a slow read that resolves
  // after a newer one is ignored.
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!bag || !file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ message: null, loading: false, error: null });
      return;
    }

    const seq = ++requestSeqRef.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => ({ ...s, loading: true, error: null }));

    let cancelled = false;
    readMessageAtTime(file, bag.format, topicName, timeNs)
      .then((msg) => {
        if (cancelled || seq !== requestSeqRef.current) return;
        setState({ message: msg, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled || seq !== requestSeqRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ ...s, loading: false, error: message }));
      });

    return () => {
      cancelled = true;
    };
  }, [bag, file, topicName, timeNs]);

  return state;
}
