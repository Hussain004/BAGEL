/**
 * useJointStates - v1.3.0
 *
 * Read `sensor_msgs/JointState` at the playhead and surface a
 * `Map<jointName, position>` the robot-model renderer can apply to its
 * subtree. Returns an empty map when no joint-state topic is present so
 * static URDFs still render at their URDF rest pose.
 *
 * Topic auto-detect:
 *   - First match on type `sensor_msgs/JointState` or
 *     `sensor_msgs/msg/JointState` (handles both `.mcap`/`.bag` and `.db3`
 *     naming conventions). Falls back to the conventional name `/joint_states`
 *     if no message-type match is found.
 *   - Only one joint-state topic is consumed; bags with multiple usually
 *     publish one canonical stream plus diagnostics-style derivatives that
 *     we don't need here.
 *
 * The read goes through `useMessageAtTime`, which already collapses rapid
 * playhead ticks onto the latest target - matches the rest of the panel's
 * read pattern and keeps the worker honest during playback.
 */

import { useMemo } from 'react';
import { useBagStore, resolveBagEntry } from '../store/bagStore';
import { useMessageAtTime } from './useMessageAtTime';

const JOINT_STATE_TYPES = new Set([
  'sensor_msgs/JointState',
  'sensor_msgs/msg/JointState',
]);

const FALLBACK_TOPIC_NAMES = ['/joint_states', 'joint_states'];

export interface UseJointStatesResult {
  /** `jointName -> position`. Empty when no JointState is available. */
  positions: Map<string, number>;
  /** Timestamp of the message the positions came from, or null. */
  timestamp: bigint | null;
  /** True iff a JointState topic exists in the resolved bag. */
  hasTopic: boolean;
}

export function useJointStates(
  bagId: string | undefined,
  playheadNs: bigint,
): UseJointStatesResult {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));

  // Pick the topic name. Memoized so the underlying `useMessageAtTime`
  // doesn't restart its session every render. Empty-string sentinel keeps
  // the hook idle when the bag has no joint-state topic at all.
  const topicName = useMemo(() => {
    if (!entry) return '';
    const matched = entry.summary.topics.find((t) => JOINT_STATE_TYPES.has(t.type));
    if (matched) return matched.name;
    const conventional = entry.summary.topics.find((t) =>
      FALLBACK_TOPIC_NAMES.includes(t.name),
    );
    return conventional?.name ?? '';
  }, [entry]);

  const message = useMessageAtTime(topicName || '', playheadNs, bagId);

  return useMemo<UseJointStatesResult>(() => {
    if (!topicName) return { positions: new Map(), timestamp: null, hasTopic: false };
    const value = message.message?.value;
    if (!value) return { positions: new Map(), timestamp: null, hasTopic: true };
    const names = value.name as unknown;
    const positions = value.position as unknown;
    const out = new Map<string, number>();
    if (Array.isArray(names) && Array.isArray(positions)) {
      const n = Math.min(names.length, positions.length);
      for (let i = 0; i < n; i++) {
        const name = String(names[i] ?? '');
        const pos = Number(positions[i]);
        if (name && Number.isFinite(pos)) out.set(name, pos);
      }
    }
    return {
      positions: out,
      timestamp: message.message?.timestamp ?? null,
      hasTopic: true,
    };
  }, [topicName, message.message]);
}
