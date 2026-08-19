import type { TopicInfo } from '../../../types/bag';
import {
  is3DCapableType,
  isMarkerArrayType,
  isMarkerType,
} from '../../../utils/messages';
export interface SpatialOverlayTopic {
  /** Which loaded bag this candidate's messages come from (multi-bag overlay). */
  bagId: string;
  name: string;
  type: string;
}

export interface OverlayBagTopics {
  bagId: string;
  topics: TopicInfo[];
}

/**
 * Returns topics that can be composed by the lightweight spatial-layer
 * renderer, drawn from every loaded bag (not just the panel's own). Marker
 * streams keep historical lifecycle state and remain available as primary 3D
 * panels.
 */
export function getSpatialOverlayCandidates(
  bags: OverlayBagTopics[],
  primaryBagId: string,
  primaryTopic: string,
): SpatialOverlayTopic[] {
  const out: SpatialOverlayTopic[] = [];
  for (const { bagId, topics } of bags) {
    for (const topic of topics) {
      if (
        topic.messageCount > 0 &&
        !(bagId === primaryBagId && topic.name === primaryTopic) &&
        is3DCapableType(topic.type) &&
        !isMarkerArrayType(topic.type) &&
        !isMarkerType(topic.type)
      ) {
        out.push({ bagId, name: topic.name, type: topic.type });
      }
    }
  }
  return out;
}

/**
 * Encode a (bagId, topic) pair into the single string key used by
 * `spatialOverlayTopics` / `spatialOverlayStyles` selection state. Topic
 * names always start with "/" and bagIds (`b1`, `b2`, ...) never contain
 * one, so a plain concatenation round-trips losslessly.
 */
export function overlayKey(bagId: string, topicName: string): string {
  return `${bagId}${topicName}`;
}
