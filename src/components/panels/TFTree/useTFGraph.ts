/**
 * useTFGraph — Build the ROS2 transform graph from /tf and /tf_static, then
 * expose a `lookupTransform(parent, child, timeNs)` for time-resolved queries.
 *
 * We aggregate both topics into a single graph: /tf_static contributes a
 * single fixed transform per edge, /tf contributes a time-ordered list of
 * samples per edge. Lookups binary-search the per-edge list and pick the
 * nearest sample to the playhead, with static transforms always available
 * as a fallback when no dynamic data has been recorded yet.
 *
 * v0.9.x: decode goes through `useTopicMessages` so the per-topic message
 * cache + shared in-flight decode protect against the panel-rearrange
 * re-decode regression — a /tf with 100k messages used to fully re-decode
 * every time a sibling panel was added/removed because the unmount cleanup
 * threw away the worker's result before it could be cached.
 */
import { useMemo } from 'react';
import { useBagStore } from '../../../store/bagStore';
import { useTopicMessages, type DecodedMessage } from '../../../hooks/useTopicMessages';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface TFSample {
  /** Header stamp converted to ns since epoch. Falls back to the log time. */
  t: bigint;
  translation: Vec3;
  rotation: Quat;
}

export interface TFEdge {
  parent: string;
  child: string;
  samples: TFSample[];
  /** True if this edge came from /tf_static (single fixed sample). */
  isStatic: boolean;
}

export interface TFGraph {
  edges: Map<string, TFEdge>; // keyed by `${parent}>${child}`
  /** parent → child names, for tree layout. */
  children: Map<string, string[]>;
  /** child → parent name (or undefined for roots). */
  parentOf: Map<string, string | undefined>;
  /** Every frame name seen. */
  frames: Set<string>;
  /** Roots — frames that are referenced as parents but never as children. */
  roots: string[];
}

export interface UseTFGraphResult {
  graph: TFGraph | null;
  loading: boolean;
  error: string | null;
  /** True if neither /tf nor /tf_static is present in the bag. */
  missing: boolean;
  /** Decoded message counts so the loader can show progress. */
  progress: { tf: number; tf_static: number };
}

const STATIC_TOPIC_NAMES = ['/tf_static', 'tf_static'];
const DYNAMIC_TOPIC_NAMES = ['/tf', 'tf'];
const TF_LIMIT = 200_000;

function isTfMessageType(type: string): boolean {
  return type.endsWith('/TFMessage') || type === 'tf2_msgs/msg/TFMessage';
}

/** Try to coerce `header.stamp.{sec,nanosec}` to ns. Falls back to logTime. */
function stampNs(header: unknown, fallback: bigint): bigint {
  if (!header || typeof header !== 'object') return fallback;
  const h = header as { stamp?: { sec?: unknown; nanosec?: unknown } };
  const sec = h.stamp?.sec;
  const ns = h.stamp?.nanosec;
  if (typeof sec === 'number' && typeof ns === 'number') {
    return BigInt(sec) * 1_000_000_000n + BigInt(ns);
  }
  if (typeof sec === 'bigint' && typeof ns === 'bigint') {
    return sec * 1_000_000_000n + ns;
  }
  return fallback;
}

/** Pull a sane Vec3 / Quat out of a deserialized message. */
function vec3(v: unknown): Vec3 {
  const o = (v ?? {}) as { x?: unknown; y?: unknown; z?: unknown };
  return {
    x: Number(o.x) || 0,
    y: Number(o.y) || 0,
    z: Number(o.z) || 0,
  };
}
function quat(v: unknown): Quat {
  const o = (v ?? {}) as { x?: unknown; y?: unknown; z?: unknown; w?: unknown };
  const w = Number(o.w);
  return {
    x: Number(o.x) || 0,
    y: Number(o.y) || 0,
    z: Number(o.z) || 0,
    w: Number.isFinite(w) ? w : 1,
  };
}

function edgeKey(parent: string, child: string): string {
  return `${parent}>${child}`;
}

interface TopicMatch {
  name: string;
  type: string;
}

export function findTfTopic(
  topicList: { name: string; type: string }[],
  candidates: string[],
  preferredTopicName?: string,
): TopicMatch | null {
  const matches = topicList.filter(
    (topic) =>
      isTfMessageType(topic.type) &&
      candidates.some(
        (candidate) =>
          topic.name === candidate || topic.name.endsWith(candidate),
      ),
  );
  if (matches.length === 0) return null;

  const namespaceScore = (name: string): number => {
    if (!preferredTopicName) {
      return candidates.includes(name) ? Number.MAX_SAFE_INTEGER : 0;
    }
    const topicParts = name.split('/');
    const preferredParts = preferredTopicName.split('/');
    let score = 0;
    const count = Math.min(topicParts.length, preferredParts.length);
    while (score < count && topicParts[score] === preferredParts[score]) score++;
    return score;
  };
  matches.sort((a, b) => {
    const score = namespaceScore(b.name) - namespaceScore(a.name);
    return score || a.name.localeCompare(b.name);
  });
  return matches[0] ?? null;
}

/**
 * Walk TFMessages, collect samples into per-edge arrays, derive roots, and
 * return a graph the panel can lay out and query.
 */
