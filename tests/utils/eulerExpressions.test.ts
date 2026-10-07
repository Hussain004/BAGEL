import { describe, expect, it } from 'vitest';
import { eulerExpressions, findQuaternionPrefixes } from '../../src/utils/eulerExpressions';
import { compileExpr } from '../../src/utils/mathExpr';

/** Evaluate roll, pitch, yaw (degrees) for a quaternion stored under `prefix`. */
function rpy(prefix: string, q: { x: number; y: number; z: number; w: number }) {
  const dot = prefix ? `${prefix}.` : '';
  const vars = { [`${dot}x`]: q.x, [`${dot}y`]: q.y, [`${dot}z`]: q.z, [`${dot}w`]: q.w };
  return eulerExpressions(prefix).map((e) => {
    const f = compileExpr(e.expr);
    if (typeof f === 'string') throw new Error(`${e.label}: ${f}`);
    return f(vars);
  });
}

/** Quaternion for a rotation of `deg` about a single axis. */
function about(axis: 'x' | 'y' | 'z', deg: number) {
  const h = (deg * Math.PI) / 360;
  return { x: 0, y: 0, z: 0, w: Math.cos(h), [axis]: Math.sin(h) } as { x: number; y: number; z: number; w: number };
}

/** Compose yaw (Z), pitch (Y), roll (X) the ZYX way, to cross-check the closed forms. */
function fromRpy(rollDeg: number, pitchDeg: number, yawDeg: number) {
  const r = (rollDeg * Math.PI) / 360;
  const p = (pitchDeg * Math.PI) / 360;
  const y = (yawDeg * Math.PI) / 360;
  return {
    w: Math.cos(r) * Math.cos(p) * Math.cos(y) + Math.sin(r) * Math.sin(p) * Math.sin(y),
    x: Math.sin(r) * Math.cos(p) * Math.cos(y) - Math.cos(r) * Math.sin(p) * Math.sin(y),
    y: Math.cos(r) * Math.sin(p) * Math.cos(y) + Math.sin(r) * Math.cos(p) * Math.sin(y),
    z: Math.cos(r) * Math.cos(p) * Math.sin(y) - Math.sin(r) * Math.sin(p) * Math.cos(y),
  };
}

describe('eulerExpressions', () => {
  it('is zero for the identity', () => {
    for (const a of rpy('orientation', { x: 0, y: 0, z: 0, w: 1 })) expect(a).toBeCloseTo(0, 9);
  });

  it('recovers a single-axis rotation on the right angle', () => {
    expect(rpy('o', about('x', 30))[0]).toBeCloseTo(30, 6);
    expect(rpy('o', about('y', 30))[1]).toBeCloseTo(30, 6);
    expect(rpy('o', about('z', 30))[2]).toBeCloseTo(30, 6);
    // ...and nothing on the others.
    const [r, p, y] = rpy('o', about('z', 30));
    expect(r).toBeCloseTo(0, 6);
    expect(p).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(30, 6);
  });

  it('round-trips arbitrary roll/pitch/yaw away from gimbal lock', () => {
    for (const [r, p, y] of [[10, 20, 30], [-45, 5, 170], [80, -60, -120], [0, 0, 179], [-170, 45, 10]] as const) {
      const out = rpy('orientation', fromRpy(r, p, y));
      expect(out[0]).toBeCloseTo(r, 5);
      expect(out[1]).toBeCloseTo(p, 5);
      expect(out[2]).toBeCloseTo(y, 5);
    }
  });

  it('handles gimbal lock (pitch +/-90) without dropping the sample', () => {
    for (const sign of [1, -1]) {
      const q = about('y', 90 * sign);
      const [, pitch] = rpy('orientation', q);
      expect(pitch).not.toBeNull();
      expect(pitch).toBeCloseTo(90 * sign, 5);
    }
  });

  it('survives a quaternion a hair past unit length (asin domain)', () => {
    // Rounding in a recorded IMU can push 2(wy - zx) just past 1.
    const q = { x: 0, y: 0.7071068, z: 0, w: 0.7071068 };
    const [, pitch] = rpy('orientation', q);
    expect(pitch).not.toBeNull();
    expect(pitch).toBeCloseTo(90, 3);
  });

  it('an unset (all-zero) orientation, as Imu publishes for "no estimate", gives zeros not nulls', () => {
    const out = rpy('orientation', { x: 0, y: 0, z: 0, w: 0 });
    for (const a of out) expect(a).toBe(0);
  });

  it('works for a top-level quaternion and a deeply nested one', () => {
    expect(rpy('', about('z', 90))[2]).toBeCloseTo(90, 6);
    expect(rpy('pose.pose.orientation', about('x', -45))[0]).toBeCloseTo(-45, 6);
  });

  it('labels and ids are distinct per prefix so two quaternions can coexist', () => {
    const a = eulerExpressions('orientation');
    const b = eulerExpressions('pose.pose.orientation');
    const ids = new Set([...a, ...b].map((e) => e.id));
    expect(ids.size).toBe(6);
    expect(a[0]!.label).toBe('roll (orientation)');
    expect(eulerExpressions('')[2]!.label).toBe('yaw');
  });
});

describe('findQuaternionPrefixes', () => {
  it('finds a prefix with all four components', () => {
    const fields = ['orientation.x', 'orientation.y', 'orientation.z', 'orientation.w', 'angular_velocity.x', 'angular_velocity.y', 'angular_velocity.z'];
    expect(findQuaternionPrefixes(fields)).toEqual(['orientation']);
  });
  it('ignores an incomplete set such as a 3-vector with a stray w', () => {
    expect(findQuaternionPrefixes(['v.x', 'v.y', 'v.w'])).toEqual([]);
    expect(findQuaternionPrefixes(['linear.x', 'linear.y', 'linear.z'])).toEqual([]);
  });
  it('finds several (odometry-style pose plus a second orientation)', () => {
    const q = (p: string) => ['x', 'y', 'z', 'w'].map((c) => `${p}.${c}`);
    expect(findQuaternionPrefixes([...q('pose.pose.orientation'), ...q('imu.orientation')]).sort()).toEqual(['imu.orientation', 'pose.pose.orientation']);
  });
  it('finds a top-level quaternion', () => {
    expect(findQuaternionPrefixes(['x', 'y', 'z', 'w'])).toEqual(['']);
  });
  it('is empty with no fields', () => {
    expect(findQuaternionPrefixes([])).toEqual([]);
  });
});
