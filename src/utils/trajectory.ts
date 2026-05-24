/**
 * Trajectory extraction + projection helpers used by the TrajectoryPlot panel.
 *
 * Supports:
 *   - nav_msgs/msg/Odometry            → pose.pose.position.{x,y}
 *   - geometry_msgs/msg/PoseStamped    → pose.position.{x,y}
 *   - geometry_msgs/msg/PoseWithCovarianceStamped → pose.pose.position.{x,y}
 *   - geometry_msgs/msg/Pose           → position.{x,y}
 *   - geometry_msgs/msg/Point          → x,y
 *   - geometry_msgs/msg/PointStamped   → point.{x,y}
 *   - geometry_msgs/msg/TransformStamped → transform.translation.{x,y}
 *   - sensor_msgs/msg/NavSatFix        → equirectangular projection of lat/lon
 *                                       anchored at the first valid sample
 *
 * Orientation (quaternion → yaw, in the world frame) is extracted when the
 * message carries one, so the panel can draw a heading arrow at the playhead.
 */

export interface TrajectoryPoint {
  /** Bag-relative time of the sample in nanoseconds (matches msg.timestamp). */
  t: bigint;
  /** Planar x in metres (or projected metres for NavSatFix). */
  x: number;
  /** Planar y in metres. */
  y: number;
  /** Heading in radians, if the message provides one. */
  yaw?: number;
}

export interface TrajectoryExtractionResult {
  points: TrajectoryPoint[];
  /** Human-readable hint about which projection / field was used. */
  source: string;
  /** True if the trajectory came from NavSatFix; the panel adds a "GPS" hint. */
  projected: boolean;
}

interface Vec3Like {
  x?: unknown;
  y?: unknown;
}
interface QuatLike {
  x?: unknown;
  y?: unknown;
  z?: unknown;
  w?: unknown;
}

const EARTH_RADIUS_M = 6378137;

/** True if `t` is a ROS2 type name that can yield a 2D trajectory. */
export function isTrajectoryType(type: string): boolean {
  return (
    type.endsWith('/Odometry') ||
    type.endsWith('/PoseStamped') ||
    type.endsWith('/PoseWithCovarianceStamped') ||
    type.endsWith('/Pose') ||
    type.endsWith('/Point') ||
    type.endsWith('/PointStamped') ||
    type.endsWith('/TransformStamped') ||
    type.endsWith('/NavSatFix')
  );
}

/** Extract (x, y, yaw) from one deserialized message, given its known type. */
function extractOne(
  value: Record<string, unknown> | null,
  type: string,
  navSatRef: { lat: number; lon: number } | null,
): { x: number; y: number; yaw?: number } | null {
  if (!value) return null;
  const v = value as Record<string, unknown>;

  if (type.endsWith('/NavSatFix')) {
    const lat = Number(v.latitude);
    const lon = Number(v.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    // Treat (0, 0) as "no fix" — most GPS modules emit it before lock.
    if (lat === 0 && lon === 0) return null;
    if (!navSatRef) return { x: 0, y: 0 };
    const dLat = ((lat - navSatRef.lat) * Math.PI) / 180;
    const dLon = ((lon - navSatRef.lon) * Math.PI) / 180;
    const x = dLon * Math.cos((navSatRef.lat * Math.PI) / 180) * EARTH_RADIUS_M;
    const y = dLat * EARTH_RADIUS_M;
    return { x, y };
  }

  // Walk the type-specific path down to the position vector + optional quat.
  let pos: Vec3Like | undefined;
  let quat: QuatLike | undefined;

  if (type.endsWith('/Odometry') || type.endsWith('/PoseWithCovarianceStamped')) {
    const outer = v.pose as { pose?: { position?: Vec3Like; orientation?: QuatLike } } | undefined;
    pos = outer?.pose?.position;
    quat = outer?.pose?.orientation;
  } else if (type.endsWith('/PoseStamped')) {
    const pose = v.pose as { position?: Vec3Like; orientation?: QuatLike } | undefined;
    pos = pose?.position;
    quat = pose?.orientation;
  } else if (type.endsWith('/Pose')) {
    pos = v.position as Vec3Like | undefined;
    quat = v.orientation as QuatLike | undefined;
  } else if (type.endsWith('/PointStamped')) {
    pos = v.point as Vec3Like | undefined;
  } else if (type.endsWith('/Point')) {
    pos = v as Vec3Like;
  } else if (type.endsWith('/TransformStamped')) {
    const t = v.transform as { translation?: Vec3Like; rotation?: QuatLike } | undefined;
    pos = t?.translation;
    quat = t?.rotation;
  }

  if (!pos) return null;
  const x = Number(pos.x);
  const y = Number(pos.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const yaw = quat ? quaternionToYaw(quat) : undefined;
  return { x, y, yaw };
}

/** Z-axis rotation from a quaternion using the standard ZYX convention. */
function quaternionToYaw(q: QuatLike): number | undefined {
  const x = Number(q.x);
  const y = Number(q.y);
  const z = Number(q.z);
  const w = Number(q.w);
  if (![x, y, z, w].every(Number.isFinite)) return undefined;
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

/**
 * Pull a list of trajectory points out of a topic's decoded message stream.
 *
 * For NavSatFix we anchor at the first valid lat/lon so x/y comes out as
 * metres of east/north offset — handy for visualising a GPS track on a
 * canvas without needing a tile basemap.
 */
export function extractTrajectory(
  messages: { timestamp: bigint; value: Record<string, unknown> | null }[],
  type: string,
): TrajectoryExtractionResult {
  const points: TrajectoryPoint[] = [];
  let navSatRef: { lat: number; lon: number } | null = null;
  const projected = type.endsWith('/NavSatFix');

  if (projected) {
    for (const m of messages) {
      const v = m.value;
      if (!v) continue;
      const lat = Number(v.latitude);
      const lon = Number(v.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat === 0 && lon === 0) continue;
      navSatRef = { lat, lon };
      break;
    }
  }

  for (const m of messages) {
    const p = extractOne(m.value, type, navSatRef);
    if (!p) continue;
    points.push({ t: m.timestamp, x: p.x, y: p.y, yaw: p.yaw });
  }

  let source = type.split('/').pop() ?? type;
  if (projected) source = `${source} (equirectangular projection)`;
  return { points, source, projected };
}

export interface TrajectoryBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function computeBounds(points: TrajectoryPoint[]): TrajectoryBounds | null {
  if (points.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // Avoid a zero-size box when every point is identical (e.g. a single sample).
  if (minX === maxX) {
    minX -= 0.5;
    maxX += 0.5;
  }
  if (minY === maxY) {
    minY -= 0.5;
    maxY += 0.5;
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Binary search for the point whose timestamp is closest to `targetNs`.
 * Returns -1 when `points` is empty.
 */
export function nearestPointIndex(points: TrajectoryPoint[], targetNs: bigint): number {
  if (points.length === 0) return -1;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < targetNs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const a = points[lo - 1].t;
    const b = points[lo].t;
    if (targetNs - a < b - targetNs) return lo - 1;
  }
  return lo;
}
