/**
 * useCustomSchemaSync — push the main-thread `customSchemaStore` into the
 * parser worker, both on app boot (so a refresh with saved schemas in
 * localStorage rehydrates the worker) and on every subsequent change.
 *
 * The worker is the source of truth for *decoding* — its `typeRegistry`
 * holds the parsed `MessageDefinition[]`s and feeds the CDR reader — but
 * the store is the source of truth for *persistence* (localStorage). This
 * hook is what bridges the two.
 *
 * Why a hook rather than the store itself: zustand stores are framework-
 * neutral by design, and putting a worker-RPC side-effect inside the
 * store's setter would couple it to a runtime that can't exist during
 * a test or SSR. Wrapping it in a hook keeps the store pure and makes
 * the sync explicit at the app root.
 *
 * Mount at App.tsx so a single subscription covers the whole session.
 */

import { useEffect, useRef } from 'react';
import { setCustomSchemas } from '../parsers';
import { useCustomSchemaStore } from '../store/customSchemaStore';
import { clearTopicMessageCache } from './useTopicMessages';

export function useCustomSchemaSync(): void {
  const schemas = useCustomSchemaStore((s) => s.schemas);
  // Skip cache clearing on the very first sync — clearing on the initial
  // hydration would invalidate caches that aren't stale, and there's no
  // panel yet anyway. We do still push to the worker so the worker's
  // typeRegistry overrides are populated before any panel reads.
  const isFirstSyncRef = useRef(true);

  useEffect(() => {
    // Fire-and-forget — worker calls are FIFO-ordered, so any decode
    // request queued *after* this `postMessage` will see the new registry.
    void setCustomSchemas(schemas);
    if (isFirstSyncRef.current) {
      isFirstSyncRef.current = false;
      return;
    }
    // A real edit happened (paste / delete / clear) — drop the main-thread
    // decoded-message cache so a panel re-opened on a previously broken
    // topic gets a fresh decode against the new schema instead of the
    // cached `value: null` from before. We don't touch the .db3 sql cache;
    // raw bytes haven't changed.
    clearTopicMessageCache();
  }, [schemas]);
}
