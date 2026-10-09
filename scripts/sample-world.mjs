/**
 * A tiny analytic 3D world for the sample bag.
 *
 * One scene, three sensors: the LiDAR, the camera and the 2D detector all see
 * the same boxes, so the point cloud, the image, the detections and the
 * occupancy map agree with each other. That is what makes the sample worth
 * playing with: project the LiDAR onto the image and the dots land on the
 * buildings and cars they came from.
 *
 * Everything is deterministic (no Math.random) so regenerating the bag gives
 * identical bytes, and pure so it can be tested without writing a file.
 */

// ── Deterministic noise ─────────────────────────────────────────────────
export function hash01(a, b = 0, c = 0) {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ── Robot path (shared with the main script's odometry) ─────────────────
export function figureEightPose(t) {
  const a = 5.0;
  const phi = t * 0.4;
  const denom = 1 + Math.sin(phi) * Math.sin(phi);
  const x = (a * Math.cos(phi)) / denom;
  const y = (a * Math.sin(phi) * Math.cos(phi)) / denom;
  const dx = (-a * Math.sin(phi)) / denom - (a * Math.cos(phi) * Math.sin(2 * phi)) / (denom * denom);
  const dy = (a * Math.cos(2 * phi)) / denom - (a * Math.sin(phi) * Math.cos(phi) * Math.sin(2 * phi)) / (denom * denom);
  return { x, y, yaw: Math.atan2(dy, dx) };
}

// ── Sensor mounts in base_link (x forward, y left, z up) ────────────────
export const LIDAR_MOUNT = { x: 0.0, y: 0.0, z: 0.95 };
export const CAMERA_MOUNT = { x: 0.3, y: 0.0, z: 0.75 };

// ── The world ───────────────────────────────────────────────────────────
/** Mode timeline the robot's state machine follows; also decides where pedestrians stand. */
export const MODES = [
  { from: 0, to: 2, name: 'IDLE' },
  { from: 2, to: 12, name: 'EXPLORING' },
  { from: 12, to: 14.5, name: 'AVOIDING' },
  { from: 14.5, to: 21.5, name: 'EXPLORING' },
  { from: 21.5, to: 23.5, name: 'AVOIDING' },
  { from: 23.5, to: 30, name: 'RETURNING' },
];

function box(label, cx, cy, sx, sy, h, color) {
  return { label, min: [cx - sx / 2, cy - sy / 2, 0], max: [cx + sx / 2, cy + sy / 2, h], color };
}

/** A person standing 3 m ahead of the robot and 1.2 m to its left at time t, so it is passed, never run over. */
function pedestrianBeside(t) {
  const p = figureEightPose(t);
  const fx = Math.cos(p.yaw);
  const fy = Math.sin(p.yaw);
  return box('person', p.x + 3 * fx - 1.2 * fy, p.y + 3 * fy + 1.2 * fx, 0.5, 0.5, 1.75, [236, 120, 34]);
}

function buildWorld() {
  const boxes = [];
  const palette = [
    [88, 104, 128], [104, 118, 138], [120, 98, 96], [78, 112, 112], [128, 124, 108], [92, 92, 118],
  ];
  // A ring of buildings well outside the loop.
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + 0.2;
    const r = 13 + 3.5 * hash01(i, 1);
    const sx = 3.5 + 3 * hash01(i, 2);
    const sy = 3.5 + 3 * hash01(i, 3);
    const h = 3.5 + 6 * hash01(i, 4);
    boxes.push(box('building', r * Math.cos(ang), r * Math.sin(ang), sx, sy, h, palette[i % palette.length]));
  }
  // Parked cars beside the loop.
  boxes.push(box('car', -3.6, 4.6, 2.5, 1.2, 1.0, [196, 52, 58]));
  boxes.push(box('car', 4.0, -4.9, 2.5, 1.2, 1.0, [52, 98, 196]));
  boxes.push(box('car', 8.2, 1.6, 1.2, 2.5, 1.0, [220, 190, 64]));
  boxes.push(box('car', -8.0, -2.4, 1.2, 2.5, 1.0, [236, 236, 240]));
  // Two pedestrians, placed to match the two AVOIDING periods, and one standing about.
  boxes.push(pedestrianBeside(13));
  boxes.push(pedestrianBeside(22.5));
  boxes.push(box('person', 0.4, 5.6, 0.5, 0.5, 1.75, [60, 168, 120]));
  // Traffic cones marking the crossing in the middle of the figure eight.
  for (const [cx, cy] of [[1.4, 1.4], [-1.4, 1.4], [1.4, -1.4], [-1.4, -1.4]]) {
    boxes.push(box('cone', cx, cy, 0.3, 0.3, 0.55, [255, 112, 24]));
  }
  return boxes;
}

export const WORLD = buildWorld();

/** Labels the detector reports, with the class name it uses. */
export const DETECTABLE = { car: 'car', person: 'person' };

// ── Ray casting ─────────────────────────────────────────────────────────
/**
 * First hit of a ray (origin o, unit direction d) with the world, or null.
 * `kind` is 'ground' or the box label; `normal` and `along` (distance along
 * the face, for textures) come with it.
 */
export function castRay(o, d, maxRange = Infinity) {
  let best = null;
  let bestT = maxRange;

  if (d[2] < -1e-9) {
    const t = -o[2] / d[2];
    if (t > 0 && t < bestT) {
      bestT = t;
      best = { t, kind: 'ground', index: -1, normal: [0, 0, 1], u: o[0] + d[0] * t, v: o[1] + d[1] * t };
    }
  }

  for (let i = 0; i < WORLD.length; i++) {
    const b = WORLD[i];
    let t0 = 0;
    let t1 = bestT;
    let axis = -1;
    let sign = 1;
    let ok = true;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(d[a]) < 1e-12) {
        if (o[a] < b.min[a] || o[a] > b.max[a]) {
          ok = false;
          break;
        }
        continue;
      }
      let ta = (b.min[a] - o[a]) / d[a];
      let tb = (b.max[a] - o[a]) / d[a];
      let s = -1; // entering through the min face
      if (ta > tb) {
        [ta, tb] = [tb, ta];
        s = 1;
      }
      if (ta > t0) {
        t0 = ta;
        axis = a;
        sign = s;
      }
      if (tb < t1) t1 = tb;
      if (t0 > t1) {
        ok = false;
        break;
      }
    }
    if (!ok || axis < 0 || t0 <= 0 || t0 >= bestT) continue;
    const n = [0, 0, 0];
    n[axis] = sign;
    const px = o[0] + d[0] * t0;
    const py = o[1] + d[1] * t0;
    const pz = o[2] + d[2] * t0;
    bestT = t0;
    best = { t: t0, kind: b.label, index: i, normal: n, u: axis === 0 ? py : px, v: pz };
  }
  return best;
}

