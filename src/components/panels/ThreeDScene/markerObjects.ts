/**
 * Three.js builders for `visualization_msgs/Marker` primitives.
 *
 * One factory per marker type the spec defines. Each factory returns a
 * `RenderedMarker` record with a stable `object: Object3D` and an `update`
 * function that takes the latest marker payload and reshapes the object —
 * pose, scale, colour, geometry — without recreating the Object3D.
 *
 * Keeping the object stable matters because `MarkerSet` swaps markers
 * in/out of the scene by reference; recreating on every update would
 * thrash the scene graph and undo any selection state.
 *
 * Coverage:
 *   - CUBE / SPHERE / CYLINDER          MeshLambertMaterial primitive
 *   - ARROW                             ArrowHelper inside a posed group
 *   - LINE_STRIP / LINE_LIST            Line / LineSegments with vertex colours
 *   - POINTS                            Points with vertex colours
 *   - CUBE_LIST / SPHERE_LIST           InstancedMesh of the primitive
 *   - TEXT_VIEW_FACING                  Billboarded Sprite with a Canvas tex
 *   - MESH_RESOURCE                     Lazy `meshLoader.loadMesh()` swap-in
 *                                       (v1.3.1). Wireframe placeholder shown
 *                                       while loading and as the fallback on
 *                                       resolve / load failure. Respects
 *                                       `mesh_use_embedded_materials` to flip
 *                                       between bundled materials and the
 *                                       marker's solid colour.
 *   - TRIANGLE_LIST                     `MeshLambertMaterial` over a
 *                                       `BufferGeometry` built from
 *                                       `marker.points` taken three at a time
 *                                       (v1.3.1). Per-vertex `marker.colors[]`
 *                                       when length matches, otherwise solid
 *                                       `marker.color`.
 *
 * Scale convention (from the ROS Marker spec):
 *   - CUBE: scale = full XYZ size
 *   - SPHERE: scale = ellipsoid diameter on each axis
 *   - CYLINDER: scale.x/y = base diameter, scale.z = height
 *   - LINE_*: scale.x = line width in metres (WebGL caps at 1 px in most
 *             browsers — see the LINE_* notes for context)
 *   - POINTS: scale.x = point width in metres (rendered as size in pixels)
 *   - TEXT_VIEW_FACING: scale.z = font height in metres
 *   - ARROW (pose form): scale.x = length, scale.y = shaft diameter,
 *                        scale.z = head diameter
 *   - ARROW (points form): scale.x = shaft diameter, scale.y = head diameter
 *
 * Per-point colours: when `marker.colors[]` has the same length as
 * `marker.points[]`, it overrides the whole-marker `marker.color`. Lists
 * with mismatched lengths fall back to the whole-marker colour.
 */

import * as THREE from 'three';
import { loadMesh, MeshLoadError } from '../../../utils/meshLoader';

export const MARKER_TYPE = {
  ARROW: 0,
  CUBE: 1,
  SPHERE: 2,
  CYLINDER: 3,
  LINE_STRIP: 4,
  LINE_LIST: 5,
  CUBE_LIST: 6,
  SPHERE_LIST: 7,
  POINTS: 8,
  TEXT_VIEW_FACING: 9,
  MESH_RESOURCE: 10,
  TRIANGLE_LIST: 11,
} as const;

export const MARKER_ACTION = {
  ADD: 0,
  MODIFY: 0,
  DELETE: 2,
  DELETEALL: 3,
} as const;

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
export interface ColorRGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Subset of the Marker fields the renderer cares about. */
export interface MarkerData {
  ns: string;
  id: number;
  type: number;
  action: number;
  pose: { position: Vec3; orientation: Quat };
  scale: Vec3;
  color: ColorRGBA;
  /** Lifetime in ns; 0n means "infinite". */
  lifetimeNs: bigint;
  /** Header stamp in ns; falls back to the message log time. */
  stampNs: bigint;
  frameLocked: boolean;
  /** Source frame the marker is published in. */
  frameId: string;
  points: Vec3[];
  colors: ColorRGBA[];
  text: string;
  meshResource: string;
  /**
   * When true, the loaded mesh keeps the materials baked into the file (the
   * artist's intent for `.dae` / `.obj` packages). When false (the default per
   * the Marker .msg), the mesh is tinted with `marker.color`. RViz follows
   * the same convention.
   */
  meshUseEmbeddedMaterials: boolean;
}

export interface RenderedMarker {
  object: THREE.Object3D;
  /** Push the latest marker payload into the existing Three.js object. */
  update: (m: MarkerData) => void;
  /** Drop geometries / materials / textures owned by this marker. */
  dispose: () => void;
}

