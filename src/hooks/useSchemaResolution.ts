/**
 * useSchemaResolution — answers "does BAGEL know how to decode this topic?"
 *
 * Schema availability depends on the bag format:
 *
 *   - `.mcap` and `.bag` (ROS1) embed schemas inside the file itself. Every
 *      topic resolves regardless of what the bundled type registry knows.
 *      The hook short-circuits to `{ resolved: true }` for these formats.
 *
 *   - `.db3` (ROS2 SQLite) does *not* embed schemas. A topic resolves only
 *      when its type name appears in either the bundled `ros2galactic` set
 *      (fetched lazily from the worker) or the user's custom-schema store
 *      (a localStorage map populated via the paste modal).
 *
 * The bundled supported-types list is fetched once per page session and
 * cached at module level — it's ~150 strings, never changes for the
 * session, and doesn't justify a per-mount round-trip. The hook returns
 * `{ resolved: true, loading: true }` (optimistic) while that first fetch
 * is in flight so the sidebar doesn't flash a "schema missing" badge on
 * every topic during boot.
 */

import { useEffect, useState } from 'react';
import { getSupportedTypes } from '../parsers';
import { useCustomSchemaStore } from '../store/customSchemaStore';
import type { BagFormat } from '../types/bag';

export interface SchemaResolution {
  /** True when the topic's type is decodable (bundled, custom, or embedded). */
  resolved: boolean;
  /** True while the bundled-types list is being fetched on first use. */
  loading: boolean;
}

let supportedTypesCache: Set<string> | null = null;
let supportedTypesPromise: Promise<Set<string>> | null = null;

function aliasesFor(typeName: string): string[] {
  if (!typeName) return [];
  const out = [typeName];
  if (typeName.includes('/msg/')) {
    out.push(typeName.replace('/msg/', '/'));
  } else {
    const parts = typeName.split('/');
    if (parts.length === 2) out.push(`${parts[0]}/msg/${parts[1]}`);
  }
  return out;
}

function fetchSupportedTypes(): Promise<Set<string>> {
  if (supportedTypesCache) return Promise.resolve(supportedTypesCache);
  if (supportedTypesPromise) return supportedTypesPromise;
  supportedTypesPromise = getSupportedTypes().then((arr) => {
    // Index every alias so an `endsWith('/Type')` topic-tag finds its
    // registry entry whether the registry stores `pkg/Type` or `pkg/msg/Type`.
    const set = new Set<string>();
    for (const name of arr) {
      for (const alias of aliasesFor(name)) set.add(alias);
    }
    supportedTypesCache = set;
    return set;
  });
  return supportedTypesPromise;
}

export function useSchemaResolution(
  typeName: string,
  format: BagFormat | undefined,
): SchemaResolution {
  // Subscribe to the custom-schema map so add/delete drives a re-render.
  const customSchemas = useCustomSchemaStore((s) => s.schemas);

  const [supportedTypes, setSupportedTypes] = useState<Set<string> | null>(
    supportedTypesCache,
  );
  useEffect(() => {
    if (supportedTypes) return;
    let cancelled = false;
    void fetchSupportedTypes().then((set) => {
      if (!cancelled) setSupportedTypes(set);
    });
    return () => {
      cancelled = true;
    };
  }, [supportedTypes]);

  // mcap + bag always embed schemas. .db3 is the only format that needs
  // external help; anything else is decodable by construction.
  if (format !== 'db3') {
    return { resolved: true, loading: false };
  }

  // Custom user schemas take priority — same precedence the worker uses.
  for (const alias of aliasesFor(typeName)) {
    if (customSchemas[alias] !== undefined) {
      return { resolved: true, loading: false };
    }
  }
  // Still fetching the bundled list — assume resolved so we don't flash.
  if (!supportedTypes) return { resolved: true, loading: true };
  for (const alias of aliasesFor(typeName)) {
    if (supportedTypes.has(alias)) return { resolved: true, loading: false };
  }
  return { resolved: false, loading: false };
}