// ── Pose helpers ────────────────────────────────────────────────────────
/** Rotate a base_link vector into the odom frame. */
function toWorldDir(yaw, x, y, z) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c - y * s, x * s + y * c, z];
}

function mountWorld(pose, mount) {
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  return [pose.x + mount.x * c - mount.y * s, pose.y + mount.x * s + mount.y * c, mount.z];
}

// ── LiDAR ───────────────────────────────────────────────────────────────
const BEAMS = 16;
const AZIMUTHS = 125;
const EL_MIN = (-22 * Math.PI) / 180;
const EL_MAX = (8 * Math.PI) / 180;
export const LIDAR_MAX_RANGE = 30;

const INTENSITY = { ground: 0.2, building: 0.5, car: 0.95, person: 0.78, cone: 1.0 };

/**
 * One sweep, as xyz + intensity in the LiDAR's own frame (what a driver
 * publishes). Rays that hit nothing within range are dropped, as on real
 * hardware. `frame` seeds the range noise so every sweep is different.
 */
export function lidarSweep(pose, frame) {
  const origin = mountWorld(pose, LIDAR_MOUNT);
  const pts = [];
  for (let b = 0; b < BEAMS; b++) {
    const el = EL_MIN + ((EL_MAX - EL_MIN) * b) / (BEAMS - 1);
    for (let a = 0; a < AZIMUTHS; a++) {
      const az = (a / AZIMUTHS) * Math.PI * 2;
      const lx = Math.cos(el) * Math.cos(az);
      const ly = Math.cos(el) * Math.sin(az);
      const lz = Math.sin(el);
      const hit = castRay(origin, toWorldDir(pose.yaw, lx, ly, lz), LIDAR_MAX_RANGE);
      if (!hit) continue;
      const r = hit.t + (hash01(frame, b, a) - 0.5) * 0.03;
      const checker = hit.kind === 'ground' ? ((Math.floor(hit.u) + Math.floor(hit.v)) & 1) * 0.12 : 0;
      pts.push([lx * r, ly * r, lz * r, (INTENSITY[hit.kind] ?? 0.4) + checker]);
    }
  }
  return pts;
}