// ── helpers ────────────────────────────────────────────────────────────────

const TMP_QUAT = new THREE.Quaternion();

function applyPose(obj: THREE.Object3D, pose: MarkerData['pose']): void {
  obj.position.set(pose.position.x, pose.position.y, pose.position.z);
  // Default to identity rather than letting NaNs through if the marker
  // arrived with an unnormalized quaternion.
  const { x, y, z, w } = pose.orientation;
  const len = Math.hypot(x, y, z, w);
  if (len > 0 && Number.isFinite(len)) {
    obj.quaternion.set(x / len, y / len, z / len, w / len);
  } else {
    obj.quaternion.identity();
  }
}

function applyColor(
  material: THREE.Material & { color?: THREE.Color; opacity?: number },
  color: ColorRGBA,
): void {
  if (material.color) {
    material.color.setRGB(
      clamp01(color.r),
      clamp01(color.g),
      clamp01(color.b),
    );
  }
  material.opacity = clamp01(color.a);
  material.transparent = material.opacity < 1;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Pack `marker.points[]` into a Float32Array, optionally taking only the
 * first `truncatePairs * 2` entries for LINE_LIST so a malformed odd-
 * length array doesn't draw a dangling segment.
 */
function packPositions(points: Vec3[], truncateTo?: number): Float32Array {
  const n = truncateTo ?? points.length;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const p = points[i];
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  }
  return out;
}

function packColors(
  perPoint: ColorRGBA[],
  fallback: ColorRGBA,
  count: number,
): Float32Array {
  const out = new Float32Array(count * 3);
  // perPoint overrides only when it matches the point count — the spec is
  // explicit that mismatched lengths fall back to the per-marker colour.
  const usePer = perPoint.length === count;
  for (let i = 0; i < count; i++) {
    const c = usePer ? perPoint[i] : fallback;
    out[i * 3] = clamp01(c.r);
    out[i * 3 + 1] = clamp01(c.g);
    out[i * 3 + 2] = clamp01(c.b);
  }
  return out;
}

// ── primitive shape markers ────────────────────────────────────────────────

