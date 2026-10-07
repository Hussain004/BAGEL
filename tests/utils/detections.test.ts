import { describe, expect, it } from 'vitest';
import {
  boxCorners,
  classColor,
  detectionFreshness,
  isDetection2DArrayType,
  parseDetection2DArray,
  stampNs,
} from '../../src/utils/detections';
import { buildRemapMap, undistortPixel } from '../../src/utils/imageRectify';
import type { CameraIntrinsics } from '../../src/hooks/useCameraInfo';

const stamp = { sec: 10, nanosec: 500_000_000 };

describe('type detection', () => {
  it('accepts both ROS spellings only', () => {
    expect(isDetection2DArrayType('vision_msgs/Detection2DArray')).toBe(true);
    expect(isDetection2DArrayType('vision_msgs/msg/Detection2DArray')).toBe(true);
    expect(isDetection2DArrayType('vision_msgs/msg/Detection3DArray')).toBe(false);
    expect(isDetection2DArrayType('vision_msgs/msg/Detection2D')).toBe(false);
  });
});

describe('parseDetection2DArray layouts', () => {
  it('reads the newer layout (center.position, hypothesis.class_id)', () => {
    const { detections, stampNs: s } = parseDetection2DArray({
      header: { stamp, frame_id: 'cam' },
      detections: [
        {
          bbox: { center: { position: { x: 100, y: 50 }, theta: 0 }, size_x: 40, size_y: 20 },
          results: [{ hypothesis: { class_id: 'person', score: 0.9 }, pose: {} }],
        },
      ],
    });
    expect(s).toBe(10_500_000_000n);
    expect(detections).toEqual([
      { cx: 100, cy: 50, w: 40, h: 20, theta: 0, label: 'person', score: 0.9, classKey: 'person' },
    ]);
  });

  it('reads the older layout (center is a Pose2D, results[].id is an int)', () => {
    const { detections } = parseDetection2DArray({
      header: { stamp },
      detections: [
        {
          bbox: { center: { x: 10, y: 20, theta: 0.5 }, size_x: 8, size_y: 6 },
          results: [{ id: 3, score: 0.4 }],
        },
      ],
    });
    expect(detections[0]).toMatchObject({ cx: 10, cy: 20, theta: 0.5, label: '#3', score: 0.4 });
  });

  it('reads the Foxy layout with a string id', () => {
    const { detections } = parseDetection2DArray({
      detections: [{ bbox: { center: { x: 1, y: 2 }, size_x: 3, size_y: 4 }, results: [{ id: 'car', score: 0.7 }] }],
    });
    expect(detections[0]).toMatchObject({ label: 'car', score: 0.7 });
  });

  it('picks the highest-scoring hypothesis', () => {
    const { detections } = parseDetection2DArray({
      detections: [
        {
          bbox: { center: { position: { x: 0, y: 0 } }, size_x: 1, size_y: 1 },
          results: [
            { hypothesis: { class_id: 'cat', score: 0.2 } },
            { hypothesis: { class_id: 'dog', score: 0.8 } },
            { hypothesis: { class_id: 'cow', score: 0.5 } },
          ],
        },
      ],
    });
    expect(detections[0]!.label).toBe('dog');
  });

  it('draws a box with no hypotheses and no stamp', () => {
    const r = parseDetection2DArray({ detections: [{ bbox: { center: { x: 5, y: 5 }, size_x: 2, size_y: 2 }, results: [] }] });
    expect(r.stampNs).toBeNull();
    expect(r.detections[0]).toMatchObject({ label: '', score: null });
  });

  it('skips malformed boxes without discarding the good ones', () => {
    const r = parseDetection2DArray({
      detections: [
        null,
        {},
        { bbox: {} },
        { bbox: { center: { x: NaN, y: 0 }, size_x: 1, size_y: 1 } },
        { bbox: { center: { x: 0, y: 0 }, size_x: -4, size_y: 1 } },
        { bbox: { center: { x: 1, y: 1 }, size_x: 2, size_y: 2 } },
      ],
    });
    expect(r.detections).toHaveLength(1);
  });

  it('handles empty and missing arrays', () => {
    expect(parseDetection2DArray({ detections: [] }).detections).toEqual([]);
    expect(parseDetection2DArray({}).detections).toEqual([]);
    expect(parseDetection2DArray(null).detections).toEqual([]);
    expect(parseDetection2DArray({ detections: 'x' }).detections).toEqual([]);
  });

  it('parses a few hundred boxes', () => {
    const detections = Array.from({ length: 500 }, (_, i) => ({
      bbox: { center: { position: { x: i, y: i } }, size_x: 10, size_y: 10 },
      results: [{ hypothesis: { class_id: `c${i % 7}`, score: 0.5 } }],
    }));
    expect(parseDetection2DArray({ detections }).detections).toHaveLength(500);
  });
});

