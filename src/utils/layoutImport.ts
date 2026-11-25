/**
 * Open a Foxglove (or Lichtblick) layout JSON or a PlotJuggler layout XML and
 * map it onto BAGEL panels for the bag that is loaded: the split tree, each
 * panel's kind and topic, and a plot's fields. Topics the bag does not have,
 * and panels BAGEL has no equivalent for, are left out and listed in `notes`.
 *
 * Formats, as found in published layouts (Nav2, Autoware, Isaac ROS,
 * ros2_control_demos, PlotJuggler's own fixtures):
 * - Foxglove: `layout` is a mosaic tree (a panel id, or `{ first, second,
 *   direction: 'row' | 'column' }`), `configById` holds each panel's config
 *   keyed `Kind!id`. A `Tab` panel holds `tabs[].layout` trees of its own.
 * - PlotJuggler: `<Tab>`s of nested `<DockSplitter orientation="-|">` with a
 *   `<plot>` per `<DockArea>`. Curves are `name="/topic/field/sub"` (classic)
 *   or `topic` + `field` attributes (pj4); XY curves add `curve_x`/`curve_y`.
 */

import { parseXml, type XmlElement } from '../parsers/urdf';
import { panelLeafId, type LayoutNode, type PanelKind, type PanelLeaf, type SplitOrientation } from '../store/layoutStore';
import type { TopicInfo } from '../types/bag';
import { panelOptionsFor } from './panelOptions';
import type { ExtraSeriesDef, TimeSeriesPanelSettings } from '../store/panelUiStores';

export interface ImportedLayout {
  source: 'foxglove' | 'plotjuggler';
  root: LayoutNode | null;
  /** Plot settings per created panel id. */
  plots: Record<string, Partial<TimeSeriesPanelSettings>>;
  /** What was left out, and why, for the user. */
  notes: string[];
}

/** A panel before it has an id: kind, topic, and for a plot its fields as full paths. */
interface Spec {
  kind: PanelKind;
  topic: string;
  /** Plot only: [topic, field] pairs, first on `topic`. */
  fields?: Array<[string, string]>;
  /** Plot only: plot `fields[1]` against `fields[0]`. */
  xy?: boolean;
}
type Tree = Spec | { split: SplitOrientation; children: Tree[] } | null;

/**
 * Split a message path into the bag topic it starts with and the field after
 * it, in BAGEL's `a.b[0]` form. The longest matching topic wins, so
 * `/a/b/x` finds `/a/b` over `/a`. `sep` is what follows the topic: `.` for
 * Foxglove, `/` for PlotJuggler (whose field parts are also `/`-joined).
 */
export function splitPath(path: string, topics: ReadonlyArray<string>, sep: '.' | '/'): [string, string] | null {
  let best: string | null = null;
  for (const t of topics) {
    if ((path === t || path.startsWith(t + sep) || path.startsWith(t + '[')) && (!best || t.length > best.length)) best = t;
  }
  if (!best) return null;
  let field = path.slice(best.length).replace(/^[./]/, '');
  if (sep === '/') field = field.replace(/\//g, '.');
  field = field.replace(/\.(\d+)(?=\.|$)/g, '[$1]'); // position.0 -> position[0]
  return [best, field];
}

export function importLayout(text: string, topics: ReadonlyArray<TopicInfo>, bagId?: string): ImportedLayout {
  const notes: string[] = [];
  const note = (n: string) => {
    if (!notes.includes(n)) notes.push(n);
  };
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) return finish('foxglove', foxgloveTree(JSON.parse(text) as Json, topics, note), topics, notes, bagId);
  if (trimmed.startsWith('<')) return finish('plotjuggler', plotJugglerTree(parseXml(text), topics, note), topics, notes, bagId);
  throw new Error('Not a layout: expected Foxglove JSON or PlotJuggler XML.');
}

