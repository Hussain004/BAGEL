/**
 * Message decoder for live Foxglove WebSocket channels.
 *
 * Runs on the main thread (unlike the parser worker's CDR path) because live
 * messages arrive as small binary blobs at ~30 Hz per topic - nowhere near the
 * throughput that warrants off-thread work. All libs here are already bundled
 * as transitive deps so no new packages are required.
 *
 * Supported encoding/schemaEncoding combinations:
 *   cdr  + ros2msg  (ROS2 CDR via @foxglove/rosmsg2-serialization)
 *   json + *        (raw JSON.parse)
 *
 * ROS1 wire format (ros1 + ros1msg) is deferred to v1.5.1.
 * Protobuf is deferred to v1.6.
 */

import { parse as parseRosMsgDefinition } from '@foxglove/rosmsg';
import { MessageReader } from '@foxglove/rosmsg2-serialization';

// Cache MessageReader by schema fingerprint so we parse the .msg definition
// once per unique channel type, not once per message.
const ros2Readers = new Map<string, MessageReader>();

function schemaKey(schema: string): string {
  // Cheap fingerprint: full text for short schemas, prefix+length for long ones.
  return schema.length <= 128 ? schema : `${schema.slice(0, 128)}|${schema.length}`;
}

/**
 * Decode a single live message frame.
 *
 * @param encoding - Channel encoding field (e.g. 'cdr', 'json').
 * @param schemaEncoding - Channel schemaEncoding field (e.g. 'ros2msg').
 * @param schema - Channel schema field (raw .msg text for ros2msg).
 * @param data - Raw message bytes from the Foxglove server.
 * @returns Decoded JS object, or null on unsupported/malformed input.
 */
export function decodeLiveMessage(
  encoding: string,
  schemaEncoding: string | undefined,
  schema: string,
  data: Uint8Array,
): Record<string, unknown> | null {
  try {
    if (encoding === 'json') {
      const text = new TextDecoder().decode(data);
      return JSON.parse(text) as Record<string, unknown>;
    }

    if (encoding === 'cdr') {
      const key = schemaKey(schema);
      let reader = ros2Readers.get(key);
      if (!reader) {
        const isRos2 = schemaEncoding !== 'ros1msg';
        const defs = parseRosMsgDefinition(schema, { ros2: isRos2 });
        reader = new MessageReader(defs);
        ros2Readers.set(key, reader);
      }
      return reader.readMessage(data) as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

/** Drop cached readers (e.g. on app teardown or for testing). */
export function clearLiveDecoderCache(): void {
  ros2Readers.clear();
}