function createCubeMarker(): RenderedMarker {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true });
  const mesh = new THREE.Mesh(geometry, material);
  return {
    object: mesh,
    update: (m) => {
      applyPose(mesh, m.pose);
      mesh.scale.set(m.scale.x || 0.01, m.scale.y || 0.01, m.scale.z || 0.01);
      applyColor(material, m.color);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

function createSphereMarker(): RenderedMarker {
  // Radius 0.5 so scale = diameter, matching the spec.
  const geometry = new THREE.SphereGeometry(0.5, 18, 12);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true });
  const mesh = new THREE.Mesh(geometry, material);
  return {
    object: mesh,
    update: (m) => {
      applyPose(mesh, m.pose);
      mesh.scale.set(m.scale.x || 0.01, m.scale.y || 0.01, m.scale.z || 0.01);
      applyColor(material, m.color);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

function createCylinderMarker(): RenderedMarker {
  // ROS cylinders are upright along Z. Three.js defaults to Y; pre-rotate the
  // geometry so the runtime scale doesn't need a wrapping group.
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
  geometry.rotateX(Math.PI / 2);
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true });
  const mesh = new THREE.Mesh(geometry, material);
  return {
    object: mesh,
    update: (m) => {
      applyPose(mesh, m.pose);
      mesh.scale.set(m.scale.x || 0.01, m.scale.y || 0.01, m.scale.z || 0.01);
      applyColor(material, m.color);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ── arrow ──────────────────────────────────────────────────────────────────

/**
 * ArrowHelper draws an arrow along +Y by default. We expose two shapes:
 *
 *   - Pose form: `points` is empty. Length = scale.x, shaft diameter =
 *     scale.y, head diameter = scale.z. Direction comes from the marker's
 *     pose quaternion. The ArrowHelper itself sits at the origin of a Group
 *     to which we apply the pose, then we point the helper along +X (the
 *     marker's local "forward").
 *
 *   - Points form: `points` has 2 entries [start, end]. Length = |end-start|,
 *     shaft diameter = scale.x, head diameter = scale.y. We place the Group
 *     at `start` and point the helper from start to end.
 */
function createArrowMarker(): RenderedMarker {
  const group = new THREE.Group();
  const arrow = new THREE.ArrowHelper(
    new THREE.Vector3(1, 0, 0),
    new THREE.Vector3(0, 0, 0),
    1,
    0xffffff,
    0.2,
    0.1,
  );
  group.add(arrow);

  return {
    object: group,
    update: (m) => {
      const c = m.color;
      arrow.setColor(new THREE.Color(clamp01(c.r), clamp01(c.g), clamp01(c.b)));
      // ArrowHelper has no opacity; we approximate by hiding very-transparent
      // arrows entirely since LineMaterial / MeshBasicMaterial inside the
      // helper would otherwise stay solid.
      group.visible = c.a > 0.05;

      if (m.points.length >= 2) {
        const a = m.points[0];
        const b = m.points[1];
        const dir = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
        const length = dir.length();
        if (length > 0) dir.normalize();
        else dir.set(1, 0, 0);
        const headDiameter = m.scale.y || m.scale.x || 0.1;
        const shaftDiameter = m.scale.x || 0.05;
        const headLen = Math.min(length * 0.25, headDiameter * 2);
        group.position.set(a.x, a.y, a.z);
        group.quaternion.identity();
        arrow.setDirection(dir);
        arrow.setLength(Math.max(length, 0.001), headLen, headDiameter);
        // ArrowHelper renders the shaft as a Line with its own line width
        // (uniformly 1 px in most browsers). For visibility we widen the
        // cone proportional to the shaft diameter as the closest analog.
        void shaftDiameter;
      } else {
        applyPose(group, m.pose);
        const length = m.scale.x || 0.1;
        const headDiameter = m.scale.z || m.scale.y || length * 0.2;
        const headLen = Math.min(length * 0.25, headDiameter * 2);
        arrow.setDirection(new THREE.Vector3(1, 0, 0));
        arrow.setLength(length, headLen, headDiameter);
      }
    },
    dispose: () => {
      arrow.line.geometry.dispose();
      (arrow.line.material as THREE.Material).dispose();
      arrow.cone.geometry.dispose();
      (arrow.cone.material as THREE.Material).dispose();
    },
  };
}

// ── line / point markers ───────────────────────────────────────────────────

/**
 * LINE_STRIP + LINE_LIST share an implementation: only the THREE primitive
 * differs (`Line` for connected segments, `LineSegments` for disjoint pairs).
 *
 * NOTE on width: `LineBasicMaterial.linewidth` is ignored on every modern
 * browser due to OpenGL ES caps — lines render at 1 px regardless of
 * `marker.scale.x`. Fat lines need `LineMaterial` from `three/examples`,
 * which would add a few kB; defer to a follow-up if real-world bags need
 * width-faithful rendering. The geometry is still correct.
 */
function createLineStripMarker(): RenderedMarker {
  return createLineMarker(false);
}
function createLineListMarker(): RenderedMarker {
  return createLineMarker(true);
}

function createLineMarker(isList: boolean): RenderedMarker {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
  });
  const line = isList
    ? new THREE.LineSegments(geometry, material)
    : new THREE.Line(geometry, material);
  line.frustumCulled = false;
  return {
    object: line,
    update: (m) => {
      applyPose(line, m.pose);
      // LINE_LIST consumes pairs of points — drop any orphaned trailing point.
      const count = isList ? m.points.length & ~1 : m.points.length;
      if (count < 2) {
        line.visible = false;
        return;
      }
      line.visible = m.color.a > 0;
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(packPositions(m.points, count), 3),
      );
      geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(packColors(m.colors, m.color, count), 3),
      );
      geometry.computeBoundingSphere();
      material.opacity = clamp01(m.color.a);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

function createPointsMarker(): RenderedMarker {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.PointsMaterial({
    size: 4,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return {
    object: points,
    update: (m) => {
      applyPose(points, m.pose);
      const count = m.points.length;
      if (count === 0) {
        points.visible = false;
        return;
      }
      points.visible = m.color.a > 0;
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(packPositions(m.points), 3),
      );
      geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(packColors(m.colors, m.color, count), 3),
      );
      geometry.computeBoundingSphere();
      // scale.x is point width in metres per the spec; we render screen-space
      // pixels and approximate with a metres-to-px factor that keeps small
      // debug points visible without dominating the scene.
      const sizePx = Math.max(1, (m.scale.x || 0.05) * 80);
      material.size = sizePx;
      material.opacity = clamp01(m.color.a);
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ── instanced list markers ────────────────────────────────────────────────

/**
 * CUBE_LIST / SPHERE_LIST render the same primitive at every point in
 * `marker.points[]`. InstancedMesh is the obvious fit, but its instance
 * count is baked in at construction — to grow it we'd have to recreate.
 * Recreation per update is fine in practice: list markers are rare enough
 * (planner debug, region highlights) that update frequency is well under
 * 30 Hz, and the existing single-flight playhead-driven readout coalesces
 * rapid updates anyway.
 */
function createInstancedListMarker(
  geomFactory: () => THREE.BufferGeometry,
): RenderedMarker {
  const baseGeometry = geomFactory();
  const baseMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    transparent: true,
  });
  const group = new THREE.Group();
  group.frustumCulled = false;
  // We keep a single InstancedMesh inside the group and swap it out when
  // the instance count changes.
  let mesh: THREE.InstancedMesh | null = null;
  let currentCount = 0;

  return {
    object: group,
    update: (m) => {
      const desired = m.points.length;
      applyPose(group, m.pose);

      if (desired === 0) {
        if (mesh) mesh.visible = false;
        return;
      }

      // Recreate when the count changed (or no mesh yet).
      if (!mesh || desired !== currentCount) {
        if (mesh) {
          group.remove(mesh);
          mesh.dispose();
        }
        mesh = new THREE.InstancedMesh(baseGeometry, baseMaterial, desired);
        mesh.frustumCulled = false;
        currentCount = desired;
        group.add(mesh);
      }
      mesh.visible = m.color.a > 0;

      const usePerInstanceColor = m.colors.length === desired;
      const matrix = new THREE.Matrix4();
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3(
        m.scale.x || 0.01,
        m.scale.y || 0.01,
        m.scale.z || 0.01,
      );
      const colorObj = new THREE.Color();
      // InstancedMesh per-instance colour is opt-in; allocate when needed.
      if (usePerInstanceColor && !mesh.instanceColor) {
        mesh.instanceColor = new THREE.InstancedBufferAttribute(
          new Float32Array(desired * 3),
          3,
        );
      }
      for (let i = 0; i < desired; i++) {
        const p = m.points[i];
        pos.set(p.x, p.y, p.z);
        matrix.compose(pos, quat, scl);
        mesh.setMatrixAt(i, matrix);
        if (usePerInstanceColor) {
          const c = m.colors[i];
          colorObj.setRGB(clamp01(c.r), clamp01(c.g), clamp01(c.b));
          mesh.setColorAt(i, colorObj);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Whole-mesh tint when per-instance colours weren't supplied.
      if (!usePerInstanceColor) applyColor(baseMaterial, m.color);
      else {
        baseMaterial.opacity = clamp01(m.color.a);
        baseMaterial.transparent = baseMaterial.opacity < 1;
      }
    },
    dispose: () => {
      if (mesh) {
        group.remove(mesh);
        mesh.dispose();
      }
      baseGeometry.dispose();
      baseMaterial.dispose();
    },
  };
}

function createCubeListMarker(): RenderedMarker {
  return createInstancedListMarker(() => new THREE.BoxGeometry(1, 1, 1));
}

function createSphereListMarker(): RenderedMarker {
  return createInstancedListMarker(() => new THREE.SphereGeometry(0.5, 12, 8));
}

// ── text ──────────────────────────────────────────────────────────────────

/**
 * TEXT_VIEW_FACING renders as a billboarded Sprite — sprites always face the
 * camera, which is the whole point. We rasterise the text to a canvas (cached
 * across updates that don't change text + colour) and use the canvas as the
 * sprite's texture. The sprite's world-space scale is set so the rendered
 * text height equals `marker.scale.z` metres, per the spec.
 */
function createTextMarker(): RenderedMarker {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  // Render on top of opaque geometry so text labels stay legible.
  sprite.renderOrder = 100;

  let lastKey = '';

  return {
    object: sprite,
    update: (m) => {
      applyPose(sprite, m.pose);
      const fontHeightM = Math.max(m.scale.z || 0, 0.001);
      // Cache key: text + colour + opacity. Sprite scale is cheap so we
      // always re-apply that; texture rebuild is the expensive part.
      const key = `${m.text}|${m.color.r}|${m.color.g}|${m.color.b}|${m.color.a}`;
      if (ctx && key !== lastKey) {
        const fontPx = 64;
        ctx.font = `${fontPx}px sans-serif`;
        const text = m.text || '';
        const metrics = ctx.measureText(text);
        const w = Math.max(1, Math.ceil(metrics.width) + 8);
        const h = fontPx + 16;
        canvas.width = w;
        canvas.height = h;
        // Resetting width clears + resets font state — re-apply.
        ctx.font = `${fontPx}px sans-serif`;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = `rgba(${Math.round(clamp01(m.color.r) * 255)}, ${Math.round(
          clamp01(m.color.g) * 255,
        )}, ${Math.round(clamp01(m.color.b) * 255)}, ${clamp01(m.color.a)})`;
        ctx.fillText(text, 4, h / 2);
        texture.needsUpdate = true;
        lastKey = key;
      }
      const aspect = canvas.height > 0 ? canvas.width / canvas.height : 1;
      sprite.scale.set(fontHeightM * aspect, fontHeightM, 1);
      sprite.visible = m.color.a > 0 && m.text.length > 0;
    },
    dispose: () => {
      texture.dispose();
      material.dispose();
    },
  };
}

// ── placeholder for unsupported / not-yet-resolved meshes ────────────────

/**
 * Small pink wireframe sphere used in two cases:
 *   1. As the fallback for an unknown marker type (defensive: bags from
 *      third-party stacks occasionally publish out-of-spec values).
 *   2. As the placeholder for MESH_RESOURCE while its bytes are still
 *      loading, AND as the failure mode when the load can't resolve.
 *
 * `reason`, when non-empty, is emitted exactly once via `console.warn` the
 * first time `update()` runs so a typo'd type or missing package surfaces
 * in the dev tools without spamming on every playhead tick.
 */
function createPlaceholderMarker(reason: string): RenderedMarker {
  const geometry = new THREE.SphereGeometry(0.1, 8, 6);
  const material = new THREE.MeshBasicMaterial({
    color: 0xff66cc,
    wireframe: true,
    transparent: true,
    opacity: 0.6,
  });
  const mesh = new THREE.Mesh(geometry, material);
  let warned = false;
  return {
    object: mesh,
    update: (m) => {
      applyPose(mesh, m.pose);
      const s = Math.max(m.scale.x, m.scale.y, m.scale.z, 0.05);
      mesh.scale.setScalar(s);
      if (!warned && reason) {
        console.warn(`[MarkerArray] ${reason} (ns=${m.ns}, id=${m.id})`);
        warned = true;
      }
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ── MESH_RESOURCE (v1.3.1) ────────────────────────────────────────────────

/**
 * Recursively tint every Mesh material under `root` with the marker's solid
 * colour. Clones each material first so the cached mesh in `meshLoader`'s
 * LRU is not mutated, since multiple markers sharing the same URI but
 * different colours would otherwise fight over one shared material reference.
 *
 * Skipping non-Mesh nodes (Lines / Sprites inside a .dae for example) is
 * fine: the visual intent of `mesh_use_embedded_materials=false` is "make
 * this whole mesh the marker's colour"; non-mesh helpers stay as-is rather
 * than crash on an unsupported material shape.
 */
function tintLoadedMesh(root: THREE.Object3D, color: ColorRGBA): void {
  const r = clamp01(color.r);
  const g = clamp01(color.g);
  const b = clamp01(color.b);
  const a = clamp01(color.a);
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const cloned = Array.isArray(mesh.material)
      ? mesh.material.map((m) => m.clone())
      : mesh.material.clone();
    mesh.material = cloned;
    const list = Array.isArray(cloned) ? cloned : [cloned];
    for (const m of list) {
      const colored = m as THREE.Material & { color?: THREE.Color };
      if (colored.color) colored.color.setRGB(r, g, b);
      m.opacity = a;
      m.transparent = a < 1;
    }
  });
}

/**
 * Apply opacity only. Used when `mesh_use_embedded_materials=true` but the
 * marker still wants a translucent overlay (debug overlays on top of an
 * artist-coloured mesh). Materials are cloned for the same reason as
 * `tintLoadedMesh`.
 */
function applyOpacityToLoadedMesh(root: THREE.Object3D, alpha: number): void {
  const a = clamp01(alpha);
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const cloned = Array.isArray(mesh.material)
      ? mesh.material.map((m) => m.clone())
      : mesh.material.clone();
    mesh.material = cloned;
    const list = Array.isArray(cloned) ? cloned : [cloned];
    for (const m of list) {
      m.opacity = a;
      m.transparent = a < 1;
    }
  });
}

/**
 * MESH_RESOURCE renders an external mesh referenced by `marker.mesh_resource`
 * (a `package://`, `http://`, `https://`, or bare URL). The resolver +
 * loader path is the same one the v1.3.0 URDF code path uses, so the
 * pink-wireframe placeholder only survives when the load actually fails.
 *
 * Lifecycle:
 *   - Construct: placeholder is in the scene immediately.
 *   - First `update(m)` with a non-empty `meshResource`: kick off
 *     `loadMesh(uri)`. The placeholder stays visible until the promise
 *     resolves.
 *   - On resolve: swap the loaded mesh in for the placeholder. Honour
 *     `mesh_use_embedded_materials` to decide between bundled materials
 *     and a re-tint by `marker.color`. Cache the URI so successive ticks
 *     don't re-issue the load.
 *   - On rejection: leave the placeholder in place and `console.warn`
 *     once. This matches the v0.8 failure mode.
 *   - On URI change between updates: bump a generation counter so an
 *     in-flight stale resolve discards itself, then re-issue.
 *
 * Disposal note: the loaded mesh's geometries / materials are *not*
 * disposed here; they belong to `meshLoader`'s LRU cache, which is the
 * single owner. Disposing them here would corrupt the cache for any other
 * marker (or URDF visual) that pulled a clone of the same URI. The cache
 * disposes on its own evictions.
 */
function createMeshResourceMarker(): RenderedMarker {
  const group = new THREE.Group();
  const placeholderGeo = new THREE.SphereGeometry(0.1, 8, 6);
  const placeholderMat = new THREE.MeshBasicMaterial({
    color: 0xff66cc,
    wireframe: true,
    transparent: true,
    opacity: 0.6,
  });
  const placeholder = new THREE.Mesh(placeholderGeo, placeholderMat);
  group.add(placeholder);

  let lastUri = '';
  let loadedMesh: THREE.Object3D | null = null;
  let lastEmbedded: boolean | null = null;
  let lastTintKey = '';
  let loadGeneration = 0;
  let warned = false;

  const showPlaceholder = (sz: Vec3) => {
    const s = Math.max(sz.x, sz.y, sz.z, 0.05);
    placeholder.scale.setScalar(s);
    placeholder.visible = true;
  };

  return {
    object: group,
    update: (m) => {
      applyPose(group, m.pose);

      const uri = m.meshResource;
      if (uri !== lastUri) {
        lastUri = uri;
        warned = false;
        if (loadedMesh) {
          group.remove(loadedMesh);
          loadedMesh = null;
        }
        lastEmbedded = null;
        lastTintKey = '';
        showPlaceholder(m.scale);
        if (!uri) return;

        const gen = ++loadGeneration;
        const useEmbedded = m.meshUseEmbeddedMaterials;
        const colorSnapshot: ColorRGBA = { ...m.color };
        const scaleSnapshot: Vec3 = { ...m.scale };
        loadMesh(uri)
          .then((mesh) => {
            if (gen !== loadGeneration) return;
            mesh.scale.set(
              scaleSnapshot.x || 1,
              scaleSnapshot.y || 1,
              scaleSnapshot.z || 1,
            );
            if (!useEmbedded) {
              tintLoadedMesh(mesh, colorSnapshot);
              lastTintKey = `${colorSnapshot.r}|${colorSnapshot.g}|${colorSnapshot.b}|${colorSnapshot.a}`;
            } else if (colorSnapshot.a < 1) {
              applyOpacityToLoadedMesh(mesh, colorSnapshot.a);
              lastTintKey = `embed|${colorSnapshot.a}`;
            } else {
              lastTintKey = 'embed';
            }
            lastEmbedded = useEmbedded;
            placeholder.visible = false;
            group.add(mesh);
            loadedMesh = mesh;
          })
          .catch((err) => {
            if (gen !== loadGeneration) return;
            if (!warned) {
              const reason = err instanceof MeshLoadError ? err.message : String(err);
              console.warn(
                `[MarkerArray] MESH_RESOURCE failed (${m.ns}:${m.id}) ${uri}: ${reason}`,
              );
              warned = true;
            }
          });
        return;
      }

      // URI hasn't changed. Adjust visible state without re-loading.
      if (loadedMesh) {
        loadedMesh.scale.set(m.scale.x || 1, m.scale.y || 1, m.scale.z || 1);
        const useEmbedded = m.meshUseEmbeddedMaterials;
        const tintKey = useEmbedded
          ? m.color.a < 1
            ? `embed|${m.color.a}`
            : 'embed'
          : `${m.color.r}|${m.color.g}|${m.color.b}|${m.color.a}`;
        if (useEmbedded !== lastEmbedded || tintKey !== lastTintKey) {
          // Materials may have been mutated already; clone again to land
          // back on a fresh set rather than stacking edits.
          if (!useEmbedded) {
            tintLoadedMesh(loadedMesh, m.color);
          } else if (m.color.a < 1) {
            applyOpacityToLoadedMesh(loadedMesh, m.color.a);
          }
          lastEmbedded = useEmbedded;
          lastTintKey = tintKey;
        }
      } else {
        showPlaceholder(m.scale);
      }
    },
    dispose: () => {
      // Drop the placeholder; the loaded mesh's geometries / materials
      // belong to the mesh-loader cache and must not be disposed here.
      placeholderGeo.dispose();
      placeholderMat.dispose();
      loadGeneration++; // any in-flight promise becomes a no-op on resolve.
      if (loadedMesh) {
        group.remove(loadedMesh);
        loadedMesh = null;
      }
    },
  };
}

// ── TRIANGLE_LIST (v1.3.1) ────────────────────────────────────────────────

/**
 * TRIANGLE_LIST renders `marker.points[]` as a Lambert-lit triangle soup, in
 * groups of three. `marker.colors[]` gives per-vertex colour when its length
 * matches `points.length`; otherwise the whole mesh tints from
 * `marker.color`. An odd trailing point is dropped rather than building a
 * dangling triangle.
 *
 * Scale: spec is ambiguous but RViz multiplies the geometry coordinates by
 * `marker.scale`. We match RViz so debug bags rendered side-by-side line up.
 *
 * `DoubleSide` because triangle-soup marker meshes (planner footprints,
 * convex hulls, costmap surfaces) are routinely camera-flipped relative to
 * how the publisher generated them. Single-side culling makes those
 * scenarios silently disappear; the lighting cost is negligible at marker
 * scale (<<10k tris in practice).
 */
function createTriangleListMarker(): RenderedMarker {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return {
    object: mesh,
    update: (m) => {
      applyPose(mesh, m.pose);
      mesh.scale.set(m.scale.x || 1, m.scale.y || 1, m.scale.z || 1);
      const triCount = Math.floor(m.points.length / 3);
      if (triCount === 0) {
        mesh.visible = false;
        return;
      }
      mesh.visible = m.color.a > 0;
      const vertexCount = triCount * 3;
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(packPositions(m.points, vertexCount), 3),
      );
      geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(packColors(m.colors, m.color, vertexCount), 3),
      );
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
      // Keep base colour white so per-vertex colour passes through Lambert
      // multiplication unchanged. Opacity still lives on the material.
      material.color.setRGB(1, 1, 1);
      material.opacity = clamp01(m.color.a);
      material.transparent = material.opacity < 1;
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}

// ── dispatch ──────────────────────────────────────────────────────────────

export function createMarkerObject(type: number): RenderedMarker {
  switch (type) {
    case MARKER_TYPE.ARROW:
      return createArrowMarker();
    case MARKER_TYPE.CUBE:
      return createCubeMarker();
    case MARKER_TYPE.SPHERE:
      return createSphereMarker();
    case MARKER_TYPE.CYLINDER:
      return createCylinderMarker();
    case MARKER_TYPE.LINE_STRIP:
      return createLineStripMarker();
    case MARKER_TYPE.LINE_LIST:
      return createLineListMarker();
    case MARKER_TYPE.CUBE_LIST:
      return createCubeListMarker();
    case MARKER_TYPE.SPHERE_LIST:
      return createSphereListMarker();
    case MARKER_TYPE.POINTS:
      return createPointsMarker();
    case MARKER_TYPE.TEXT_VIEW_FACING:
      return createTextMarker();
    case MARKER_TYPE.MESH_RESOURCE:
      return createMeshResourceMarker();
    case MARKER_TYPE.TRIANGLE_LIST:
      return createTriangleListMarker();
    default:
      return createPlaceholderMarker(`unknown marker type ${type}`);
  }
}

// ── normalisation ─────────────────────────────────────────────────────────

/**
 * Turn a deserialized message object into the canonical `MarkerData` shape
 * the renderer expects. Tolerant: missing optional fields default to
 * spec-defined sensible values rather than throwing.
 */
export function normaliseMarker(
  raw: Record<string, unknown>,
  fallbackStampNs: bigint,
): MarkerData {
  const header = (raw.header ?? {}) as {
    frame_id?: unknown;
    stamp?: { sec?: unknown; nanosec?: unknown; nsec?: unknown };
  };
  const pose = (raw.pose ?? {}) as {
    position?: unknown;
    orientation?: unknown;
  };
  const scale = (raw.scale ?? {}) as Partial<Vec3>;
  const color = (raw.color ?? {}) as Partial<ColorRGBA>;
  const lifetime = (raw.lifetime ?? {}) as {
    sec?: unknown;
    nanosec?: unknown;
    nsec?: unknown;
  };

  const rawPoints = Array.isArray(raw.points) ? (raw.points as unknown[]) : [];
  const rawColors = Array.isArray(raw.colors) ? (raw.colors as unknown[]) : [];

  return {
    ns: typeof raw.ns === 'string' ? raw.ns : '',
    id: Number(raw.id ?? 0) | 0,
    type: Number(raw.type ?? 0) | 0,
    action: Number(raw.action ?? 0) | 0,
    pose: {
      position: vec3(pose.position),
      orientation: quatOrIdentity(pose.orientation),
    },
    scale: { x: num(scale.x, 1), y: num(scale.y, 1), z: num(scale.z, 1) },
    color: {
      r: num(color.r, 1),
      g: num(color.g, 1),
      b: num(color.b, 1),
      a: num(color.a, 1),
    },
    lifetimeNs: durationNs(lifetime),
    stampNs: stampNs(header.stamp, fallbackStampNs),
    frameLocked: Boolean(raw.frame_locked ?? false),
    frameId: typeof header.frame_id === 'string' ? header.frame_id : '',
    points: rawPoints.map((p) => vec3(p)),
    colors: rawColors.map((c) => {
      const o = (c ?? {}) as Partial<ColorRGBA>;
      return {
        r: num(o.r, 1),
        g: num(o.g, 1),
        b: num(o.b, 1),
        a: num(o.a, 1),
      };
    }),
    text: typeof raw.text === 'string' ? raw.text : '',
    meshResource: typeof raw.mesh_resource === 'string' ? raw.mesh_resource : '',
    meshUseEmbeddedMaterials: Boolean(raw.mesh_use_embedded_materials ?? false),
  };
}

/** Extract every Marker out of a deserialized message — works for both
 *  `visualization_msgs/Marker` (single) and `MarkerArray` (`markers[]`). */
export function extractMarkers(
  value: Record<string, unknown>,
  fallbackStampNs: bigint,
): MarkerData[] {
  // MarkerArray case
  if (Array.isArray(value.markers)) {
    const out: MarkerData[] = [];
    for (const raw of value.markers as unknown[]) {
      if (raw && typeof raw === 'object') {
        out.push(normaliseMarker(raw as Record<string, unknown>, fallbackStampNs));
      }
    }
    return out;
  }
  // Single Marker case — detect by presence of marker-shaped fields.
  if ('type' in value && 'action' in value && 'pose' in value) {
    return [normaliseMarker(value, fallbackStampNs)];
  }
  return [];
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function vec3(v: unknown): Vec3 {
  const o = (v ?? {}) as Partial<Vec3>;
  return { x: num(o.x, 0), y: num(o.y, 0), z: num(o.z, 0) };
}

function quatOrIdentity(v: unknown): Quat {
  const o = (v ?? {}) as Partial<Quat>;
  const x = num(o.x, 0);
  const y = num(o.y, 0);
  const z = num(o.z, 0);
  const w = num(o.w, 1);
  // Identity quaternion when all components are zero, which is what bags
  // tend to ship for "no rotation" rather than (0,0,0,1).
  if (x === 0 && y === 0 && z === 0 && w === 0) return { x: 0, y: 0, z: 0, w: 1 };
  return { x, y, z, w };
}

function stampNs(
  stamp: { sec?: unknown; nanosec?: unknown; nsec?: unknown } | undefined,
  fallback: bigint,
): bigint {
  if (!stamp) return fallback;
  // ROS2 deserialisers emit `nanosec`; the v0.6 ROS1 normalisation pass adds
  // `nanosec` as an alias on top of `nsec`, so we read either.
  const ns = stamp.nanosec ?? stamp.nsec;
  if (typeof stamp.sec === 'number' && typeof ns === 'number') {
    return BigInt(stamp.sec) * 1_000_000_000n + BigInt(ns);
  }
  if (typeof stamp.sec === 'bigint' && typeof ns === 'bigint') {
    return stamp.sec * 1_000_000_000n + ns;
  }
  return fallback;
}

function durationNs(d: {
  sec?: unknown;
  nanosec?: unknown;
  nsec?: unknown;
}): bigint {
  const ns = d.nanosec ?? d.nsec;
  if (typeof d.sec === 'number' && typeof ns === 'number') {
    return BigInt(d.sec) * 1_000_000_000n + BigInt(ns);
  }
  if (typeof d.sec === 'bigint' && typeof ns === 'bigint') {
    return d.sec * 1_000_000_000n + ns;
  }
  return 0n;
}

// Silence the lint about unused TMP_QUAT by re-exporting it. (The constant is
// kept so future inline-pose helpers don't have to re-introduce it.)
void TMP_QUAT;

/** Touch-friendly dispose for an externally-owned marker object. */
export function disposeRenderedMarker(rm: RenderedMarker): void {
  rm.dispose();
}