function finish(source: ImportedLayout['source'], tree: Tree, topics: ReadonlyArray<TopicInfo>, notes: string[], bagId?: string): ImportedLayout {
  const typeOf = new Map(topics.map((t) => [t.name, t.type]));
  const plots: Record<string, Partial<TimeSeriesPanelSettings>> = {};
  const byId = new Map<string, Spec>();
  let seq = 0;

  const build = (t: Tree): LayoutNode | null => {
    if (!t) return null;
    if ('split' in t) {
      const children = t.children.map(build).filter((c): c is LayoutNode => c !== null);
      if (children.length === 0) return null;
      if (children.length === 1) return children[0]!;
      return { node: 'split', id: `split:import:${++seq}`, orientation: t.split, children };
    }
    const id = panelLeafId(t.kind, t.topic, bagId);
    const seen = byId.get(id);
    if (seen) {
      // One panel per kind and topic in BAGEL: a second plot of the topic joins the first.
      if (t.fields && seen.fields) seen.fields.push(...t.fields.filter(([a, b]) => !seen.fields!.some(([c, d]) => a === c && b === d)));
      merged.set(id, (merged.get(id) ?? 1) + 1);
      return null;
    }
    byId.set(id, t);
    const leaf: PanelLeaf = { node: 'panel', id, kind: t.kind, topicName: t.topic, type: typeOf.get(t.topic) ?? '', ...(bagId ? { bagId } : {}) };
    return leaf;
  };
  const merged = new Map<string, number>();
  const root = build(tree);
  for (const [id, n] of merged) {
    const spec = byId.get(id)!;
    notes.push(`${n} ${spec.kind} panels on ${spec.topic} became one (BAGEL shows each topic once per panel kind)${spec.kind === 'plot' ? '; all their fields are kept' : ''}.`);
  }

  for (const [id, spec] of byId) {
    if (spec.kind !== 'plot' || !spec.fields) continue;
    const own = spec.fields.filter(([t]) => t === spec.topic).map(([, f]) => f);
    const used = new Set(own);
    const extras: ExtraSeriesDef[] = [];
    for (const [topic, field] of spec.fields) {
      if (topic === spec.topic) continue;
      let alias = `${topic.split('/').filter(Boolean).pop() ?? topic}.${field}`;
      for (let k = 2; used.has(alias); k++) alias = `${topic.split('/').filter(Boolean).pop()}.${field}#${k}`;
      used.add(alias);
      extras.push({ id: `import-${++seq}`, bagId: bagId ?? '', topic, field, alias });
    }
    const settings: Partial<TimeSeriesPanelSettings> = { onlyFields: own };
    if (extras.length && bagId) settings.extraSeries = extras;
    else if (extras.length) notes.push(`Fields from other topics on the ${spec.topic} plot need a bag id and were left out.`);
    if (spec.xy) {
      if (own.length >= 2) settings.xyX = own[0]!;
      else notes.push(`The XY plot on ${spec.topic} mixes topics, so it opens as a time plot.`);
    }
    plots[id] = settings;
  }
  if (!root) notes.push('Nothing in the layout matched a topic in this bag.');
  return { source, root, plots, notes };
}

/** The kind to use for `topic`, if BAGEL can show it as `want` (or, failing that, anything). */
function kindFor(want: PanelKind, topic: string, topics: ReadonlyArray<TopicInfo>): PanelKind | null {
  const info = topics.find((t) => t.name === topic);
  if (!info) return null;
  const options = panelOptionsFor(info);
  return options.includes(want) ? want : null;
}

// --- Foxglove ---------------------------------------------------------------

type Json = Record<string, unknown>;
const KIND_OF_FOXGLOVE: Record<string, PanelKind> = {
  '3D': '3d', ThreeDeeRender: '3d', Image: 'image', ImageViewPanel: 'image', Plot: 'plot', RawMessages: 'raw',
  RosOut: 'log', Log: 'log', DiagnosticSummary: 'diagnostic', DiagnosticStatusPanel: 'diagnostic', StateTransitions: 'state',
};

