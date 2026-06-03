/**
 * Camera frustum visualisation - v1.3.2
 *
 * Renders a wireframe pyramid from the camera origin out to a user-set
 * far plane, sized by the CameraInfo intrinsics so the frustum matches
 * the camera's actual field of view. Lives inside the 3D scene as a
 * sibling of the cloud / pose / marker rendering.
 *
 * Coordinate convention:
 *   The frustum is built in the camera optical frame (X right, Y down,
 *   Z forward) which is the standard for `sensor_msgs/CameraInfo`. The
 *   panel applies the TF chain from the optical frame to the world
 *   frame, so a camera in `cam_optical_frame` ends up where the TF
 *   stream says it is and follows the robot through scrubs.
 *
 * Asymmetric principal point: x_min / x_max are computed from cx (and
 * y_min / y_max from cy) rather than assuming the optical centre sits
 * dead-centre. This matters for off-axis calibrations (RGB-D modules,
 * wide-angle lenses with cropped sensors) where cx can be noticeably
 * different from width/2.
 *
 * Vertex math at depth d:
 *   - x_min = -cx * d / fx, x_max = (width - cx) * d / fx
 *   - y_min = -cy * d / fy, y_max = (height - cy) * d / fy
 *
 * Topology: 8 line segments = 4 from the apex to each far corner, plus
 * the 4 edges of the far rectangle. `THREE.LineSegments` with a single
 * `BufferGeometry` so updates are one `setAttribute` call per frame.
 *
 * Far-plane updates are cheap (regenerate 16 vertices) so we don't bother
 * caching across intrinsics changes - the slider drives the panel paint
 * directly.
 */

import * as THREE from 'three';
import type { CameraIntrinsics } from '../../../hooks/useCameraInfo';

export interface CameraFrustumObject {
  /** Three.js node to add to the panel's world group. */
  object: THREE.Group;
  /** Update the frustum to match new intrinsics + far plane. */
  update: (intrinsics: CameraIntrinsics, farPlaneMeters: number) => void;
  /** Free GPU resources owned by this frustum. */
  dispose: () => void;
}

/**
 * Build the geometry positions for a camera frustum at the given depth
 * and intrinsics. Public for the v1.3.2 unit test that asserts the
 * width / height at z=1m matches `(width / fx, height / fy)`.
 *
 * The returned array carries 16 vertex positions (`8 line segments * 2
 * endpoints * 3 coordinates`).
 */
export function buildFrustumPositions(
  intrinsics: CameraIntrinsics,
  farPlaneMeters: number,
): Float32Array {
  const d = Math.max(farPlaneMeters, 0.001);
  const { fx, fy, cx, cy, width, height } = intrinsics;
  const xMin = -cx * d / fx;
  const xMax = (width - cx) * d / fx;
  const yMin = -cy * d / fy;
  const yMax = (height - cy) * d / fy;

  // Far-plane corners. Order matches a clockwise winding when looking
  // *into* +Z so the edge connectivity below stays trivial to follow.
  //   TL = (xMin, yMin, d)
  //   TR = (xMax, yMin, d)
  //   BR = (xMax, yMax, d)
  //   BL = (xMin, yMax, d)
  const positions = new Float32Array([
    // Apex to TL
    0, 0, 0, xMin, yMin, d,
    // Apex to TR
    0, 0, 0, xMax, yMin, d,
    // Apex to BR
    0, 0, 0, xMax, yMax, d,
    // Apex to BL
    0, 0, 0, xMin, yMax, d,
    // Far edges: TL-TR, TR-BR, BR-BL, BL-TL
    xMin, yMin, d, xMax, yMin, d,
    xMax, yMin, d, xMax, yMax, d,
    xMax, yMax, d, xMin, yMax, d,
    xMin, yMax, d, xMin, yMin, d,
  ]);
  return positions;
}

/**
 * Build a new frustum scene object. The returned `object` is a
 * `THREE.Group` so the panel can apply a single TF matrix that places
 * the camera in the world frame without disturbing the per-vertex
 * coordinates.
 */
export function createCameraFrustum(color: THREE.ColorRepresentation = 0x06b6d4): CameraFrustumObject {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    depthTest: true,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  // The frustum's bounding-sphere is computed from the far-plane corners,
  // but we still cull aggressively at the panel level. Disable frustum
  // culling so a camera with a 100m far plane doesn't disappear when the
  // scene's other content is centred around the robot.
  lines.frustumCulled = false;
  const group = new THREE.Group();
  // matrixAutoUpdate stays on because the panel writes the TF matrix
  // directly to `group.matrix` via `applyMatrix` (same as the cloud +
  // pose + marker render paths). The setter handles the dirty flag.
  group.matrixAutoUpdate = false;
  group.add(lines);

  return {
    object: group,
    update: (intrinsics, farPlaneMeters) => {
      const positions = buildFrustumPositions(intrinsics, farPlaneMeters);
      const existing = geometry.getAttribute('position') as
        | THREE.BufferAttribute
        | undefined;
      if (existing && existing.array.length === positions.length) {
        // Re-use the same Float32Array allocation when the vertex count
        // hasn't changed. v0.4 cloud path uses the same trick.
        (existing.array as Float32Array).set(positions);
        existing.needsUpdate = true;
      } else {
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      }
      geometry.computeBoundingSphere();
    },
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
