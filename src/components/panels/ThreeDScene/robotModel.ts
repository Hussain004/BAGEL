/**
 * Robot subtree builder - v1.3.0
 *
 * Turns a parsed `UrdfModel` into a `THREE.Object3D` tree the ThreeDScene
 * panel can attach to its `worldGroup`.
 *
 * Hierarchy mirrors URDF semantics:
 *
 *     root link group  (origin = anchor link in world)
 *       └── joint pivot group  (joint origin xyz/rpy)
 *             └── joint axis group  (rotates by current joint value around URDF axis)
 *                   └── child link group  (visual origin)
 *                         └── visual primitive / mesh
 *                         └── … nested joints
 *
 * Each `<visual>` element gets its own `THREE.Mesh` instance under the link
 * group; multi-visual links work transparently. Mesh primitives go through
 * `meshLoader.loadMesh` and are added asynchronously - the rest of the
 * scene renders immediately, the meshes pop in once their fetches resolve.
 *
 * Joint state ingestion: `setJointPositions(map)` walks every revolute /
 * prismatic / continuous joint and re-applies its transform. Mimic joints
 * follow their referenced joint via `position = multiplier * other + offset`.
 *
 * `renderOrder = -1` for solid meshes so opaque point-cloud points always
 * draw on top of partially transparent collada materials. Matches RViz.
 *
 * Materials: per-visual `<material><color>` is honoured. Named-material
 * references are resolved upstream during URDF parsing - the visual carries
 * the resolved colour by the time we see it here.
 */

import * as THREE from 'three';
import type {
  UrdfGeometry,
  UrdfJoint,
  UrdfLink,
  UrdfModel,
  UrdfVisual,
  XYZRPY,
} from '../../../parsers/urdf';
import { loadMesh, MeshLoadError } from '../../../utils/meshLoader';

export interface RobotSubtreeOptions {
  /**
   * Default material colour applied to any visual that doesn't declare its
   * own. Matches Three.js's default but kept overridable so the modal can
   * preview a robot against the scene's dark background.
   */
  defaultColor?: number;
  /**
   * Override colours for the robot links / joints - used by the per-bag
   * tint flow when comparing two URDFs side-by-side (future use).
   */
  tint?: THREE.Color;
}

export interface RobotSubtreeWarning {
  kind: 'mesh-load' | 'unsupported-geometry' | 'missing-link';
  link?: string;
  uri?: string;
  message: string;
}

export interface RobotSubtree {
  /** Three.js node to add to the scene. Owns every other resource. */
  root: THREE.Object3D;
  /** Apply joint positions (URDF joint names → angle/distance). */
  setJointPositions: (positions: Map<string, number>) => void;
  /** Free geometries, materials, textures owned by the subtree. */
  dispose: () => void;
  /** Non-fatal load warnings collected during `build`. */
  warnings: RobotSubtreeWarning[];
}

interface JointBinding {
  joint: UrdfJoint;
  /** Three.js group whose local matrix encodes the current joint value. */
  axisGroup: THREE.Group;
  /** Current value (radians for revolute/continuous, metres for prismatic). */
  currentValue: number;
}

interface LinkBinding {
  /** Group whose origin is at the link frame. Visuals attach inside it. */
  group: THREE.Group;
}

/**
 * Compose translation + Euler RPY into a matrix. URDF uses RPY in radians
 * applied as ZYX intrinsic rotations (yaw then pitch then roll), which
 * Three.js's `Euler('XYZ')` matches when you set `(roll, pitch, yaw)` as
 * the order is applied left-to-right.
 */
function originMatrix(origin: XYZRPY | undefined): THREE.Matrix4 {
  const m = new THREE.Matrix4();
  if (!origin) return m;
  const e = new THREE.Euler(origin.rpy[0], origin.rpy[1], origin.rpy[2], 'XYZ');
  const q = new THREE.Quaternion().setFromEuler(e);
  m.compose(new THREE.Vector3(origin.xyz[0], origin.xyz[1], origin.xyz[2]), q, new THREE.Vector3(1, 1, 1));
  return m;
}

