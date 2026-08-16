/**
 * Three.js scene object for `nav_msgs/OccupancyGrid`.
 *
 * Single textured plane the size of the map (`width * resolution` x
 * `height * resolution` metres), placed by the map's `info.origin` pose so
 * the bottom-left cell lands where ROS says it does. Texture rebuilds only
 * when the underlying cell buffer changes (most SLAM maps publish at 1 Hz
 * or less, so we get this nearly for free).
 *
 * The PlaneGeometry is built once at unit size and scaled to fit the actual
 * map dimensions on each update — saves disposing/recreating geometry when
 * a SLAM publisher slowly grows the map as the robot explores.
 */

import * as THREE from 'three';
import type { OccupancyGridDecoded } from '../../../utils/occupancyGrid';

export interface MapPlaneObject {
  object: THREE.Group;
  /** Inner mesh; the group above carries the origin transform. */
  mesh: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  material: THREE.MeshBasicMaterial;
  /** Backing texture; recreated whenever the cell buffer changes. */
  texture: THREE.DataTexture | null;
  /** Last decoded content key — short-circuit identical-data updates. */
  lastContentKey: string | null;
  /** Optional axis-aligned bounds (world frame, before TF). Null when empty. */
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  } | null;
}

export function createMapPlane(): MapPlaneObject {
  // PlaneGeometry is unit-sized centred on origin; the mesh offset below
  // shifts so the bottom-left lands at (0,0,0) within the parent group.
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    // OpacityMap is the texture alpha channel; combined with `material.opacity`
    // below to make the user's alpha slider feel intuitive (a single global
    // dimmer on top of the per-cell alpha ramp).
    opacity: 1.0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  // updateMapPlane places the mesh at half its metric width and height.
  // Object positions are not affected by their own scale in Three.js, so a
  // fixed (0.5, 0.5) offset would incorrectly centre every map near (0, 0).
  mesh.position.set(0, 0, 0);
  // Map sits just above the ground grid so it doesn't z-fight with it.
  // 1 mm offset is too small for any LiDAR / SLAM scale to notice.
  mesh.renderOrder = -1; // draw before opaque clouds so transparency reads correctly

  const group = new THREE.Group();
  group.add(mesh);

  return {
    object: group,
    mesh,
    geometry,
    material,
    texture: null,
    lastContentKey: null,
    bounds: null,
  };
}

/**
 * Push a freshly-decoded grid into the plane. No-ops when the content key
 * matches the previous update — saves the GPU-side texture upload and the
 * matrix recompute on every playhead tick.
 */
export function updateMapPlane(obj: MapPlaneObject, decoded: OccupancyGridDecoded): void {
  const { width, height, resolution, origin, rgba, contentKey } = decoded;
  const widthM = width * resolution;
  const heightM = height * resolution;

  if (obj.lastContentKey !== contentKey) {
    // Dispose the previous texture before swapping — DataTexture allocates
    // GPU memory that won't be reclaimed by JS GC alone.
    if (obj.texture) obj.texture.dispose();
    const tex = new THREE.DataTexture(
      rgba,
      width,
      height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    );
    // NearestFilter keeps cell edges crisp — bilinear would smear free-space
    // pixels into occupied ones and the user wouldn't be able to tell where
    // the wall is. Mipmaps off for the same reason.
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    // ROS row 0 is the bottom of the map; Three.js textures sample (0,0) at
    // the bottom-left by default — so we DON'T flip-Y. (Default is flipY=true,
    // which would put the map upside-down.)
    tex.flipY = false;
    tex.needsUpdate = true;
    obj.texture = tex;
    obj.material.map = tex;
    obj.material.needsUpdate = true;
    obj.lastContentKey = contentKey;
  }

  // Scale the unit plane and move its centre by half the metric dimensions,
  // leaving the bottom-left corner exactly at the OccupancyGrid origin.
  obj.mesh.scale.set(widthM, heightM, 1);
  obj.mesh.position.set(widthM / 2, heightM / 2, 0);

  // Apply origin pose to the parent group. info.origin places the bottom-
  // left of the map at that pose, expressed in the map's reference frame.
  obj.object.position.set(origin.position.x, origin.position.y, origin.position.z);
  obj.object.quaternion.set(
    origin.orientation.x,
    origin.orientation.y,
    origin.orientation.z,
    origin.orientation.w,
  );

  // Bounds for auto-fit (in source-frame coords). The origin position is the
  // bottom-left in the parent frame; after rotation the bounds get a bit
  // generous, but autofit only needs a ballpark.
  obj.bounds = {
    min: {
      x: origin.position.x,
      y: origin.position.y,
      z: origin.position.z,
    },
    max: {
      x: origin.position.x + widthM,
      y: origin.position.y + heightM,
      z: origin.position.z,
    },
  };
}

/** Update the global alpha multiplier from the Display card's slider. */
export function setMapPlaneOpacity(obj: MapPlaneObject, alpha: number): void {
  obj.material.opacity = Math.max(0, Math.min(1, alpha));
  obj.material.needsUpdate = true;
}

export function disposeMapPlane(obj: MapPlaneObject): void {
  if (obj.texture) {
    obj.texture.dispose();
    obj.texture = null;
  }
  obj.geometry.dispose();
  obj.material.dispose();
}
