/**
 * useBagLocalPlayhead — Translate the global aligned-time playhead into a
 * specific bag's local time so per-bag readers (useMessageAtTime,
 * useDecodedCloud, lookupTransform) can seek to the right sample.
 *
 * Under `wall-clock` alignment (the default and only sensible mode for a
 * single bag) this is a no-op: aligned = bag-local. Under `bag-start` or
 * `anchor` modes, the result is offset by the entry's alignment offset.
 *
 * Most panels call this once and pass the result to every time-using hook.
 * The translation is bigint math — cheap enough that we don't memoize.
 */
import {
  alignmentOffsetFor,
  resolveBagEntry,
  useBagStore,
} from '../store/bagStore';
import { usePlayheadStore } from '../store/playheadStore';

export function useBagLocalPlayhead(bagId?: string): bigint {
  const playheadNs = usePlayheadStore((s) => s.timeNs);
  const offsetNs = useBagStore((s) => {
    const entry = resolveBagEntry(s, bagId);
    if (!entry) return 0n;
    return alignmentOffsetFor(entry, s.alignment);
  });
  return playheadNs + offsetNs;
}
