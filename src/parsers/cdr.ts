/**
 * CDR (Common Data Representation) Deserialization
 * 
 * Wraps @foxglove/rosmsg2-serialization to automatically deserialize
 * CDR-encoded ROS2 messages into JavaScript objects.
 * 
 * For .mcap files: uses schemas embedded in the file
 * For .db3 files: uses the built-in type registry from @foxglove/rosmsg-msgs-common
 */

import type { MessageDefinition } from '@foxglove/message-definition';
import { parse as parseMessageDefinition } from '@foxglove/rosmsg';
import { MessageReader } from '@foxglove/rosmsg2-serialization';
import { getMessageDefinition } from './typeRegistry';

// Cache MessageReader instances by type name for performance
const readerCache = new Map<string, MessageReader>();

/**
 * Create or retrieve a cached MessageReader for a given message definition.
 */
function getOrCreateReader(key: string, definitions: MessageDefinition[]): MessageReader {
  const cached = readerCache.get(key);
  if (cached) return cached;
  
  const reader = new MessageReader(definitions);
  readerCache.set(key, reader);
  return reader;
}

/**
 * Deserialize a CDR-encoded message using a pre-parsed schema.
 * Used primarily for .mcap files where schemas are embedded.
 * 
 * @param schemaText - Raw schema text (ROS2 message definition format)
 * @param data - CDR-encoded message bytes
 * @returns Deserialized JavaScript object
 */
export function deserializeWithSchema(
  schemaText: string,
  data: Uint8Array
): Record<string, unknown> {
  const definitions = parseMessageDefinition(schemaText, { ros2: true });
  const reader = getOrCreateReader(`schema:${schemaText.slice(0, 100)}`, definitions);
  return reader.readMessage(data) as Record<string, unknown>;
}

/**
 * Deserialize a CDR-encoded message using the built-in type registry.
 * Used primarily for .db3 files where schemas are not embedded.
 * 
 * @param msgType - Fully qualified ROS2 message type (e.g. "sensor_msgs/msg/Imu")
 * @param data - CDR-encoded message bytes
 * @returns Deserialized JavaScript object, or null if type is not supported
 */
export async function deserializeByType(
  msgType: string,
  data: Uint8Array
): Promise<Record<string, unknown> | null> {
  const definitions = await getMessageDefinition(msgType);
  if (!definitions) return null;
  
  const reader = getOrCreateReader(`type:${msgType}`, definitions);
  return reader.readMessage(data) as Record<string, unknown>;
}

/**
 * Clear the reader cache (useful for memory management with large bags)
 */
export function clearReaderCache(): void {
  readerCache.clear();
}
