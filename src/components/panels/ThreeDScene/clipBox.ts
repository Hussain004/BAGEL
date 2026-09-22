/**
 * Clip-box (v1.6.1) settings → decoder `AxisClip` translation.
 *
 * Kept as a pure function in its own module so the panel can wrap it in
 * `useMemo` over its *primitive* inputs. Building the object inline during
 * render produced a fresh reference every paint, which (because
 * `useDecodedCloud` lists `axisClip` in its effect deps) re-triggered the
 * decode effect in a self-sustaining loop whenever the clip box was on.
 */

import type { AxisClip } from '../../../utils/pointcloud';

export interface ClipBoxSettings {
  clipBoxOn: boolean;
  clipXMin: number | null;
  clipXMax: number | null;
  clipYMin: number | null;
  clipYMax: number | null;
  clipZMin: number | null;
  clipZMax: number | null;
}

/**
 * Build the decoder's per-axis clip box from the panel settings. Returns
 * `undefined` when the clip box is off. When it is on, each bound
 * contributes its key only when set, so the object shape - and therefore
 * the worker cache key derived from it - stays minimal (an all-null box
 * yields an empty object, which the decoder treats as "no clipping").
 */
export function buildAxisClip(settings: ClipBoxSettings): AxisClip | undefined {
  if (!settings.clipBoxOn) return undefined;
  return {
    ...(settings.clipXMin !== null ? { xMin: settings.clipXMin } : {}),
    ...(settings.clipXMax !== null ? { xMax: settings.clipXMax } : {}),
    ...(settings.clipYMin !== null ? { yMin: settings.clipYMin } : {}),
    ...(settings.clipYMax !== null ? { yMax: settings.clipYMax } : {}),
    ...(settings.clipZMin !== null ? { zMin: settings.clipZMin } : {}),
    ...(settings.clipZMax !== null ? { zMax: settings.clipZMax } : {}),
  };
}