// ── Camera ──────────────────────────────────────────────────────────────
export const CAM = { w: 192, h: 144, fx: 150, fy: 150, cx: 96, cy: 72, d: [-0.12, 0.02, 0, 0, 0] };

/** Optical (x right, y down, z forward) direction to base_link, then to the world. */
function cameraDir(yaw, xo, yo) {
  const len = Math.hypot(xo, yo, 1);
  return toWorldDir(yaw, 1 / len, -xo / len, -yo / len);
}

function undistortNormalised(xd, yd, [k1, k2, p1, p2, k3]) {
  let xu = xd;
  let yu = yd;
  for (let i = 0; i < 8; i++) {
    const r2 = xu * xu + yu * yu;
    const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
    const dx = 2 * p1 * xu * yu + p2 * (r2 + 2 * xu * xu);
    const dy = p1 * (r2 + 2 * yu * yu) + 2 * p2 * xu * yu;
    xu = (xd - dx) / radial;
    yu = (yd - dy) / radial;
  }
  return [xu, yu];
}

/** Forward plumb-bob model: normalised optical point to pixel. */
export function projectToPixel(xn, yn, cam = CAM) {
  const [k1, k2, p1, p2, k3] = cam.d;
  const r2 = xn * xn + yn * yn;
  const radial = 1 + k1 * r2 + k2 * r2 * r2 + k3 * r2 * r2 * r2;
  const xd = xn * radial + 2 * p1 * xn * yn + p2 * (r2 + 2 * xn * xn);
  const yd = yn * radial + p1 * (r2 + 2 * yn * yn) + 2 * p2 * xn * yn;
  return [xd * cam.fx + cam.cx, yd * cam.fy + cam.cy];
}

function shade(hit, o, d) {
  const sun = [0.45, -0.35, 0.82];
  const lambert = Math.max(0, hit.normal[0] * sun[0] + hit.normal[1] * sun[1] + hit.normal[2] * sun[2]);
  let base;
  if (hit.kind === 'ground') {
    const cell = (Math.floor(hit.u) + Math.floor(hit.v)) & 1;
    const fu = Math.abs(hit.u - Math.round(hit.u));
    const fv = Math.abs(hit.v - Math.round(hit.v));
    const line = fu < 0.03 || fv < 0.03;
    base = line ? [120, 132, 146] : cell ? [58, 66, 78] : [46, 53, 64];
  } else {
    const b = WORLD[hit.index];
    base = b.color;
    const p = [o[0] + d[0] * hit.t, o[1] + d[1] * hit.t, o[2] + d[2] * hit.t];
    if (hit.kind === 'building' && hit.normal[2] === 0) {
      // Windows: a lit grid on the walls.
      const wx = (Math.floor(hit.u * 1.2) + 7) & 1;
      const wz = Math.floor(hit.v * 1.1);
      const inWin = (hit.u * 1.2) % 1 > 0.3 && (hit.v * 1.1) % 1 > 0.3 && hit.v > 0.8;
      if (inWin && (wx + wz) % 3 !== 0) base = [236, 214, 140];
    } else if (hit.kind === 'car' && p[2] > 0.62) {
      base = [28, 36, 48]; // glass
    } else if (hit.kind === 'person') {
      base = p[2] < 0.95 ? [40, 44, 66] : p[2] > 1.5 ? [226, 180, 150] : b.color;
    }
  }
  const light = 0.45 + 0.55 * lambert;
  const fog = Math.min(1, hit.t / 38);
  const haze = [150, 170, 190];
  return [0, 1, 2].map((i) => Math.round((base[i] * light) * (1 - fog) + haze[i] * fog));
}

