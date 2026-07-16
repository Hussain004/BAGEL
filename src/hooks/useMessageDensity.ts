/**
 * useMessageDensity — aggregate message-count-per-time-bucket across every
 * topic in a bag, for the timeline's density strip.
 *
 * Reuses `readAllMessageStats` (already built for the Bag Health panel and
 * already implemented across mcap/db3/bag) rather than adding any new
 * parser code - the per-topic `times` arrays it returns are exactly what a
 * density histogram needs, just binned instead of shown as a table.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveBagEntry, useBagStore } from '../store/bagStore';
import { getParserClient } from '../workers/parserClient';
import { computeMessageDensity } from '../utils/messageDensity';
import type { AllTopicStats } from '../types/bag';

export function useMessageDensity(bagId?: string): {
  /** Aggregate density across every topic - the timeline's main strip. */
  density: Float32Array | null;
  /**
   * Raw per-topic stats, kept around so callers that need a single
   * topic's density (the per-topic lanes drawer) don't trigger a second
   * readAllMessageStats fetch - the aggregate and the per-topic lanes
   * share one read.
   */
  stats: AllTopicStats | null;
  durationNs: number;
  loading: boolean;
} {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const effectiveBagId = entry?.id ?? null;
  const [density, setDensity] = useState<Float32Array | null>(null);
  const [stats, setStats] = useState<AllTopicStats | null>(null);
  const [loading, setLoading] = useState(false);
  // Guards against a stale response landing after the bag has already
  // changed again (e.g. rapid bag swap) - the same pattern useTopicMessages
  // and useMessageAtTime use for their async reads.
  const requestIdRef = useRef(0);
  const durationNs = entry ? Number(entry.summary.endTime - entry.summary.startTime) : 0;

  useEffect(() => {
    if (!entry || entry.kind === 'live' || !entry.source) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDensity(null);
      setStats(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    const { source, summary } = entry;
    setLoading(true);
    getParserClient(entry.id)
      .readAllMessageStats(source, summary.format)
      .then((result) => {
        if (requestIdRef.current !== requestId) return;
        setStats(result);
        setDensity(computeMessageDensity(result, Number(summary.endTime - summary.startTime)));
      })
      .catch(() => {
        if (requestIdRef.current === requestId) {
          setDensity(null);
          setStats(null);
        }
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBagId]);

  return useMemo(
    () => ({ density, stats, durationNs, loading }),
    [density, stats, durationNs, loading],
  );
}
