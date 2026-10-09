/**
 * 2D detections for the ImageViewer overlay.
 *
 * `vision_msgs` changed shape between releases and bags in the wild contain
 * all of them, so the parser accepts every layout rather than one:
 *
 *   - newer (ROS 2 Humble and later): `bbox.center.position.{x,y}`,
 *     `results[].hypothesis.{class_id, score}`
 *   - older (ROS 1 Noetic, ROS 2 Foxy/Galactic): `bbox.center.{x,y}` (a
 *     Pose2D), `results[].{id, score}`
 *
 * Pure and DOM-free so the layouts can be tested without a browser.
 */

type Obj = Record<string, unknown>;

export interface Detection2D {
  /** Box centre in image pixels. */
  cx: number;
  cy: number;
  /** Size in pixels. */
  w: number;
  h: number;
  /** Rotation about the centre in radians (Pose2D.theta); 0 for axis-aligned. */
  theta: number;
  /** Class label shown on the box ('' when the message carries none). */
  label: string;
  /** Best hypothesis score, or null when absent. */
  score: number | null;
  /** Stable key for colouring: boxes of one class share a colour. */
  classKey: string;
}

export interface ParsedDetections {
  /** header.stamp of the array as nanoseconds, or null when absent. */
  stampNs: bigint | null;
  detections: Detection2D[];
}

export function isDetection2DArrayType(type: string): boolean {
  return type === 'vision_msgs/Detection2DArray' || type === 'vision_msgs/msg/Detection2DArray';
}

function num(v: unknown): number | null {
  const n = typeof v === 'bigint' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** `header.stamp` as ns. Accepts ROS 2 (`nanosec`) and ROS 1 (`nsec`/`secs`) spellings. */
export function stampNs(value: unknown): bigint | null {
  const stamp = ((value as Obj | null | undefined)?.header as Obj | undefined)?.stamp as Obj | undefined;
  if (!stamp) return null;
  const sec = num(stamp.sec ?? stamp.secs);
  const nsec = num(stamp.nanosec ?? stamp.nsec ?? stamp.nsecs) ?? 0;
  if (sec === null) return null;
  return BigInt(Math.round(sec)) * 1_000_000_000n + BigInt(Math.round(nsec));
}

export function bestHypothesis(results: unknown): { label: string; score: number | null; classKey: string } {
  let best: { label: string; score: number | null; classKey: string } | null = null;
  if (Array.isArray(results)) {
    for (const r of results) {
      const o = r as Obj | null;
      if (!o) continue;
      const hyp = (o.hypothesis as Obj | undefined) ?? o;
      const classId = hyp.class_id ?? hyp.id ?? o.class_id ?? o.id;
      const label =
        typeof classId === 'string' ? classId : classId !== undefined && classId !== null ? `#${String(classId)}` : '';
      const score = num(hyp.score ?? o.score);
      // Highest score wins; a scored hypothesis beats an unscored one.
      if (!best || (score ?? -Infinity) > (best.score ?? -Infinity)) {
        best = { label, score, classKey: label || '?' };
      }
    }
  }
  return best ?? { label: '', score: null, classKey: '?' };
}

/** Parse a `Detection2DArray` message value. Malformed boxes are skipped, never thrown on. */
export function parseDetection2DArray(value: Obj | null | undefined): ParsedDetections {
  const out: Detection2D[] = [];
  const list = value?.detections;
  if (Array.isArray(list)) {
    for (const raw of list) {
      const det = raw as Obj | null;
      const bbox = det?.bbox as Obj | undefined;
      const center = bbox?.center as Obj | undefined;
      if (!bbox || !center) continue;
      const pos = (center.position as Obj | undefined) ?? center;
      const cx = num(pos.x);
      const cy = num(pos.y);
      const w = num(bbox.size_x);
      const h = num(bbox.size_y);
      if (cx === null || cy === null || w === null || h === null || w < 0 || h < 0) continue;
      const hyp = bestHypothesis(det?.results);
      out.push({ cx, cy, w, h, theta: num(center.theta) ?? 0, ...hyp });
    }
  }
  return { stampNs: stampNs(value), detections: out };
}

/** The four corners of a box, rotated about its centre by `theta`. */
export function boxCorners(d: Detection2D): Array<[number, number]> {
  const hw = d.w / 2;
  const hh = d.h / 2;
  const c = Math.cos(d.theta);
  const s = Math.sin(d.theta);
  return ([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]] as const).map(
    ([x, y]) => [d.cx + x * c - y * s, d.cy + x * s + y * c] as [number, number],
  );
}

const CLASS_PALETTE = [
  '#f43f5e', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ec4899', '#84cc16', '#0ea5e9', '#f97316', '#14b8a6',
];

/** Stable colour for a class: the same label is the same colour in every frame and panel. */
export function classColor(classKey: string): string {
  let h = 2166136261;
  for (let i = 0; i < classKey.length; i++) {
    h ^= classKey.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return CLASS_PALETTE[(h >>> 0) % CLASS_PALETTE.length]!;
}

export interface Freshness {
  /** Whether the boxes describe this image closely enough to draw. */
  fresh: boolean;
  /** Signed detection minus image time, or null when either stamp is missing. */
  deltaNs: bigint | null;
}

/**
 * Do these detections belong to this image?
 *
 * Detectors normally copy the image's header stamp, so the stamps match
 * exactly for the frame they processed. Images between detector outputs (a 10
 * Hz detector on a 30 Hz camera) are matched to the nearest output within
 * `toleranceNs`, and anything older is hidden: a stale box on a moving object
 * is worse than no box. Missing stamps cannot be compared, so they draw.
 */
export function detectionFreshness(
  detectionStamp: bigint | null,
  imageStamp: bigint | null,
  toleranceNs: bigint,
): Freshness {
  if (detectionStamp === null || imageStamp === null) return { fresh: true, deltaNs: null };
  const deltaNs = detectionStamp - imageStamp;
  const abs = deltaNs < 0n ? -deltaNs : deltaNs;
  return { fresh: abs <= toleranceNs, deltaNs };
}
