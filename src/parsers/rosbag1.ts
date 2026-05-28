/**
 * ROS1 Wire Format Deserialization
 *
 * Sibling to `cdr.ts`: where that one decodes CDR-encoded ROS2 messages via
 * `@foxglove/rosmsg2-serialization`, this one decodes ROS1's little-endian
 * binary format via `@foxglove/rosmsg-serialization`.
 *
 * ROS1 `.bag` files embed each topic's full message definition (the primary
 * `.msg` text plus every dependency block, separated by `=====`) inside the
 * connection record's `messageDefinition` field. The MessageReader parses
 * that text once and is reused for every message on the topic.
 *
 * Field-name normalization
 * ------------------------
 * The rest of BAGEL assumes ROS2 conventions: timestamps surface as
 * `{ sec, nanosec }` (see `useTFGraph.ts:stampNs`). ROS1's `time` and
 * `duration` primitives deserialize as `{ sec, nsec }`. We walk every
 * decoded message once and add a `nanosec` alias on any `{ sec, nsec }`
 * pair so panel code that reads `stamp.nanosec` keeps working without
 * caring about the source bag version.
 */

import type { MessageDefinition } from '@foxglove/message-definition';
import { parse as parseMessageDefinition } from '@foxglove/rosmsg';
import { MessageReader } from '@foxglove/rosmsg-serialization';

const readerCache = new Map<string, MessageReader>();

function getOrCreateReader(key: string, definitions: MessageDefinition[]): MessageReader {
  const cached = readerCache.get(key);
  if (cached) return cached;
  const reader = new MessageReader(definitions);
  readerCache.set(key, reader);
  return reader;
}

/**
 * Recursively add a `nanosec` field alongside `nsec` on every time-like
 * object inside `value`. Mutates in place and skips typed arrays.
 *
 * A time-like object is one whose first two enumerable keys are exactly
 * `sec` (number) and `nsec` (number) — matching ROS1's `time` / `duration`
 * primitives as decoded by `@foxglove/rosmsg-serialization`. We avoid
 * walking `Uint8Array` / `Float32Array` payloads, which are common in
 * sensor messages and would otherwise dominate the cost.
 */
function normalizeRos1Timestamps(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  if (ArrayBuffer.isView(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) normalizeRos1Timestamps(item);
    return;
  }
  const obj = value as Record<string, unknown>;
  // Detect ROS1 time/duration shape — both fields present and numeric.
  if (
    typeof obj.sec === 'number' &&
    typeof obj.nsec === 'number' &&
    obj.nanosec === undefined
  ) {
    obj.nanosec = obj.nsec;
  }
  for (const k in obj) {
    const v = obj[k];
    if (v !== null && typeof v === 'object') normalizeRos1Timestamps(v);
  }
}

/**
 * Deserialize a ROS1-encoded message using its concatenated `.msg` text.
 *
 * @param schemaText - The connection record's `messageDefinition` (primary
 *                     type + dependencies separated by `=====` lines).
 * @param data - Raw ROS1 wire-format bytes from the bag.
 * @param cacheKey - Stable key for caching the MessageReader. Falls back to
 *                   a slice of the schema text — collisions only happen for
 *                   topics whose first ~100 chars of definition match
 *                   exactly, which is unlikely in practice.
 * @returns Deserialized JavaScript object with `nanosec` aliases added on
 *          every embedded time field.
 */
export function deserializeRos1Message(
  schemaText: string,
  data: Uint8Array,
  cacheKey?: string,
): Record<string, unknown> {
  const key = cacheKey ?? `ros1:${schemaText.slice(0, 100)}`;
  let reader = readerCache.get(key);
  if (!reader) {
    const definitions = parseMessageDefinition(schemaText, { ros2: false });
    reader = getOrCreateReader(key, definitions);
  }
  const value = reader.readMessage(data) as Record<string, unknown>;
  normalizeRos1Timestamps(value);
  return value;
}

/** Forget every cached ROS1 MessageReader. Called when the active bag changes. */
export function clearRos1ReaderCache(): void {
  readerCache.clear();
}
