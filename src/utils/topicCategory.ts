/**
 * Topic category chips for the sidebar.
 *
 * Built from the same `is*Type` detectors the rest of the app uses, so a topic
 * the app can visualise never lands in "Other" while the app would happily
 * render it. The categories answer the question a new user asks of an
 * unfamiliar bag: "what is actually in here?" - four cameras and a dead lidar
 * namespace reads better as chips than as 200 rows.
 */

import type { TopicInfo } from '../types/bag';
import {
  isCameraInfoType,
  isCloudType,
  isDiagnosticArrayType,
  isImageType,
  isLaserScanType,
  isLogType,
  isMarkerArrayType,
  isMarkerType,
  isOccupancyGridType,
  isSplatType,
  isTfTopic,
  isTrajectoryCapableType,
  isVideoType,
} from './messages';

export interface TopicCategory {
  id: string;
  /** Chip label. */
  label: string;
  matches: (topic: TopicInfo) => boolean;
}

/**
 * Order matters: the first matching category wins, so the most specific
 * detection runs first. A CameraInfo is technically not an image but belongs
 * with the camera family; TF comes before trajectory since /tf is also a
 * TransformStamped.
 */
export const TOPIC_CATEGORIES: TopicCategory[] = [
  {
    id: 'tf',
    label: 'TF',
    matches: (t) => isTfTopic(t.name, t.type),
  },
  {
    id: 'images',
    label: 'Images',
    matches: (t) => isImageType(t.type) || isVideoType(t.type, t.name),
  },
  {
    id: 'camera-info',
    label: 'Camera info',
    matches: (t) => isCameraInfoType(t.type),
  },
  {
    id: 'clouds',
    label: 'Point clouds',
    matches: (t) => isCloudType(t.type),
  },
  {
    id: 'scans',
    label: 'Laser scans',
    matches: (t) => isLaserScanType(t.type),
  },
  {
    id: 'maps',
    label: 'Maps',
    matches: (t) => isOccupancyGridType(t.type),
  },
  {
    id: 'markers',
    label: 'Markers',
    matches: (t) => isMarkerArrayType(t.type) || isMarkerType(t.type),
  },
  {
    id: 'trajectories',
    label: 'Trajectories',
    matches: (t) => isTrajectoryCapableType(t.type),
  },
  {
    id: 'splats',
    label: 'Splats',
    matches: (t) => isSplatType(t.type),
  },
  {
    id: 'diagnostics',
    label: 'Diagnostics',
    matches: (t) => isDiagnosticArrayType(t.type),
  },
  {
    id: 'logs',
    label: 'Logs',
    matches: (t) => isLogType(t.type),
  },
];

export const OTHER_CATEGORY_ID = 'other';
export const OTHER_CATEGORY_LABEL = 'Other';

/** The category id a topic belongs to, `other` when nothing matches. */
export function topicCategoryOf(topic: TopicInfo): string {
  for (const category of TOPIC_CATEGORIES) {
    if (category.matches(topic)) return category.id;
  }
  return OTHER_CATEGORY_ID;
}

/** Display label for a category id. */
export function categoryLabel(id: string): string {
  if (id === OTHER_CATEGORY_ID) return OTHER_CATEGORY_LABEL;
  return TOPIC_CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

/** One chip per category that actually occurs in the bag, with its count. */
export interface CategoryCount {
  id: string;
  label: string;
  count: number;
}

/**
 * Count topics per category, in `TOPIC_CATEGORIES` order with `other` last.
 * Empty categories are dropped: a chip for zero splats is decoration, not help.
 */
export function countByCategory(topics: TopicInfo[]): CategoryCount[] {
  const counts = new Map<string, number>();
  for (const topic of topics) {
    const id = topicCategoryOf(topic);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const ordered = TOPIC_CATEGORIES.filter((c) => counts.has(c.id)).map((c) => ({
    id: c.id,
    label: c.label,
    count: counts.get(c.id)!,
  }));
  if (counts.has(OTHER_CATEGORY_ID)) {
    ordered.push({ id: OTHER_CATEGORY_ID, label: OTHER_CATEGORY_LABEL, count: counts.get(OTHER_CATEGORY_ID)! });
  }
  return ordered;
}