import { useEffect } from 'react';
import { parseCameraInfo, type CameraIntrinsics } from '../../../hooks/useCameraInfo';
import { useMessageAtTime } from '../../../hooks/useMessageAtTime';

/**
 * Hidden helper: read one `sensor_msgs/CameraInfo` topic via
 * `useMessageAtTime` and push the parsed intrinsics into the panel's
 * shared map. One component per topic so we can satisfy rules-of-hooks
 * (hooks called unconditionally per fixed identity) while still
 * supporting an arbitrary number of cameras per bag.
 */
export function CameraInfoFeed({
  topic,
  bagId,
  playheadNs,
  onUpdate,
}: {
  topic: string;
  bagId: string | undefined;
  playheadNs: bigint;
  onUpdate: (topic: string, info: CameraIntrinsics | null) => void;
}) {
  const message = useMessageAtTime(topic, playheadNs, bagId);
  useEffect(() => {
    if (!message.message?.value) {
      onUpdate(topic, null);
      return;
    }
    const info = parseCameraInfo(
      message.message.value,
      message.message.timestamp,
    );
    onUpdate(topic, info);
  }, [topic, message.message, onUpdate]);
  useEffect(() => {
    // Cleanup: drop this topic's entry when the feed unmounts (bag swap).
    return () => onUpdate(topic, null);
  }, [topic, onUpdate]);
  return null;
}