function applyMatrix(node: THREE.Object3D, m: THREE.Matrix4): void {
  node.matrixAutoUpdate = false;
  node.matrix.copy(m);
}

function makeGeometry(geom: UrdfGeometry): THREE.BufferGeometry | null {
  switch (geom.kind) {
    case 'box':
      return new THREE.BoxGeometry(geom.size[0], geom.size[1], geom.size[2]);
    case 'cylinder':
      // URDF cylinders have their axis along Z; Three.js cylinders default
      // to Y. Apply a fixed pre-rotation so the rendered cylinder matches
      // the URDF spec without us needing to add a wrapper group per visual.
      {
        const g = new THREE.CylinderGeometry(geom.radius, geom.radius, geom.length, 24, 1);
        g.rotateX(Math.PI / 2);
        return g;
      }
    case 'sphere':
      return new THREE.SphereGeometry(geom.radius, 24, 16);
    case 'mesh':
      // Meshes go through the async loader path; primitive geometry is null.
      return null;
  }
}

function makeMaterial(visual: UrdfVisual, fallback: number, tint?: THREE.Color): THREE.Material {
  const color = visual.material?.color?.rgba;
  let r = ((fallback >> 16) & 0xff) / 255;
  let g = ((fallback >> 8) & 0xff) / 255;
  let b = (fallback & 0xff) / 255;
  let a = 1;
  if (color) {
    r = color[0];
    g = color[1];
    b = color[2];
    a = color[3];
  }
  const threeColor = new THREE.Color(r, g, b);
  if (tint) threeColor.lerp(tint, 0.35);
  const mat = new THREE.MeshLambertMaterial({
    color: threeColor,
    transparent: a < 1,
    opacity: a,
  });
  return mat;
}

/**
 * Build the robot scene-graph. Mesh loads run in the background; the rest
 * of the tree is returned synchronously so the panel paints immediately.
 *
 * Promise resolves once every primitive is in place AND every mesh load
 * has either succeeded or surfaced as a warning. Use `result.warnings`
 * after `await` to display non-fatal load failures.
 */