function foxgloveTree(doc: Json, topics: ReadonlyArray<TopicInfo>, note: (n: string) => void): Tree {
  const configById = (doc.configById ?? {}) as Record<string, Json>;
  const names = topics.map((t) => t.name);
  const firstOfType = (test: (type: string) => boolean) => topics.find((t) => test(t.type))?.name;

  const panel = (id: string): Tree => {
    const kindName = id.split('!')[0]!;
    const cfg = configById[id] ?? {};
    if (kindName === 'Tab') {
      const tabs = (cfg.tabs ?? []) as Json[];
      const tab = tabs[Number(cfg.activeTabIdx ?? 0)] ?? tabs[0];
      if (tabs.length > 1) note(`Only the open tab ("${String(tab?.title ?? '')}") of a tabbed layout is imported.`);
      return tab ? mosaic(tab.layout) : null;
    }
    const kind = KIND_OF_FOXGLOVE[kindName];
    if (!kind) {
      note(`${kindName} panels have no BAGEL equivalent and were left out.`);
      return null;
    }
    const want = (topic: string | undefined, k: PanelKind = kind): Tree => {
      if (!topic) return null;
      if (!names.includes(topic)) {
        note(`${topic} is not in this bag.`);
        return null;
      }
      const ok = kindFor(k, topic, topics);
      if (!ok) note(`${topic} cannot be shown as a ${k} panel.`);
      return ok ? { kind: ok, topic } : null;
    };
    switch (kind) {
      case 'image': {
        const mode = (cfg.imageMode ?? {}) as Json;
        return want((mode.imageTopic ?? cfg.cameraTopic) as string | undefined);
      }
      case 'raw': {
        const path = String(cfg.topicPath ?? '');
        return want(splitPath(path, names, '.')?.[0] ?? (path || undefined));
      }
      case 'diagnostic':
        return want((cfg.topicToRender as string | undefined) ?? firstOfType((t) => t.includes('DiagnosticArray')));
      case 'log':
        return want(firstOfType((t) => /rcl_interfaces\/(msg\/)?Log$|rosgraph_msgs\/(msg\/)?Log$/.test(t)));
      case '3d': {
        const layers = Object.entries((cfg.topics ?? {}) as Record<string, Json>).filter(([, c]) => c.visible !== false).map(([t]) => t);
        // BAGEL's 3D panel is built around one topic; prefer a point cloud, then any 3D-capable layer.
        const capable = layers.filter((t) => names.includes(t) && kindFor('3d', t, topics));
        const cloud = capable.find((t) => /PointCloud|LaserScan/.test(topics.find((x) => x.name === t)!.type));
        const pick = cloud ?? capable[0];
        if (!pick) {
          note('A 3D panel had no layer this bag can show.');
          return null;
        }
        return { kind: '3d', topic: pick };
      }
      case 'plot':
      case 'state': {
        const paths = ((cfg.paths ?? []) as Json[]).map((p) => String(p.value ?? '')).filter(Boolean);
        const fields: Array<[string, string]> = [];
        for (const p of paths) {
          if (/[{@]/.test(p)) {
            note(`Filters and modifiers in "${p}" are not supported; that series was left out.`);
            continue;
          }
          const split = splitPath(p, names, '.');
          if (!split) note(`${p.split('.')[0]} is not in this bag.`);
          else fields.push(split);
        }
        if (fields.length === 0) return null;
        if (kind === 'state') return want(fields[0]![0], 'state');
        return { kind: 'plot', topic: fields[0]![0], fields };
      }
      default:
        return null;
    }
  };

  const mosaic = (node: unknown): Tree => {
    if (typeof node === 'string') return panel(node);
    if (!node || typeof node !== 'object') return null;
    const n = node as Json;
    return { split: n.direction === 'column' ? 'vertical' : 'horizontal', children: [mosaic(n.first), mosaic(n.second)] };
  };

  return mosaic(doc.layout);
}

// --- PlotJuggler --------------------------------------------------------------

const kids = (el: XmlElement, name: string) => el.children.filter((c) => c.name === name);

function plotJugglerTree(root: XmlElement, topics: ReadonlyArray<TopicInfo>, note: (n: string) => void): Tree {
  const names = topics.map((t) => t.name);
  const widget = root.name === 'tabbed_widget' ? root : kids(root, 'tabbed_widget')[0];
  if (!widget) throw new Error('Not a PlotJuggler layout: no <tabbed_widget>.');
  const tabs = kids(widget, 'Tab');
  const current = Number(kids(widget, 'currentTabIndex')[0]?.attrs.index ?? 0);
  const tab = tabs[current] ?? tabs[0];
  if (tabs.length > 1) note(`Only the open tab ("${tab?.attrs.tab_name ?? ''}") of ${tabs.length} is imported.`);
  if (!tab) return null;

  const curvePath = (c: XmlElement, attr = 'name'): [string, string] | null => {
    // pj4 writes the topic and field apart; classic PlotJuggler writes one path.
    if (attr === 'name' && c.attrs.topic) {
      const topic = c.attrs.topic.startsWith('/') || names.includes(c.attrs.topic) ? c.attrs.topic : `/${c.attrs.topic}`;
      if (!names.includes(topic)) return null;
      return [topic, (c.attrs.field ?? '').replace(/\//g, '.')];
    }
    const path = c.attrs[attr];
    return path ? splitPath(path, names, '/') : null;
  };

  const area = (a: XmlElement): Tree => {
    const plot = kids(a, 'plot')[0];
    if (!plot) {
      const other = a.children[0]?.name;
      if (other) note(`PlotJuggler ${other} views have no BAGEL equivalent and were left out.`);
      return null;
    }
    const xy = plot.attrs.mode === 'XYPlot';
    const fields: Array<[string, string]> = [];
    for (const c of kids(plot, 'curve')) {
      const parts = xy && c.attrs.curve_x ? [curvePath(c, 'curve_x'), curvePath(c, 'curve_y')] : [curvePath(c)];
      for (const p of parts) {
        if (p) fields.push(p);
        else note(`${c.attrs.name ?? c.attrs.topic ?? 'A curve'} is not in this bag.`);
      }
    }
    if (fields.length === 0) return null;
    return { kind: 'plot', topic: fields[0]![0], fields, xy };
  };

  const splitter = (el: XmlElement): Tree => {
    const children = el.children.map((c) => (c.name === 'DockSplitter' ? splitter(c) : c.name === 'DockArea' ? area(c) : null));
    // "-" stacks its children top to bottom; "|" puts them side by side.
    return { split: el.attrs.orientation === '|' ? 'horizontal' : 'vertical', children };
  };

  const container = kids(tab, 'Container')[0];
  const top = container && kids(container, 'DockSplitter')[0];
  return top ? splitter(top) : null;
}