describe('stampNs', () => {
  it('reads ROS 2 and ROS 1 spellings', () => {
    expect(stampNs({ header: { stamp: { sec: 1, nanosec: 5 } } })).toBe(1_000_000_005n);
    expect(stampNs({ header: { stamp: { secs: 2, nsecs: 7 } } })).toBe(2_000_000_007n);
    expect(stampNs({ header: {} })).toBeNull();
    expect(stampNs({})).toBeNull();
    expect(stampNs(null)).toBeNull();
  });
});

describe('detectionFreshness', () => {
  const tol = 100_000_000n;
  it('matches an exact stamp and a nearby one in either direction', () => {
    expect(detectionFreshness(5n, 5n, tol)).toEqual({ fresh: true, deltaNs: 0n });
    expect(detectionFreshness(50_000_000n, 0n, tol).fresh).toBe(true);
    expect(detectionFreshness(0n, 90_000_000n, tol)).toEqual({ fresh: true, deltaNs: -90_000_000n });
  });
  it('hides boxes outside the tolerance', () => {
    expect(detectionFreshness(0n, 101_000_000n, tol).fresh).toBe(false);
    expect(detectionFreshness(500_000_000n, 0n, tol).fresh).toBe(false);
  });
  it('cannot compare missing stamps, so it draws', () => {
    expect(detectionFreshness(null, 5n, tol)).toEqual({ fresh: true, deltaNs: null });
    expect(detectionFreshness(5n, null, tol).fresh).toBe(true);
  });
});

describe('geometry and colour', () => {
  it('computes axis-aligned corners', () => {
    const c = boxCorners({ cx: 10, cy: 10, w: 4, h: 2, theta: 0, label: '', score: null, classKey: '' });
    expect(c).toEqual([[8, 9], [12, 9], [12, 11], [8, 11]]);
  });
  it('rotates about the centre', () => {
    const c = boxCorners({ cx: 0, cy: 0, w: 2, h: 0, theta: Math.PI / 2, label: '', score: null, classKey: '' });
    expect(c[1]![0]).toBeCloseTo(0);
    expect(c[1]![1]).toBeCloseTo(1);
  });
  it('colours a class stably and spreads classes across the palette', () => {
    expect(classColor('person')).toBe(classColor('person'));
    const colors = new Set(Array.from({ length: 40 }, (_, i) => classColor(`class${i}`)));
    expect(colors.size).toBeGreaterThan(5);
  });
});

describe('undistortPixel', () => {
  const ci = (d: number[]): CameraIntrinsics => ({
    fx: 500, fy: 500, cx: 320, cy: 240, width: 640, height: 480,
    distortionCoefficients: d, distortionModel: 'plumb_bob', frameId: '', timestamp: 0n,
  });

  it('is the identity with no distortion', () => {
    const p = undistortPixel(ci([0, 0, 0, 0, 0]), 100, 400);
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(400, 6);
  });

  it('inverts the remap table: a rectified pixel pulled from the source lands back on itself', () => {
    const cam = ci([-0.28, 0.07, 0.0005, -0.0003, 0]);
    const map = buildRemapMap(cam);
    for (const [u, v] of [[320, 240], [100, 80], [550, 400], [30, 450]] as const) {
      const i = v * cam.width + u;
      // (u, v) in the rectified image samples the source at (mapX, mapY);
      // undistorting that source pixel must give (u, v) back.
      const back = undistortPixel(cam, map.mapX[i]!, map.mapY[i]!);
      expect(back.x).toBeCloseTo(u, 2);
      expect(back.y).toBeCloseTo(v, 2);
    }
  });

  it('leaves the principal point fixed', () => {
    const p = undistortPixel(ci([-0.3, 0.1, 0.001, 0.001, 0]), 320, 240);
    expect(p.x).toBeCloseTo(320, 6);
    expect(p.y).toBeCloseTo(240, 6);
  });
});
