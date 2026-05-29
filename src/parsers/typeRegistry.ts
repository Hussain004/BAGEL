/**
 * ROS2 Message Type Registry
 *
 * Two-layer lookup keyed by type name:
 *
 *   1. **Custom overrides** — user-supplied `.msg` schemas the main thread
 *      has pushed into the worker via `setCustomSchemas`. These take
 *      priority so a user can override even a bundled definition (e.g. to
 *      shim a vendor fork of a stock package). Persisted in localStorage
 *      on the main thread; the worker only holds the parsed form.
 *
 *   2. **Bundled `ros2galactic`** — pre-built `MessageDefinition[]`s for the
 *      standard ROS2 packages (std_msgs, geometry_msgs, sensor_msgs,
 *      nav_msgs, tf2_msgs, visualization_msgs, builtin_interfaces,
 *      rcl_interfaces, …). Lazily imported on first lookup so the worker
 *      chunk doesn't pay for it on a pure-MCAP session.
 *
 * `.mcap` and ROS1 `.bag` files supply their own schemas inside the file,
 * so this registry only matters for `.db3` bags — but the override layer
 * works for any format, so a user can paste a corrected schema if a bag
 * is mis-tagged.
 */

import type { MessageDefinition } from '@foxglove/message-definition';
import { parse as parseMessageDefinition } from '@foxglove/rosmsg';
import { clearReaderCache } from './cdr';

// Bundled definitions — laid down on first lookup.
let ros2Definitions: Record<string, MessageDefinition[]> | null = null;

/**
 * User-supplied schemas. Keys are the type names as the user typed them
 * (e.g. `px4_msgs/msg/VehicleLocalPosition`); we also normalise to the
 * `pkg/Type` form for lookups so callers using either string find the
 * same entry.
 */
const customDefinitions = new Map<string, MessageDefinition[]>();

function loadDefinitions(): Promise<Record<string, MessageDefinition[]>> {
  if (ros2Definitions) return Promise.resolve(ros2Definitions);
  return import('@foxglove/rosmsg-msgs-common').then((mod) => {
    ros2Definitions = mod.ros2galactic as unknown as Record<string, MessageDefinition[]>;
    return ros2Definitions;
  });
}

/** Returns every key form we recognise for a given type name. */
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

/**
 * Replace the entire custom-schema map with `schemas` (raw `.msg` text,
 * keyed by type name). Parses each entry up-front so subsequent decode
 * calls hit a ready MessageDefinition[] rather than re-parsing. Invalid
 * entries are skipped with a console warning and don't poison the rest.
 *
 * Also invalidates the CDR reader cache — entries cached against the old
 * (possibly missing or stale) definition would otherwise keep returning
 * garbage / null until the worker restarts.
 */
export function setCustomSchemas(schemas: Record<string, string>): void {
  customDefinitions.clear();
  for (const [typeName, text] of Object.entries(schemas)) {
    if (typeof text !== 'string' || text.trim().length === 0) continue;
    try {
      const parsed = parseMessageDefinition(text, { ros2: true });
      // Index under every alias of the user-supplied name so a topic typed
      // as `px4_msgs/msg/X` finds a schema saved as `px4_msgs/X` and vice
      // versa.
      for (const alias of aliasesFor(typeName)) {
        customDefinitions.set(alias, parsed);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[typeRegistry] failed to parse custom schema for ${typeName}: ${message}`);
    }
  }
  // Drop cached readers so any topic that was previously failing to decode
  // (or decoding against an outdated schema) gets a fresh reader on next read.
  clearReaderCache();
}

/**
 * Parse `text` as a ROS2 `.msg` schema *without* mutating the custom map.
 * Used by the worker's `validateSchema` RPC so the paste modal can show a
 * useful error before the user commits.
 */
export function validateSchemaText(text: string): { ok: true } | { ok: false; error: string } {
  try {
    parseMessageDefinition(text, { ros2: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Get the message definition for a given ROS2 message type, preferring
 * user-supplied custom schemas over the bundled ones.
 */
export async function getMessageDefinition(
  typeName: string,
): Promise<MessageDefinition[] | undefined> {
  // Custom schemas first — the override semantic is the entire point.
  for (const alias of aliasesFor(typeName)) {
    const hit = customDefinitions.get(alias);
    if (hit) return hit;
  }
  const defs = await loadDefinitions();
  for (const alias of aliasesFor(typeName)) {
    if (defs[alias]) return defs[alias];
  }
  return undefined;
}

/**
 * Check if a message type is supported by either the bundled registry or
 * the current custom-schema overrides.
 */
export async function isTypeSupported(typeName: string): Promise<boolean> {
  const def = await getMessageDefinition(typeName);
  return def !== undefined;
}

/**
 * Every type name the bundled registry knows about. The main thread uses
 * this on app load (one round-trip) to decide which `.db3` topics need a
 * "schema missing" affordance without having to round-trip per-topic.
 *
 * Custom-schema names aren't included here — the main thread already knows
 * them (it owns the localStorage source of truth).
 */
export async function getSupportedTypes(): Promise<string[]> {
  const defs = await loadDefinitions();
  return Object.keys(defs);
}
