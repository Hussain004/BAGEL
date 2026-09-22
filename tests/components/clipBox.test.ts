import { describe, expect, it } from 'vitest';
import { buildAxisClip } from '../../src/components/panels/ThreeDScene/clipBox';

const ALL_OFF = {
  clipBoxOn: false,
  clipXMin: null,
  clipXMax: null,
  clipYMin: null,
  clipYMax: null,
  clipZMin: null,
  clipZMax: null,
} as const;

describe('buildAxisClip', () => {
  it('returns undefined when the clip box is off, even with bounds set', () => {
    expect(
      buildAxisClip({ ...ALL_OFF, clipBoxOn: false, clipXMin: -1, clipXMax: 1 }),
    ).toBeUndefined();
  });

  it('returns an empty object when on with every bound null', () => {
    expect(buildAxisClip({ ...ALL_OFF, clipBoxOn: true })).toEqual({});
  });

  it('emits only the keys that are actually set', () => {
    const clip = buildAxisClip({
      ...ALL_OFF,
      clipBoxOn: true,
      clipXMin: -2.5,
      clipZMax: 10,
    });
    expect(clip).toEqual({ xMin: -2.5, zMax: 10 });
    expect(Object.keys(clip ?? {}).sort()).toEqual(['xMin', 'zMax']);
  });

  it('passes through zero bounds (0 is a real bound, not "unset")', () => {
    const clip = buildAxisClip({
      ...ALL_OFF,
      clipBoxOn: true,
      clipXMin: 0,
      clipYMax: 0,
    });
    expect(clip).toEqual({ xMin: 0, yMax: 0 });
  });

  it('is deterministic for identical inputs (safe to memoize over primitives)', () => {
    const settings = { ...ALL_OFF, clipBoxOn: true, clipYMin: -3, clipYMax: 3 };
    expect(buildAxisClip(settings)).toEqual(buildAxisClip(settings));
  });
});
