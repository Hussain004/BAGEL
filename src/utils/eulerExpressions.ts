/**
 * Roll / pitch / yaw from a quaternion, as plot expressions.
 *
 * Quaternion components (`orientation.x/y/z/w`) are unreadable to a person: a
 * 10 degree tilt is `w=0.996, x=0.087`. `sensor_msgs/Imu` carries one, as do
 * odometry and pose messages. Rather than a special IMU panel, this feeds the
 * existing math-expression engine, so it works for ANY message with a
 * quaternion and the three angles plot, export and combine like any series.
 *
 * ZYX (aerospace) convention, the one ROS uses for rpy: yaw about Z, then
 * pitch about Y, then roll about X.
 */

import type { ExpressionDef } from '../store/panelUiStores';

/**
 * Field-path prefixes that hold a complete quaternion, e.g. `orientation` for
 * `orientation.x/.y/.z/.w`. A top-level quaternion (fields `x y z w`) gives the
 * empty prefix.
 */
export function findQuaternionPrefixes(fieldNames: readonly string[]): string[] {
  const have = new Set(fieldNames);
  const prefixes: string[] = [];
  for (const name of fieldNames) {
    if (name !== 'w' && !name.endsWith('.w')) continue;
    const prefix = name === 'w' ? '' : name.slice(0, -2);
    const dot = prefix === '' ? '' : `${prefix}.`;
    if (have.has(`${dot}x`) && have.has(`${dot}y`) && have.has(`${dot}z`)) prefixes.push(prefix);
  }
  return prefixes;
}

/** The three angle expressions, in degrees, for the quaternion at `prefix`. */
export function eulerExpressions(prefix: string): ExpressionDef[] {
  const dot = prefix === '' ? '' : `${prefix}.`;
  const x = `${dot}x`;
  const y = `${dot}y`;
  const z = `${dot}z`;
  const w = `${dot}w`;
  const tag = prefix === '' ? '' : ` (${prefix.split('.').pop()})`;
  return [
    {
      id: `euler:${prefix}:roll`,
      label: `roll${tag}`,
      expr: `deg(atan2(2*(${w}*${x} + ${y}*${z}), 1 - 2*(${x}*${x} + ${y}*${y})))`,
    },
    {
      id: `euler:${prefix}:pitch`,
      label: `pitch${tag}`,
      // clamp: rounding can push the argument just past +/-1, and asin of that
      // is NaN, which would drop the sample at exactly the pose where pitch is
      // most interesting (straight up or down).
      expr: `deg(asin(clamp(2*(${w}*${y} - ${z}*${x}), -1, 1)))`,
    },
    {
      id: `euler:${prefix}:yaw`,
      label: `yaw${tag}`,
      expr: `deg(atan2(2*(${w}*${z} + ${x}*${y}), 1 - 2*(${y}*${y} + ${z}*${z})))`,
    },
  ];
}
