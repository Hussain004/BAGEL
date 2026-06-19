/**
 * Message decoder for live Foxglove WebSocket channels.
 *
 * Runs on the main thread (unlike the parser worker's CDR path) because live
 * messages arrive as small binary blobs at ~30 Hz per topic - nowhere near the
 * throughput that warrants off-thread work. All libs here are already bundled
 * as transitive deps so no new packages are required.
 *
 * Supported encoding/schemaEncoding combinations:
 *   cdr  + ros2msg  (ROS2 CDR with 4-byte RTPS encapsulation header)
 *   cdr  + ros1msg  (some bridges use CDR framing with ROS1 schema defs)
 *   ros1 + ros1msg  (ROS1 CDR without RTPS header - standard ROS1 bridge)
 *   json + *        (raw JSON.parse)
 *
 * Protobuf is deferred to v1.6.
 */

import { parse as parseRosMsgDefinition } from '@foxglove/rosmsg';
import { MessageReader as Ros2MessageReader } from '@foxglove/rosmsg2-serialization';
import { MessageReader as Ros1MessageReader } from '@foxglove/rosmsg-serialization';

// Cache readers by schema text so we parse the .msg definition once per unique
// channel type, not once per message. ROS1 and ROS2 caches are separate because
// the readers are not interchangeable: the ROS2 reader strips the 4-byte RTPS
// encapsulation header; the ROS1 reader starts reading message data directly.
const ros2Readers = new Map<string, Ros2MessageReader>();
const ros1Readers = new Map<string, Ros1MessageReader>();

function schemaKey(schema: string): string {
  // Cheap fingerprint: full text for short schemas, prefix+length for long ones.
  return schema.length <= 128 ? schema : `${schema.slice(0, 128)}|${schema.length}`;
}

/**
 * Decode a single live message frame.
 *
 * @param encoding - Channel encoding field (e.g. 'cdr', 'ros1', 'json').
 * @param schemaEncoding - Channel schemaEncoding field (e.g. 'ros2msg', 'ros1msg').
 * @param schema - Channel schema field (raw .msg text for ros2msg/ros1msg).
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
      // ROS2 CDR framing (with 4-byte RTPS encapsulation header).
      // Some bridges advertise ros1msg schema encoding over CDR when the
      // underlying message type is defined in a .msg file - parse accordingly.
      const key = schemaKey(schema);
      let reader = ros2Readers.get(key);
      if (!reader) {
        const isRos2 = schemaEncoding !== 'ros1msg';
        const defs = parseRosMsgDefinition(schema, { ros2: isRos2 });
        reader = new Ros2MessageReader(defs);
        ros2Readers.set(key, reader);
      }
      return reader.readMessage(data) as Record<string, unknown>;
    }

    if (encoding === 'ros1') {
      // ROS1 CDR framing (no RTPS header). Used by ros_foxglove_bridge on ROS1
      // installations. Schema is always ros1msg text.
      const key = schemaKey(schema);
      let reader = ros1Readers.get(key);
      if (!reader) {
        const defs = parseRosMsgDefinition(schema, { ros2: false });
        reader = new Ros1MessageReader(defs);
        ros1Readers.set(key, reader);
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
  ros1Readers.clear();
}