export async function buildRobotSubtree(
  model: UrdfModel,
  anchorLink: string,
  options: RobotSubtreeOptions = {},
): Promise<RobotSubtree> {
  const defaultColor = options.defaultColor ?? 0xb5b5c0;
  const warnings: RobotSubtreeWarning[] = [];
  const links: Map<string, LinkBinding> = new Map();
  const joints: Map<string, JointBinding> = new Map();
  const ownedGeometries = new Set<THREE.BufferGeometry>();
  const ownedMaterials = new Set<THREE.Material>();
  const ownedObjects = new Set<THREE.Object3D>();

  const root = new THREE.Group();
  root.name = `urdf:${model.name}`;
  root.renderOrder = -1;

  // Anchor link must exist; fall back to the first model root if the named
  // anchor isn't found (defensive - the modal should have validated already).
  if (!model.links.has(anchorLink)) {
    warnings.push({
      kind: 'missing-link',
      message: `Anchor link "${anchorLink}" not found in model; using "${model.rootLinks[0] ?? '?'}" instead.`,
    });
    anchorLink = model.rootLinks[0] ?? '';
    if (!model.links.has(anchorLink)) {
      return {
        root,
        setJointPositions: () => {},
        dispose: () => {},
        warnings,
      };
    }
  }

  /**
   * Recursively build a link's group + every joint rooted at it. We walk
   * outward from the anchor link so the matrices compose correctly.
   */
  const meshLoadPromises: Promise<void>[] = [];
  const childrenByLink = new Map<string, UrdfJoint[]>();
  for (const j of model.joints.values()) {
    const list = childrenByLink.get(j.parent) ?? [];
    list.push(j);
    childrenByLink.set(j.parent, list);
  }

  const buildLink = (linkName: string, parentNode: THREE.Object3D, seen: Set<string>): void => {
    if (seen.has(linkName)) {
      warnings.push({
        kind: 'missing-link',
        message: `Cycle detected at link "${linkName}"; skipping.`,
      });
      return;
    }
    const link = model.links.get(linkName);
    if (!link) {
      warnings.push({ kind: 'missing-link', message: `Link "${linkName}" referenced but not defined.` });
      return;
    }
    seen.add(linkName);
    const linkGroup = new THREE.Group();
    linkGroup.name = `link:${link.name}`;
    parentNode.add(linkGroup);
    ownedObjects.add(linkGroup);
    links.set(link.name, { group: linkGroup });

    attachVisuals(link, linkGroup, defaultColor, options.tint, warnings, ownedGeometries, ownedMaterials, ownedObjects, meshLoadPromises);

    const outgoing = childrenByLink.get(link.name) ?? [];
    for (const joint of outgoing) {
      // Joint pivot: applies the joint's origin transform from parent link.
      const jointPivot = new THREE.Group();
      jointPivot.name = `joint-origin:${joint.name}`;
      applyMatrix(jointPivot, originMatrix(joint.origin));
      linkGroup.add(jointPivot);
      ownedObjects.add(jointPivot);

      // Axis group: rotates / slides by the current joint value. Starts at
      // identity. `setJointPositions` updates it later.
      const axisGroup = new THREE.Group();
      axisGroup.name = `joint-axis:${joint.name}`;
      axisGroup.matrixAutoUpdate = false;
      jointPivot.add(axisGroup);
      ownedObjects.add(axisGroup);

      joints.set(joint.name, { joint, axisGroup, currentValue: 0 });

      buildLink(joint.child, axisGroup, seen);
    }
  };

  buildLink(anchorLink, root, new Set());

  // Wait for every queued mesh load before resolving so the caller can
  // surface warnings synchronously. Meshes are added inside the resolved
  // promises directly.
  await Promise.allSettled(meshLoadPromises);

  const setJointPositions = (positions: Map<string, number>): void => {
    // Mimic joints can reference any other joint regardless of declaration
    // order, so we resolve in two passes. Pass 1: copy raw inputs into each
    // binding. Pass 2: re-apply mimics using the (now-populated) inputs.
    for (const binding of joints.values()) {
      const v = positions.get(binding.joint.name);
      if (typeof v === 'number' && Number.isFinite(v)) {
        binding.currentValue = clampToLimit(binding.joint, v);
      }
    }
    for (const binding of joints.values()) {
      if (!binding.joint.mimic) continue;
      const source = joints.get(binding.joint.mimic.joint);
      if (!source) continue;
      binding.currentValue = clampToLimit(
        binding.joint,
        source.currentValue * binding.joint.mimic.multiplier + binding.joint.mimic.offset,
      );
    }
    // Apply transforms.
    const mat = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const translation = new THREE.Vector3();
    const scaleOne = new THREE.Vector3(1, 1, 1);
    for (const binding of joints.values()) {
      const { joint, axisGroup, currentValue } = binding;
      const axis = new THREE.Vector3(joint.axis[0], joint.axis[1], joint.axis[2]);
      if (axis.lengthSq() === 0) axis.set(1, 0, 0);
      else axis.normalize();
      mat.identity();
      if (joint.type === 'revolute' || joint.type === 'continuous') {
        q.setFromAxisAngle(axis, currentValue);
        mat.compose(translation.set(0, 0, 0), q, scaleOne);
      } else if (joint.type === 'prismatic') {
        translation.copy(axis).multiplyScalar(currentValue);
        q.identity();
        mat.compose(translation, q, scaleOne);
      } else {
        // fixed / floating / planar - no auto-animation in v1.3.0.
        mat.identity();
      }
      axisGroup.matrix.copy(mat);
    }
  };

  // Apply zero positions so the model is in its rest pose before the first
  // playhead tick arrives.
  setJointPositions(new Map());

  const dispose = (): void => {
    for (const g of ownedGeometries) g.dispose();
    for (const m of ownedMaterials) m.dispose();
    for (const o of ownedObjects) {
      o.parent?.remove(o);
    }
    ownedGeometries.clear();
    ownedMaterials.clear();
    ownedObjects.clear();
  };

  return { root, setJointPositions, dispose, warnings };
}

