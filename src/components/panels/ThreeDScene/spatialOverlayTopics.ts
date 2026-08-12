import type { TopicInfo } from '../../../types/bag';
import {
  is3DCapableType,
  isMarkerArrayType,
  isMarkerType,
} from '../../../utils/messages';
export interface SpatialOverlayTopic {
  name: string;
  type: string;
}

/**
 * Returns topics that can be composed by the lightweight spatial-layer
 * renderer. Marker streams keep historical lifecycle state and remain
 * available as primary 3D panels.
 */
export function getSpatialOverlayCandidates(
  topics: TopicInfo[],
  primaryTopic: string,
): SpatialOverlayTopic[] {
  return topics
    .filter(
      (topic) =>
        topic.messageCount > 0 &&
        topic.name !== primaryTopic &&
        is3DCapableType(topic.type) &&
        !isMarkerArrayType(topic.type) &&
        !isMarkerType(topic.type),
    )
    .map((topic) => ({ name: topic.name, type: topic.type }));
}
