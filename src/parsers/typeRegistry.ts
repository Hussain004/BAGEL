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

/**
 * Bundled definitions — laid down on first lookup.
 *
 * NOTE on shape: `@foxglove/rosmsg-msgs-common` stores ONE `MessageDefinition`
 * per type (the entry's `name` field matches the key, and its `definitions`
 * field lists the type's *own* fields). The `MessageReader` we feed it to,
 * on the other hand, wants `MessageDefinition[]` — root first, then every
 * complex dependency. We build that closure in `getMessageDefinition` below
 * and cache it; the registry itself stays in its native single-entry form.
 *
 * (Previous versions of BAGEL force-cast the registry to
 * `Record<string, MessageDefinition[]>` and passed the single entry straight
 * to MessageReader; that silently broke decoding of every nested-type
 * message on `.db3` bags. The bug surfaced when v0.8.1's Raw inspector
 * started showing the underlying error.)
 */
let ros2Definitions: Record<string, MessageDefinition> | null = null;

/**
 * User-supplied schemas. Each entry is the FULL closure produced by
 * `parseMessageDefinition` over the user's pasted `.msg` text (primary
 * type + every `=====`-separated dependency block), so it can be handed
 * to `MessageReader` directly.
 */
const customDefinitions = new Map<string, MessageDefinition[]>();

/**
 * Built-closure cache for bundled types — key is the lookup name, value is
 * the root + every transitively-referenced complex type collected from
 * `ros2Definitions`. Avoids re-walking the dep tree on every decode.
 *
 * `setCustomSchemas` clears this alongside the reader cache: a user might
 * have just overridden a dependency that one of these closures referenced
 * (e.g. they pasted a forked `std_msgs/Header`), so any cached closure
 * built against the previous registry state is potentially stale.
 */
const bundledClosureCache = new Map<string, MessageDefinition[]>();

function loadDefinitions(): Promise<Record<string, MessageDefinition>> {
  if (ros2Definitions) return Promise.resolve(ros2Definitions);
  return import('@foxglove/rosmsg-msgs-common').then((mod) => {
    ros2Definitions = mod.ros2galactic as unknown as Record<string, MessageDefinition>;
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
 * Also invalidates the CDR reader cache and the bundled-closure cache —
 * entries cached against the previous registry state are potentially
 * stale (a user might have just overridden a transitive dependency of
 * a bundled type), and we'd rather rebuild lazily than keep serving
 * pre-edit closures.
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
  bundledClosureCache.clear();
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
 * Get the message definitions needed to decode `typeName` — root first,
 * then every transitively-referenced complex type. Suitable for handing
 * straight to `new MessageReader(...)`.
 *
 * Lookup precedence:
 *   1. Custom user schema (already a full closure from `parseMessageDefinition`).
 *   2. Bundled `ros2galactic` — we walk the root's complex fields and pull
 *      each dependency from the same registry, falling back to custom
 *      overrides for individual fields when a user has shimmed one.
 *
 * Returns `undefined` only when the root itself can't be found anywhere.
 * Missing transitive deps don't return undefined; they're omitted from
 * the closure and the reader fails loudly on the unknown type, which is
 * the more useful failure mode than silently swallowing the decode.
 */
export async function getMessageDefinition(
  typeName: string,
): Promise<MessageDefinition[] | undefined> {
  // Custom schemas first — these are full closures parsed from the user's
  // `.msg` text and can be handed straight to MessageReader.
  for (const alias of aliasesFor(typeName)) {
    const hit = customDefinitions.get(alias);
    if (hit) return hit;
  }

  // Bundled — look the root up, then build the closure.
  const cached = bundledClosureCache.get(typeName);
  if (cached) return cached;

  const defs = await loadDefinitions();
  let root: MessageDefinition | undefined;
  for (const alias of aliasesFor(typeName)) {
    if (defs[alias]) {
      root = defs[alias];
      break;
    }
  }
  if (!root) return undefined;

  const closure = buildClosure(root, defs);
  bundledClosureCache.set(typeName, closure);
  return closure;
}

/**
 * Breadth-first collect every complex type referenced from `root` down,
 * preferring user-supplied custom overrides for individual dependencies
 * (e.g. a user may have shimmed `std_msgs/Header` even though they're
 * decoding a bundled `geometry_msgs/TwistStamped`).
 *
 * Cycles and repeats are de-duped via `visited`. Missing deps are skipped
 * — the resulting closure will be incomplete and `MessageReader` will
 * throw a clear "Unrecognized complex type X" when it tries to descend.
 */
function buildClosure(
  root: MessageDefinition,
  bundled: Record<string, MessageDefinition>,
): MessageDefinition[] {
  const out: MessageDefinition[] = [root];
  // We dedupe by `field.type` (always a string) rather than `def.name`
  // (optional per the spec, though in practice every bundled entry has it).
  // Seeding with root.name when present prevents a self-reference loop on
  // a recursive message type.
  const visited = new Set<string>();
  if (root.name) visited.add(root.name);
  const queue: MessageDefinition[] = [root];
  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    for (const field of cur.definitions) {
      if (!field.isComplex) continue;
      if (visited.has(field.type)) continue;
      visited.add(field.type);

      let dep: MessageDefinition | undefined;
      // Prefer a user override if one exists for this exact field type.
      for (const alias of aliasesFor(field.type)) {
        const customArr = customDefinitions.get(alias);
        if (customArr && customArr.length > 0) {
          dep = customArr[0];
          break;
        }
      }
      // Fall back to the bundled registry.
      if (!dep) {
        for (const alias of aliasesFor(field.type)) {
          if (bundled[alias]) {
            dep = bundled[alias];
            break;
          }
        }
      }
      if (!dep) continue;
      if (dep.name) visited.add(dep.name);
      out.push(dep);
      queue.push(dep);
    }
  }
  return out;
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