function ingestMessages(
  messages: DecodedMessage[],
  edges: Map<string, TFEdge>,
  children: Map<string, string[]>,
  parentOf: Map<string, string | undefined>,
  frames: Set<string>,
  isStatic: boolean,
): void {
  for (const msg of messages) {
    const value = msg.value;
    if (!value) continue;
    const transforms = value.transforms;
    if (!Array.isArray(transforms)) continue;
    for (const t of transforms as Array<Record<string, unknown>>) {
      const childId = String(t.child_frame_id ?? '');
      const header = t.header as { frame_id?: unknown } | undefined;
      const parentId = String(header?.frame_id ?? '');
      if (!childId || !parentId) continue;

      frames.add(childId);
      frames.add(parentId);

      const key = edgeKey(parentId, childId);
      let edge = edges.get(key);
      if (!edge) {
        edge = { parent: parentId, child: childId, samples: [], isStatic };
        edges.set(key, edge);
        const arr = children.get(parentId);
        if (arr) {
          if (!arr.includes(childId)) arr.push(childId);
        } else {
          children.set(parentId, [childId]);
        }
        const existingParent = parentOf.get(childId);
        if (!existingParent) parentOf.set(childId, parentId);
      } else if (isStatic && edge.samples.length > 0) {
        // /tf_static should publish each edge exactly once; if it doesn't,
        // keep the first observation and drop later duplicates.
        continue;
      }

      const transform = t.transform as
        | { translation?: unknown; rotation?: unknown }
        | undefined;
      edge.samples.push({
        t: stampNs(header, msg.timestamp),
        translation: vec3(transform?.translation),
        rotation: quat(transform?.rotation),
      });
    }
  }
}

export function useTFGraph(
  bagId?: string,
  preferredTopicName?: string,
): UseTFGraphResult {
  const entry = useBagStore((s) => {
    if (bagId) {
      const explicit = s.bags.get(bagId);
      if (explicit) return explicit;
    }
    return s.focusBagId ? s.bags.get(s.focusBagId) ?? null : null;
  });

  const tfTopics = useMemo(() => {
    if (!entry) {
      return {
        dynamic: null as TopicMatch | null,
        staticTopic: null as TopicMatch | null,
      };
    }
    const dynamic = findTfTopic(
      entry.summary.topics,
      DYNAMIC_TOPIC_NAMES,
      preferredTopicName,
    );
    return {
      dynamic,
      staticTopic: findTfTopic(
        entry.summary.topics,
        STATIC_TOPIC_NAMES,
        dynamic?.name ?? preferredTopicName,
      ),
    };
  }, [entry, preferredTopicName]);

  const missing = !tfTopics.dynamic && !tfTopics.staticTopic;

  // Both topic streams go through useTopicMessages so the cache + shared
  // in-flight decode survives panel rearrange remounts. Empty topic name +
  // enabled=false stays inert when a bag has only one of the two.
  const dynStream = useTopicMessages(
    tfTopics.dynamic?.name ?? '',
    TF_LIMIT,
    !!tfTopics.dynamic,
    bagId,
  );
  const staticStream = useTopicMessages(
    tfTopics.staticTopic?.name ?? '',
    TF_LIMIT,
    !!tfTopics.staticTopic,
    bagId,
  );

  const error = dynStream.error ?? staticStream.error ?? null;
  // We only consider the graph ready once both sides have completed (or are
  // intentionally absent). Building a partial graph mid-stream would force a
  // full re-layout on every batch — not worth it for TF, which is typically
  // bounded at a few thousand edges even on a 100k-message bag.
  const dynReady = !tfTopics.dynamic || (!dynStream.loading && dynStream.messages !== null);
  const staticReady =
    !tfTopics.staticTopic || (!staticStream.loading && staticStream.messages !== null);
  const loading = !missing && !error && !(dynReady && staticReady);

  const progress = {
    tf: dynStream.progress,
    tf_static: staticStream.progress,
  };

  const graph = useMemo<TFGraph | null>(() => {
    if (loading || missing || error) return null;
    const edges = new Map<string, TFEdge>();
    const childrenMap = new Map<string, string[]>();
    const parentOf = new Map<string, string | undefined>();
    const frames = new Set<string>();

    // /tf_static first so dynamic samples never override the static fallback
    // that newer ingest passes would otherwise displace.
    if (staticStream.messages) {
      ingestMessages(staticStream.messages, edges, childrenMap, parentOf, frames, true);
    }
    if (dynStream.messages) {
      ingestMessages(dynStream.messages, edges, childrenMap, parentOf, frames, false);
    }

    // Per-edge samples are time-ordered (the bag usually emits in order, but
    // /tf_static + /tf merging or out-of-order recording can break that).
    for (const edge of edges.values()) {
      edge.samples.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
    }

    const roots: string[] = [];
    for (const frame of frames) {
      if (!parentOf.get(frame)) roots.push(frame);
    }
    roots.sort();

    return { edges, children: childrenMap, parentOf, frames, roots };
  }, [loading, missing, error, dynStream.messages, staticStream.messages]);

  return { graph, loading, error, missing, progress };
}

/** Binary search a per-edge sample list for the entry nearest `timeNs`. */
export function lookupTransform(edge: TFEdge, timeNs: bigint): TFSample | null {
  const s = edge.samples;
  if (s.length === 0) return null;
  if (s.length === 1) return s[0];
  let lo = 0;
  let hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t < timeNs) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const a = s[lo - 1].t;
    const b = s[lo].t;
    if (timeNs - a < b - timeNs) return s[lo - 1];
  }
  return s[lo];
}

/** Walk from `frame` back to the closest root, returning the chain (root → frame). */
export function chainToRoot(graph: TFGraph, frame: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = frame;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = graph.parentOf.get(cur);
  }
  return out.reverse();
}
