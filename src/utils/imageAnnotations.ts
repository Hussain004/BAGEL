/**
 * `foxglove.ImageAnnotations`: circles, polylines, points and text drawn in
 * image pixels, as perception stacks publish them next to a camera. Parsed here
 * into plain shapes with CSS colours that the image viewer draws as SVG.
 */

type Obj = Record<string, unknown>;

export function isImageAnnotationsType(type: string): boolean {
  return type === 'foxglove.ImageAnnotations';
}

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Circle {
  kind: 'circle';
  x: number;
  y: number;
  /** Diameter in pixels. */
  diameter: number;
  thickness: number;
  fill: string | null;
  outline: string | null;
}

export interface Poly {
  kind: 'points' | 'loop' | 'strip' | 'list';
  points: Array<{ x: number; y: number }>;
  thickness: number;
  fill: string | null;
  /** One colour for the whole shape, or per-point colours when the message gave them. */
  outline: string | null;
  outlines: string[];
}

export interface Label {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  color: string;
  background: string | null;
}

export type Annotation = Circle | Poly | Label;

export interface ParsedAnnotations {
  shapes: Annotation[];
  /** The earliest `timestamp` among the shapes, in ns, or null when none carried one. */
  stampNs: bigint | null;
}

const POINTS_KIND: Record<string, Poly['kind']> = {
  '1': 'points', POINTS: 'points',
  '2': 'loop', LINE_LOOP: 'loop',
  '3': 'strip', LINE_STRIP: 'strip',
  '4': 'list', LINE_LIST: 'list',
};

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** A Foxglove colour (components 0 to 1) as CSS, or null when transparent or absent. */
export function cssColor(c: unknown): string | null {
  if (!c || typeof c !== 'object') return null;
  const o = c as Partial<Rgba>;
  const a = num(o.a, 1);
  if (a <= 0) return null;
  const ch = (v: unknown) => Math.round(Math.max(0, Math.min(1, num(v, 0))) * 255);
  return `rgba(${ch(o.r)}, ${ch(o.g)}, ${ch(o.b)}, ${Math.min(1, a).toFixed(3)})`;
}

function stampOf(t: unknown): bigint | null {
  if (!t || typeof t !== 'object') return null;
  const o = t as Obj;
  const sec = o.sec;
  const ns = o.nsec ?? o.nanosec ?? 0;
  if (typeof sec !== 'number' || typeof ns !== 'number') return null;
  return BigInt(Math.trunc(sec)) * 1_000_000_000n + BigInt(Math.trunc(ns));
}

function pt(v: unknown): { x: number; y: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Obj;
  const x = Number(o.x);
  const y = Number(o.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

const list = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Obj[]) : []);

export const MAX_SHAPES = 5000;

export function parseImageAnnotations(value: Obj | null | undefined): ParsedAnnotations {
  const shapes: Annotation[] = [];
  let stamp: bigint | null = null;
  const see = (t: unknown) => {
    const s = stampOf(t);
    if (s !== null && (stamp === null || s < stamp)) stamp = s;
  };
  if (!value) return { shapes, stampNs: null };

  for (const c of list(value.circles)) {
    const p = pt(c.position);
    if (!p) continue;
    see(c.timestamp);
    shapes.push({
      kind: 'circle', x: p.x, y: p.y, diameter: Math.max(0, num(c.diameter)), thickness: Math.max(0, num(c.thickness, 1)),
      fill: cssColor(c.fill_color), outline: cssColor(c.outline_color),
    });
  }
  for (const p of list(value.points)) {
    const kind = POINTS_KIND[String(p.type)];
    if (!kind) continue; // UNKNOWN (0) or something newer: nothing sensible to draw
    const points = (Array.isArray(p.points) ? p.points : []).map(pt).filter((x): x is { x: number; y: number } => x !== null);
    if (points.length === 0) continue;
    see(p.timestamp);
    const outlines = (Array.isArray(p.outline_colors) ? p.outline_colors : []).map(cssColor);
    shapes.push({
      kind, points, thickness: Math.max(0, num(p.thickness, 1)), fill: cssColor(p.fill_color), outline: cssColor(p.outline_color),
      // Per-point colours only count if there is one for every point.
      outlines: outlines.length === points.length && outlines.every((c) => c !== null) ? (outlines as string[]) : [],
    });
  }
  for (const t of list(value.texts)) {
    const p = pt(t.position);
    const text = typeof t.text === 'string' ? t.text : '';
    if (!p || !text) continue;
    see(t.timestamp);
    shapes.push({ kind: 'text', x: p.x, y: p.y, text, fontSize: Math.max(1, num(t.font_size, 12)), color: cssColor(t.text_color) ?? 'rgba(255, 255, 255, 1)', background: cssColor(t.background_color) });
  }
  return { shapes: shapes.slice(0, MAX_SHAPES), stampNs: stamp };
}
