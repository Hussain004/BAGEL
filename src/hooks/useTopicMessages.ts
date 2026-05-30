/**
 * useTopicMessages — Read every deserialized message for a single topic and
 * cache the result keyed by (fileName, fileSize, topicName) so re-opening a
 * panel reuses the prior parse.
 *
 * v0.5.1: streaming. Instead of waiting for the worker to finish decoding the
 * whole topic before showing anything, batches are surfaced as they arrive.
 * The plot fills in left-to-right while the rest of the topic is still being
 * decoded — same UX as image / LiDAR playback, but for time-series.
 *
 * Updates are coalesced through `requestAnimationFrame` so React re-renders
 * at most once per paint regardless of how fast the worker streams batches.
 * The final array is committed to the topic-level cache only after the
 * promise resolves — partial decodes aren't cached so cancelled streams
 * don't poison subsequent panel opens.
 */

import { useEffect, useRef, useState } from 'react';
import { useBagStore } from '../store/bagStore';
import { readDeserializedMessages } from '../parsers';
import { sourceKey } from '../parsers/source';

export interface DecodedMessage {
  timestamp: bigint;
  value: Record<string, unknown> | null;
}

const cache = new Map<string, DecodedMessage[]>();

export interface TopicMessagesState {
  /**
   * All messages decoded so far. Grows in batches as the worker streams.
   * `null` while the first batch hasn't arrived yet; once the first batch
   * lands the panel can start rendering even though `loading` is still true.
   */
  messages: DecodedMessage[] | null;
  loading: boolean;
  /** Approximate decode progress (number of messages decoded so far). */
  progress: number;
  error: string | null;
}

export function useTopicMessages(
  topicName: string,
  limit?: number,
  enabled: boolean = true,
): TopicMessagesState {
  const bag = useBagStore((s) => s.bag);
  const source = useBagStore((s) => s.source);
  const [state, setState] = useState<TopicMessagesState>({
    messages: null,
    loading: true,
    progress: 0,
    error: null,
  });

  // Refs used by the rAF coalescer below. They survive across renders so a
  // batch arriving in the same frame as the previous one doesn't double-
  // schedule the flush, and the in-flight buffer survives the closure.
  const bufferRef = useRef<DecodedMessage[] | null>(null);
  const progressRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!bag || !source || !enabled || !topicName) {
      // Idle state — the caller has either not supplied a bag, opted out via
      // `enabled`, or passed an empty topic name. Suppressing the fetch here
      // is what makes it safe to install this hook conditionally on whether
      // the panel actually wants the topic stream (e.g. the 3D panel only
      // wants it for MarkerArray topics, not for the PointCloud2 / pose
      // cases that have their own per-frame readers).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ messages: null, loading: false, progress: 0, error: null });
      return;
    }

    const cacheKey = `${sourceKey(source)}::${topicName}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      setState({ messages: cached, loading: false, progress: cached.length, error: null });
      return;
    }

    let cancelled = false;
    bufferRef.current = [];
    progressRef.current = 0;
    setState({ messages: null, loading: true, progress: 0, error: null });

    const flush = () => {
      rafRef.current = null;
      if (cancelled || !bufferRef.current) return;
      const next = bufferRef.current;
      // Swap to a fresh buffer for the next coalescing window so batches
      // arriving between this flush and the next paint don't get dropped.
      bufferRef.current = [];
      setState((s) => ({
        ...s,
        // The first flush commits the seed array; later flushes append.
        // Reusing the prior reference would mutate `messages` in-place
        // and break React's structural-equality bailout.
        messages: s.messages ? [...s.messages, ...next] : next,
        progress: progressRef.current,
      }));
    };

    const scheduleFlush = () => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(flush);
    };

    readDeserializedMessages(
      source,
      bag.format,
      topicName,
      limit,
      (decoded) => {
        if (cancelled) return;
        progressRef.current = decoded;
      },
      (batch) => {
        if (cancelled) return;
        bufferRef.current?.push(...batch);
        scheduleFlush();
      },
    )
      .then((msgs) => {
        if (cancelled) return;
        // Final commit: cache the authoritative array (the streamed buffer
        // and `msgs` should match, but the worker's array is the source
        // of truth — picking it avoids a quiet drift if a batch was ever
        // dropped on the wire).
        cache.set(cacheKey, msgs);
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        bufferRef.current = null;
        setState({ messages: msgs, loading: false, progress: msgs.length, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        bufferRef.current = null;
        setState((s) => ({ ...s, loading: false, error: msg }));
      });

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      bufferRef.current = null;
    };
  }, [bag, source, topicName, limit, enabled]);

  return state;
}

/** Drop everything from the message cache (used when the bag changes). */
export function clearTopicMessageCache(): void {
  cache.clear();
}