function clampToLimit(joint: UrdfJoint, value: number): number {
  if (!joint.limit) return value;
  if (joint.type === 'continuous') return value; // No clamping per spec.
  return Math.max(joint.limit.lower, Math.min(joint.limit.upper, value));
}

function attachVisuals(
  link: UrdfLink,
  linkGroup: THREE.Group,
  defaultColor: number,
  tint: THREE.Color | undefined,
  warnings: RobotSubtreeWarning[],
  ownedGeometries: Set<THREE.BufferGeometry>,
  ownedMaterials: Set<THREE.Material>,
  ownedObjects: Set<THREE.Object3D>,
  meshLoadPromises: Promise<void>[],
): void {
  for (const visual of link.visuals) {
    const visualGroup = new THREE.Group();
    visualGroup.name = `visual:${link.name}`;
    applyMatrix(visualGroup, originMatrix(visual.origin));
    linkGroup.add(visualGroup);
    ownedObjects.add(visualGroup);

    if (visual.geometry.kind === 'mesh') {
      const uri = visual.geometry.uri;
      const scale = visual.geometry.scale;
      meshLoadPromises.push(
        loadMesh(uri)
          .then((mesh) => {
            mesh.scale.set(scale[0], scale[1], scale[2]);
            mesh.renderOrder = -1;
            // Apply the visual's per-material colour to any meshes inside
            // the loaded subtree that DIDN'T carry their own material. For
            // .stl this fully overrides; for .dae / .obj we leave any
            // bundled materials in place (they're typically the artist's
            // intent).
            if (visual.material?.color) {
              const c = visual.material.color.rgba;
              mesh.traverse((node) => {
                const meshNode = node as THREE.Mesh;
                if (!meshNode.material) return;
                // Heuristic: only re-tint the synthetic Lambert material
                // we wrap STL geometries in. Collada / OBJ keep their own.
                const m = meshNode.material as THREE.MeshLambertMaterial;
                if (m.userData?.isUrdfDefault) {
                  m.color.setRGB(c[0], c[1], c[2]);
                  m.opacity = c[3];
                  m.transparent = c[3] < 1;
                }
              });
            }
            visualGroup.add(mesh);
            ownedObjects.add(mesh);
          })
          .catch((err) => {
            if (err instanceof MeshLoadError) {
              warnings.push({
                kind: 'mesh-load',
                link: link.name,
                uri,
                message: err.message,
              });
            } else {
              warnings.push({
                kind: 'mesh-load',
                link: link.name,
                uri,
                message: err instanceof Error ? err.message : String(err),
              });
            }
            // Drop a small placeholder so the user sees *something* at the
            // joint frame instead of an invisible link.
            const placeholderGeo = new THREE.SphereGeometry(0.05, 8, 6);
            const placeholderMat = new THREE.MeshBasicMaterial({
              color: 0xff66bb,
              wireframe: true,
            });
            const placeholder = new THREE.Mesh(placeholderGeo, placeholderMat);
            placeholder.scale.set(scale[0], scale[1], scale[2]);
            visualGroup.add(placeholder);
            ownedGeometries.add(placeholderGeo);
            ownedMaterials.add(placeholderMat);
            ownedObjects.add(placeholder);
          }),
      );
      continue;
    }

    const geometry = makeGeometry(visual.geometry);
    if (!geometry) {
      warnings.push({
        kind: 'unsupported-geometry',
        link: link.name,
        message: `Unsupported geometry on link "${link.name}".`,
      });
      continue;
    }
    const material = makeMaterial(visual, defaultColor, tint);
    material.userData = { ...material.userData, isUrdfDefault: !visual.material?.color };
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = -1;
    visualGroup.add(mesh);
    ownedGeometries.add(geometry);
    ownedMaterials.add(material);
    ownedObjects.add(mesh);
  }
}
