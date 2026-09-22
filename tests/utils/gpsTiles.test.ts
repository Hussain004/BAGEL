/**
 * Tests for the slippy-map tile helpers (gpsTiles.ts).
 *
 * The Mercator term in pickZoomForScale divides through cos(lat): at (or
 * beyond) the poles that used to yield -Infinity / NaN before the latitude
 * clamp, and NaN survived the min/max zoom clamps.
 */

import { describe, it, expect } from 'vitest';
import { pickZoomForScale } from '../../src/utils/gpsTiles';

describe('gpsTiles/pickZoomForScale', () => {
  it('returns a finite, in-range zoom for ordinary latitudes', () => {
    const z = pickZoomForScale(1, 0);
    expect(Number.isFinite(z)).toBe(true);
    expect(z).toBeGreaterThanOrEqual(2);
    expect(z).toBeLessThanOrEqual(19);
  });

  it('returns a finite zoom at and beyond polar latitudes', () => {
    const latRads = [
      Math.PI / 2, // exactly 90 degrees
      -Math.PI / 2,
      Math.PI / 2 + 0.3, // past the pole: used to be log2(negative) -> NaN
      -Math.PI / 2 - 0.3,
    ];
    for (const latRad of latRads) {
      const z = pickZoomForScale(0.5, latRad);
      expect(Number.isFinite(z), `latRad=${latRad}`).toBe(true);
      expect(z, `latRad=${latRad}`).toBeGreaterThanOrEqual(2);
      expect(z, `latRad=${latRad}`).toBeLessThanOrEqual(19);
    }
  });

  it('falls back to a finite zoom for a non-finite latitude', () => {
    expect(Number.isFinite(pickZoomForScale(1, NaN))).toBe(true);
    expect(Number.isFinite(pickZoomForScale(1, Infinity))).toBe(true);
  });
});
