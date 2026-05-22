/**
 * ROS2 Message Type Registry
 * 
 * Wraps @foxglove/rosmsg-msgs-common to provide pre-built message definitions
 * for standard ROS2 message types. Used by the CDR deserializer to interpret
 * raw message bytes from .db3 files.
 * 
 * For .mcap files, schemas are embedded in the file itself.
 */

import type { MessageDefinition } from '@foxglove/message-definition';

// Import pre-built definitions for ROS2 (Galactic+)
// This covers: std_msgs, geometry_msgs, sensor_msgs, nav_msgs,
// tf2_msgs, builtin_interfaces, rcl_interfaces, unique_identifier_msgs, etc.
let ros2Definitions: Record<string, MessageDefinition[]> | null = null;

/**
 * Lazily load the ROS2 message definitions to avoid bloating initial bundle.
 */
async function loadDefinitions(): Promise<Record<string, MessageDefinition[]>> {
  if (ros2Definitions) return ros2Definitions;
  
  const { ros2galactic } = await import('@foxglove/rosmsg-msgs-common');
  ros2Definitions = ros2galactic as unknown as Record<string, MessageDefinition[]>;
  return ros2Definitions;
}

/**
 * Get the message definition for a given ROS2 message type.
 * 
 * @param typeName - Fully qualified type name, e.g. "sensor_msgs/msg/Imu"
 * @returns MessageDefinition array if found, undefined otherwise
 * 
 * @example
 * const def = await getMessageDefinition('geometry_msgs/msg/Twist');
 * if (def) {
 *   const reader = new MessageReader(def);
 *   const msg = reader.readMessage(data);
 * }
 */
export async function getMessageDefinition(
  typeName: string
): Promise<MessageDefinition[] | undefined> {
  const defs = await loadDefinitions();
  
  // Try exact match first
  if (defs[typeName]) return defs[typeName];
  
  // Try without /msg/ prefix (some formats use "sensor_msgs/Imu" instead of "sensor_msgs/msg/Imu")
  const withoutMsg = typeName.replace('/msg/', '/');
  if (defs[withoutMsg]) return defs[withoutMsg];
  
  // Try with /msg/ inserted
  const parts = typeName.split('/');
  if (parts.length === 2) {
    const withMsg = `${parts[0]}/msg/${parts[1]}`;
    if (defs[withMsg]) return defs[withMsg];
  }
  
  return undefined;
}

/**
 * Check if a message type is supported by the built-in type registry.
 */
export async function isTypeSupported(typeName: string): Promise<boolean> {
  const def = await getMessageDefinition(typeName);
  return def !== undefined;
}

/**
 * Get all supported message type names.
 */
export async function getSupportedTypes(): Promise<string[]> {
  const defs = await loadDefinitions();
  return Object.keys(defs);
}
