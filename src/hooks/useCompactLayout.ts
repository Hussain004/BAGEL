import { useSyncExternalStore } from 'react';

/**
 * Phones, and tablets held upright: too narrow for a split tree of panels, so
 * the grid shows one panel at a time. A wide tablet in landscape keeps the full
 * layout, since it has the room.
 */
export const COMPACT_QUERY = '(max-width: 767px), (pointer: coarse) and (max-width: 1023px)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(COMPACT_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

export function useCompactLayout(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(COMPACT_QUERY).matches,
    () => false,
  );
}
