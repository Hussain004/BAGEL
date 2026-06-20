import { describe, it, expect } from 'vitest';
import {
  isFoxgloveSchema,
  translateFoxgloveMessage,
} from '../../src/parsers/foxgloveSchemas';

// Encode a string to base64 the same way Foxglove does for binary fields.
function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

describe('isFoxgloveSchema', () => {
  it('returns true for known foxglove schema names', () => {
    expect(isFoxgloveSchema('foxglove.CompressedImage')).toBe(true);
    expect(isFoxgloveSchema('foxglove.RawImage')).toBe(true);
    expect(isFoxgloveSchema('foxglove.PointCloud')).toBe(true);
    expect(isFoxgloveSchema('foxglove.LaserScan')).toBe(true);
    expect(isFoxgloveSchema('foxglove.FrameTransform')).toBe(true);
  });

  it('returns false for unknown / ROS types', () => {
    expect(isFoxgloveSchema('sensor_msgs/CompressedImage')).toBe(false);
    expect(isFoxgloveSchema('foxglove.Unknown')).toBe(false);
    expect(isFoxgloveSchema('')).toBe(false);
  });
});

describe('translateFoxgloveMessage - passthrough', () => {
  it('returns the message unchanged for unknown schema names', () => {
    const msg = { foo: 'bar' };
    expect(translateFoxgloveMessage('sensor_msgs/Image', msg)).toBe(msg);
  });
});

describe('translateFoxgloveMessage - foxglove.CompressedImage', () => {
  const imageBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const ts = { sec: 1, nsec: 500 };

  const msg = {
    timestamp: ts,
    frame_id: 'camera',
    data: toBase64(imageBytes),
    format: 'jpeg',
  };

  it('maps to sensor_msgs/CompressedImage shape', () => {
    const result = translateFoxgloveMessage('foxglove.CompressedImage', msg);
    expect(result['format']).toBe('jpeg');
    expect(result['header']).toEqual({ stamp: { sec: 1, nsec: 500 }, frame_id: 'camera' });
  });

  it('decodes base64 data to Uint8Array', () => {
    const result = translateFoxgloveMessage('foxglove.CompressedImage', msg);
    const data = result['data'] as Uint8Array;
    expect(data).toBeInstanceOf(Uint8Array);
    expect(Array.from(data)).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });
});

describe('translateFoxgloveMessage - foxglove.RawImage', () => {
  const pixels = new Uint8Array([255, 0, 0, 0, 255, 0]);
  const msg = {
    timestamp: { sec: 2, nsec: 0 },
    frame_id: 'cam',
    width: 2,
    height: 1,
    encoding: 'rgb8',
    step: 6,
    data: toBase64(pixels),
  };

  it('maps to sensor_msgs/Image shape', () => {
    const result = translateFoxgloveMessage('foxglove.RawImage', msg);
    expect(result['width']).toBe(2);
    expect(result['height']).toBe(1);
    expect(result['encoding']).toBe('rgb8');
    expect(result['step']).toBe(6);
    expect(result['is_bigendian']).toBe(0);
  });

  it('decodes base64 pixels to Uint8Array', () => {
    const result = translateFoxgloveMessage('foxglove.RawImage', msg);
    const data = result['data'] as Uint8Array;
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(6);
  });
});

