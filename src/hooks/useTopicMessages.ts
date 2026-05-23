/**
 * useTopicMessages — Read every deserialized message for a single topic and
 * cache the result keyed by (fileName, fileSize, topicName) so re-opening a
 * panel reuses the prior parse.
 *
 * For very large topics (point clouds with millions of points, hour-long
 * image streams) you should switch to a windowed reader; for v0.2 we load
 * everything up front. A `limit` parameter exposes a guard rail.
 */

import { useEffect, useState } from 'react';
import { useBagStore } from '../store/bagStore';
import { readDeserializedMessages } from '../parsers';

export interface DecodedMessage {
  timestamp: bigint;
  value: Record<string, unknown> | null;
}

interface CacheKey {
  fileName: string;
  fileSize: number;
  topicName: string;
}

const cache = new Map<string, DecodedMessage[]>();

function keyOf(k: CacheKey): string {
  return `${k.fileName}::${k.fileSize}::${k.topicName}`;
}

export interface TopicMessagesState {
  messages: DecodedMessage[] | null;
  loading: boolean;
  error: string | null;
}

export function useTopicMessages(topicName: string, limit?: number): TopicMessagesState {
  const bag = useBagStore((s) => s.bag);
  const file = useBagStore((s) => s.file);
  const [state, setState] = useState<TopicMessagesState>({
    messages: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    if (!bag || !file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ messages: null, loading: false, error: null });
      return;
    }

    const cacheKey = keyOf({
      fileName: file.name,
      fileSize: file.size,
      topicName,
    });
    const cached = cache.get(cacheKey);
    if (cached) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ messages: cached, loading: false, error: null });
      return;
    }

    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ messages: null, loading: true, error: null });

    readDeserializedMessages(file, bag.format, topicName, limit)
      .then((msgs) => {
        if (cancelled) return;
        cache.set(cacheKey, msgs);
        setState({ messages: msgs, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setState({ messages: null, loading: false, error: msg });
      });

    return () => {
      cancelled = true;
    };
  }, [bag, file, topicName, limit]);

  return state;
}

/** Drop everything from the message cache (used when the bag changes). */
export function clearTopicMessageCache(): void {
  cache.clear();
}
