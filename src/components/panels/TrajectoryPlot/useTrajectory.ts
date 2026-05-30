/**
 * useTrajectory — Pull every message for a pose-like topic, extract the
 * planar (x, y) path, and memoize the result so re-renders during scrubbing
 * don't redo the per-message field walk.
 *
 * Delegates to the shared `useTopicMessages` hook so trajectory and plot
 * panels on the same topic share the underlying decode cache.
 */

import { useMemo } from 'react';
import { useTopicMessages } from '../../../hooks/useTopicMessages';
import {
  computeBounds,
  extractTrajectory,
  type TrajectoryBounds,
  type TrajectoryPoint,
} from '../../../utils/trajectory';

export interface UseTrajectoryResult {
  points: TrajectoryPoint[];
  bounds: TrajectoryBounds | null;
  source: string;
  projected: boolean;
  /**
   * Anchor lat/lon for NavSatFix trajectories — null otherwise. The map
   * tile underlay uses it to back-project canvas-pixel coords to lat/lon
   * when figuring out which tile range covers the viewport.
   */
  navSatRef: { lat: number; lon: number } | null;
  loading: boolean;
  progress: number;
  error: string | null;
}

/** Cap the load size, mirroring the plot panel cap, so a 100k-frame Odometry
 * topic doesn't lock the page. Trajectories rarely need that much resolution. */
const TRAJECTORY_MESSAGE_LIMIT = 50_000;

export function useTrajectory(topicName: string, type: string): UseTrajectoryResult {
  const { messages, loading, progress, error } = useTopicMessages(
    topicName,
    TRAJECTORY_MESSAGE_LIMIT,
  );

  const extraction = useMemo(() => {
    if (!messages) return null;
    return extractTrajectory(messages, type);
  }, [messages, type]);

  const bounds = useMemo(
    () => (extraction ? computeBounds(extraction.points) : null),
    [extraction],
  );

  return {
    points: extraction?.points ?? [],
    bounds,
    source: extraction?.source ?? '',
    projected: extraction?.projected ?? false,
    navSatRef: extraction?.navSatRef ?? null,
    loading,
    progress,
    error,
  };
}