describe('translateFoxgloveMessage - foxglove.PointCloud', () => {
  // 2 points, 12 bytes each (x/y/z float32)
  const rawData = new Uint8Array(24);
  const dv = new DataView(rawData.buffer);
  dv.setFloat32(0, 1.0, true);
  dv.setFloat32(4, 2.0, true);
  dv.setFloat32(8, 3.0, true);
  dv.setFloat32(12, 4.0, true);
  dv.setFloat32(16, 5.0, true);
  dv.setFloat32(20, 6.0, true);

  const msg = {
    timestamp: { sec: 0, nsec: 0 },
    frame_id: 'lidar',
    point_stride: 12,
    fields: [
      { name: 'x', offset: 0, type: 7 },  // FLOAT32
      { name: 'y', offset: 4, type: 7 },
      { name: 'z', offset: 8, type: 7 },
    ],
    data: toBase64(rawData),
  };

  it('renames point_stride -> point_step', () => {
    const result = translateFoxgloveMessage('foxglove.PointCloud', msg);
    expect(result['point_step']).toBe(12);
  });

  it('computes width from data length / point_step', () => {
    const result = translateFoxgloveMessage('foxglove.PointCloud', msg);
    expect(result['width']).toBe(2);
    expect(result['height']).toBe(1);
  });

  it('maps foxglove NumericType to ROS datatype', () => {
    const result = translateFoxgloveMessage('foxglove.PointCloud', msg);
    const fields = result['fields'] as Array<{ name: string; datatype: number }>;
    // foxglove type=7 -> ROS FLOAT32=7
    expect(fields[0].datatype).toBe(7);
    expect(fields[0].name).toBe('x');
  });

  it('decodes base64 data to Uint8Array', () => {
    const result = translateFoxgloveMessage('foxglove.PointCloud', msg);
    expect(result['data']).toBeInstanceOf(Uint8Array);
    expect((result['data'] as Uint8Array).length).toBe(24);
  });

  it('maps UINT8=1 and INT8=2 to their ROS equivalents', () => {
    const intMsg = {
      timestamp: { sec: 0, nsec: 0 },
      frame_id: '',
      point_stride: 2,
      fields: [
        { name: 'u', offset: 0, type: 1 }, // Foxglove UINT8 -> ROS UINT8 (2)
        { name: 'i', offset: 1, type: 2 }, // Foxglove INT8  -> ROS INT8  (1)
      ],
      data: toBase64(new Uint8Array(0)),
    };
    const result = translateFoxgloveMessage('foxglove.PointCloud', intMsg);
    const fields = result['fields'] as Array<{ datatype: number }>;
    expect(fields[0].datatype).toBe(2); // ROS UINT8
    expect(fields[1].datatype).toBe(1); // ROS INT8
  });
});

describe('translateFoxgloveMessage - foxglove.LaserScan', () => {
  const msg = {
    timestamp: { sec: 5, nsec: 0 },
    frame_id: 'scan',
    start_angle: -1.5707963,
    end_angle: 1.5707963,
    ranges: [1.0, 2.0, 3.0, 4.0, 5.0],
    intensities: [10, 20, 30, 40, 50],
  };

  it('maps start_angle/end_angle -> angle_min/angle_max', () => {
    const result = translateFoxgloveMessage('foxglove.LaserScan', msg);
    expect(result['angle_min']).toBe(-1.5707963);
    expect(result['angle_max']).toBe(1.5707963);
  });

  it('computes angle_increment from range and count', () => {
    const result = translateFoxgloveMessage('foxglove.LaserScan', msg);
    const expected = (1.5707963 - (-1.5707963)) / (5 - 1);
    expect(result['angle_increment']).toBeCloseTo(expected, 6);
  });

  it('passes ranges and intensities through', () => {
    const result = translateFoxgloveMessage('foxglove.LaserScan', msg);
    expect(result['ranges']).toEqual([1, 2, 3, 4, 5]);
    expect(result['intensities']).toEqual([10, 20, 30, 40, 50]);
  });

  it('handles single-point scan without divide-by-zero', () => {
    const single = { ...msg, ranges: [1.0], intensities: [] };
    const result = translateFoxgloveMessage('foxglove.LaserScan', single);
    expect(result['angle_increment']).toBe(0);
  });
});

describe('translateFoxgloveMessage - foxglove.FrameTransform', () => {
  const msg = {
    timestamp: { sec: 10, nsec: 0 },
    parent_frame_id: 'world',
    child_frame_id: 'base_link',
    translation: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
  };

  it('maps parent_frame_id -> header.frame_id', () => {
    const result = translateFoxgloveMessage('foxglove.FrameTransform', msg);
    const header = result['header'] as Record<string, unknown>;
    expect(header['frame_id']).toBe('world');
  });

  it('preserves child_frame_id', () => {
    const result = translateFoxgloveMessage('foxglove.FrameTransform', msg);
    expect(result['child_frame_id']).toBe('base_link');
  });

  it('wraps translation and rotation in transform', () => {
    const result = translateFoxgloveMessage('foxglove.FrameTransform', msg);
    const transform = result['transform'] as Record<string, unknown>;
    expect(transform['translation']).toEqual({ x: 1, y: 2, z: 3 });
    expect(transform['rotation']).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });
});
