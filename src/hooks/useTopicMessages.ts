/**
 * useTopicMessages — Read every deserialized message for a single topic and
 * cache the result keyed by (bagId, source, topicName) so re-opening a panel
 * reuses the prior parse.
 *
 * v0.5.1: streaming. Instead of waiting for the worker to finish decoding the
 * whole topic before showing anything, batches are surfaced as they arrive.
 * The plot fills in left-to-right while the rest of the topic is still being
 * decoded — same UX as image / LiDAR playback, but for time-series.
 *
 * Updates are coalesced through `requestAnimationFrame` so React re-renders
 * at most once per paint regardless of how fast the worker streams batches.
 *
 * v0.9.x: decodes are shared across React mount cycles. The parser worker
 * can't be cancelled, so when a panel unmounts during a layout rearrange
 * the underlying decode keeps running. Without this sharing, the cleanup
 * would discard the partial buffer and a remount would kick off a *second*
 * decode for the same (source, topic) pair — observable on /tf with 100k
 * messages as a full re-decode every time a sibling panel is added or
 * removed. Now: an `InFlightDecode` entry is keyed by (source, topic) and
 * any new subscriber attaches to the same buffer, gets a replay of what's
 * arrived so far, and finalises when the underlying decode does. The cache
 * write happens unconditionally on completion regardless of whether any
 * particular React listener is still attached.
 *
 * v0.9 multi-bag: callers pass a `bagId` to read from a specific bag. When
 * omitted, the hook falls back to the focused bag (back-compat path for
 * existing single-bag panels).
 */

import { useEffect, useRef, useState } from 'react';
import { useBagStore, resolveBagEntry } from '../store/bagStore';
import { useLiveStore } from '../store/liveStore';
import { readDeserializedMessages } from '../parsers';
import { sourceKey } from '../parsers/source';

export interface DecodedMessage {
  timestamp: bigint;
  value: Record<string, unknown> | null;
}

const cache = new Map<string, DecodedMessage[]>();

interface InFlightDecode {
  /** Everything decoded so far. Subscribers replay this on attach. */
  buffer: DecodedMessage[];
  /** Final message count reported by the worker's progress callback. */
  progress: number;
  /** Each attached subscriber gets a callback per arrival of new batches. */
  listeners: Set<InFlightListener>;
  /** Resolved when the decode completes; null if still running. */
  completed: { result: DecodedMessage[] } | { error: string } | null;
}

interface InFlightListener {
  onBatch: (batch: DecodedMessage[]) => void;
  onProgress: (progress: number) => void;
  onComplete: (result: { result: DecodedMessage[] } | { error: string }) => void;
}