function sky(yo) {
  // yo < 0 is above the horizon in the image.
  const k = Math.min(1, Math.max(0, 0.5 - yo * 0.8));
  return [Math.round(150 + (86 - 150) * k), Math.round(176 + (136 - 176) * k), Math.round(200 + (214 - 200) * k)];
}

/** Render the camera's view as an RGB8 buffer, with the lens distortion baked in like a real raw image. */
export function renderCamera(pose) {
  const o = mountWorld(pose, CAMERA_MOUNT);
  const out = new Uint8Array(CAM.w * CAM.h * 3);
  for (let v = 0; v < CAM.h; v++) {
    for (let u = 0; u < CAM.w; u++) {
      const [xn, yn] = undistortNormalised((u + 0.5 - CAM.cx) / CAM.fx, (v + 0.5 - CAM.cy) / CAM.fy, CAM.d);
      const d = cameraDir(pose.yaw, xn, yn);
      const hit = castRay(o, d, 80);
      const c = hit ? shade(hit, o, d) : sky(yn);
      const i = (v * CAM.w + u) * 3;
      out[i] = c[0];
      out[i + 1] = c[1];
      out[i + 2] = c[2];
    }
  }
  return out;
}

// ── Detector ────────────────────────────────────────────────────────────
/**
 * What a 2D detector would report for this view: one box per car or person
 * that is in front of the camera, close enough, and actually visible (the ray
 * to its centre reaches it).
 */
export function detect(pose, frame) {
  const o = mountWorld(pose, CAMERA_MOUNT);
  const c = Math.cos(pose.yaw);
  const s = Math.sin(pose.yaw);
  const out = [];
  WORLD.forEach((b, index) => {
    const cls = DETECTABLE[b.label];
    if (!cls) return;
    const centre = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const rel = [centre[0] - o[0], centre[1] - o[1], centre[2] - o[2]];
    const dist = Math.hypot(...rel);
    if (dist > 14) return;
    const dir = rel.map((x) => x / dist);
    const hit = castRay(o, dir, dist + 1);
    if (!hit || hit.index !== index) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let behind = false;
    for (const x of [b.min[0], b.max[0]]) {
      for (const y of [b.min[1], b.max[1]]) {
        for (const z of [b.min[2], b.max[2]]) {
          const w = [x - o[0], y - o[1], z - o[2]];
          // world -> base_link -> optical
          const bx = w[0] * c + w[1] * s;
          const by = -w[0] * s + w[1] * c;
          const zo = bx;
          if (zo <= 0.05) {
            behind = true;
            continue;
          }
          const [px, py] = projectToPixel(-by / zo, -w[2] / zo);
          x0 = Math.min(x0, px);
          y0 = Math.min(y0, py);
          x1 = Math.max(x1, px);
          y1 = Math.max(y1, py);
        }
      }
    }
    if (behind) return;
    x0 = Math.max(0, x0);
    y0 = Math.max(0, y0);
    x1 = Math.min(CAM.w, x1);
    y1 = Math.min(CAM.h, y1);
    if (x1 - x0 < 4 || y1 - y0 < 4) return;
    out.push({
      cls,
      score: Math.round((0.99 - dist * 0.018 - hash01(frame, index, 9) * 0.05) * 100) / 100,
      cx: (x0 + x1) / 2,
      cy: (y0 + y1) / 2,
      w: x1 - x0,
      h: y1 - y0,
    });
  });
  return out;
}

// ── Occupancy ───────────────────────────────────────────────────────────
/** Is the ground cell at (x, y) covered by an obstacle? Used to build the SLAM map. */
export function occupiedAt(x, y) {
  for (const b of WORLD) {
    if (b.label === 'person' || b.label === 'cone') continue;
    if (x >= b.min[0] && x <= b.max[0] && y >= b.min[1] && y <= b.max[1]) return true;
  }
  return false;
}
