/**
 * useMessageDensity — aggregate message-count-per-time-bucket across every
 * topic in a bag, for the timeline's density strip.
 *
 * Reuses `readAllMessageStats` (already built for the Bag Health panel and
 * already implemented across mcap/db3/bag) rather than adding any new
 * parser code - the per-topic `times` arrays it returns are exactly what a
 * density histogram needs, just binned instead of shown as a table.
 */
import { useEffect, useRef, useState } from 'react';
import { resolveBagEntry, useBagStore } from '../store/bagStore';
import { getParserClient } from '../workers/parserClient';
import { computeMessageDensity } from '../utils/messageDensity';

export function useMessageDensity(bagId?: string): {
  density: Float32Array | null;
  loading: boolean;
} {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const effectiveBagId = entry?.id ?? null;
  const [density, setDensity] = useState<Float32Array | null>(null);
  const [loading, setLoading] = useState(false);
  // Guards against a stale response landing after the bag has already
  // changed again (e.g. rapid bag swap) - the same pattern useTopicMessages
  // and useMessageAtTime use for their async reads.
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!entry || entry.kind === 'live' || !entry.source) {
      setDensity(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestIdRef.current;
    const { source, summary } = entry;
    setLoading(true);
    getParserClient(entry.id)
      .readAllMessageStats(source, summary.format)
      .then((stats) => {
        if (requestIdRef.current !== requestId) return;
        const durationNs = Number(summary.endTime - summary.startTime);
        setDensity(computeMessageDensity(stats, durationNs));
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setDensity(null);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBagId]);

  return { density, loading };
}