const inFlight = new Map<string, InFlightDecode>();

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
  bagId?: string,
): TopicMessagesState {
  // Resolve the bag entry on every render — the resolveBagEntry helper picks
  // the explicit bagId when supplied, falling back to the focused bag.
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));

  // Subscribe to the live revision counter so we re-render on new messages.
  const liveRevision = useLiveStore((s) =>
    entry?.kind === 'live' ? (s.revisions.get(entry.id) ?? 0) : 0,
  );

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
  const liveRafRef = useRef<number | null>(null);

  // ── Live path: read from ring buffer, coalesced to one rAF per revision bump.
  useEffect(() => {
    if (!entry || !enabled || !topicName || entry.kind !== 'live' || !entry.liveConn) return;

    const flush = () => {
      liveRafRef.current = null;
      const msgs: DecodedMessage[] = entry.liveConn!.ringBuffer
        .getMessages(topicName)
        .map((m) => ({ timestamp: m.timeNs, value: m.value }));
      setState({ messages: msgs, loading: false, progress: msgs.length, error: null });
    };

    if (liveRafRef.current !== null) cancelAnimationFrame(liveRafRef.current);
    liveRafRef.current = requestAnimationFrame(flush);

    return () => {
      if (liveRafRef.current !== null) {
        cancelAnimationFrame(liveRafRef.current);
        liveRafRef.current = null;
      }
    };
  }, [entry, topicName, enabled, liveRevision]);

  // ── File / URL path (existing async worker decode).
  useEffect(() => {
    if (!entry || !enabled || !topicName) {
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
    // Live bags are handled by the effect above.
    if (entry.kind === 'live' || !entry.source) return;

    const { id: workerBagId, summary: bag, source } = entry;
    const cacheKey = `${workerBagId}::${sourceKey(source)}::${topicName}::${limit ?? 'all'}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      setState({ messages: cached, loading: false, progress: cached.length, error: null });
      return;
    }

    let detached = false;
    bufferRef.current = [];
    progressRef.current = 0;
    setState({ messages: null, loading: true, progress: 0, error: null });

    const flush = () => {
      rafRef.current = null;
      if (detached || !bufferRef.current) return;
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

    const listener: InFlightListener = {
      onBatch: (batch) => {
        if (detached) return;
        bufferRef.current?.push(...batch);
        scheduleFlush();
      },
      onProgress: (p) => {
        if (detached) return;
        progressRef.current = p;
      },
      onComplete: (final) => {
        if (detached) return;
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        bufferRef.current = null;
        if ('error' in final) {
          setState((s) => ({ ...s, loading: false, error: final.error }));
        } else {
          setState({
            messages: final.result,
            loading: false,
            progress: final.result.length,
            error: null,
          });
        }
      },
    };

    const existing = inFlight.get(cacheKey);
    if (existing) {
      // Replay everything that's already been decoded — a new subscriber
      // sees the partial buffer instantly, then matches subsequent batches
      // tick-by-tick with everyone else.
      if (existing.buffer.length > 0) {
        bufferRef.current?.push(...existing.buffer);
        progressRef.current = existing.progress;
        scheduleFlush();
      }
      if (existing.completed) {
        listener.onComplete(existing.completed);
      } else {
        existing.listeners.add(listener);
      }
    } else {
      const newEntry: InFlightDecode = {
        buffer: [],
        progress: 0,
        listeners: new Set([listener]),
        completed: null,
      };
      inFlight.set(cacheKey, newEntry);

      readDeserializedMessages(
        workerBagId,
        source,
        bag.format,
        topicName,
        limit,
        (decoded) => {
          newEntry.progress = decoded;
          for (const l of newEntry.listeners) l.onProgress(decoded);
        },
        (batch) => {
          newEntry.buffer.push(...batch);
          for (const l of newEntry.listeners) l.onBatch(batch);
        },
      )
        .then((msgs) => {
          // The worker's array is the source of truth — picking it (instead
          // of the locally-accumulated buffer) avoids any drift if a batch
          // were ever dropped on the wire.
          cache.set(cacheKey, msgs);
          const final = { result: msgs };
          newEntry.completed = final;
          for (const l of newEntry.listeners) l.onComplete(final);
          newEntry.listeners.clear();
          inFlight.delete(cacheKey);
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          const final = { error: msg };
          newEntry.completed = final;
          for (const l of newEntry.listeners) l.onComplete(final);
          newEntry.listeners.clear();
          inFlight.delete(cacheKey);
        });
    }

    return () => {
      detached = true;
      // Detach this React listener but leave the underlying decode running.
      // The cache will still be populated on completion so the next mount
      // for the same (source, topic) gets it for free.
      const entry = inFlight.get(cacheKey);
      entry?.listeners.delete(listener);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      bufferRef.current = null;
    };
  }, [entry, topicName, limit, enabled]);

  return state;
}

/** Drop everything from the message cache (used when bags change). */
export function clearTopicMessageCache(): void {
  cache.clear();
  // Orphan any in-flight decodes — their cache writes will land under keys
  // that will never be queried again, but the listeners are gone so no UI
  // state will be touched. Memory is reclaimed when the worker promise
  // resolves and the closure drops.
  for (const entry of inFlight.values()) entry.listeners.clear();
  inFlight.clear();
}
