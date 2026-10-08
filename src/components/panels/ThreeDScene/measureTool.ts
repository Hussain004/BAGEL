/**
 * Distance measurement in the 3D scene: click two points, read the distance.
 *
 * The maths and the formatting are pure so they can be tested exactly; the
 * THREE overlay and the raycast helper below only carry them to the scene.
 */

import * as THREE from 'three';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Readout {
  /** Straight-line distance, metres. */
  distance: number;
  /** Distance ignoring height, i.e. along the ground plane. */
  horizontal: number;
  dx: number;
  dy: number;
  dz: number;
}

export function distanceReadout(a: V3, b: V3): Readout {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return { distance: Math.hypot(dx, dy, dz), horizontal: Math.hypot(dx, dy), dx, dy, dz };
}

/** `12.34 m`, `85.0 cm`, `3.2 mm`: a unit that keeps the number readable. */
export function formatLength(metres: number): string {
  const a = Math.abs(metres);
  if (!Number.isFinite(a)) return 'n/a';
  // 0.9999 m would print as "100.0 cm"; judge the unit by the rounded value.
  if (a >= 1 || a === 0 || Math.round(a * 1000) / 10 >= 100) return `${metres.toFixed(a >= 100 ? 1 : 2)} m`;
  if (a >= 0.01) return `${(metres * 100).toFixed(1)} cm`;
  return `${(metres * 1000).toFixed(1)} mm`;
}

export function readoutText(r: Readout): string {
  const sign = (n: number) => (n >= 0 ? '+' : '-') + formatLength(Math.abs(n));
  return `${formatLength(r.distance)}  (dx ${sign(r.dx)}, dy ${sign(r.dy)}, dz ${sign(r.dz)}; ${formatLength(r.horizontal)} horizontal)`;
}

/**
 * Raycast from a screen position into the scene: the first hit on `targets`
 * (with a tolerance that scales with the view distance, so picking feels the
 * same zoomed into a room or out over a field), else the z = 0 ground plane.
 */
export function pickScenePoint(
  camera: THREE.Camera,
  viewRadius: number,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
  targets: THREE.Object3D[],
): THREE.Vector3 | null {
  const rect = canvas.getBoundingClientRect();
  const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(ndc, camera);
  raycaster.params.Points = { threshold: Math.max(viewRadius * 0.01, 0.05) };
  for (const target of targets) {
    const hits = raycaster.intersectObject(target, false);
    if (hits.length > 0) return hits[0]!.point.clone();
  }
  const out = new THREE.Vector3();
  return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), out) ? out : null;
}

export interface MeasureOverlay {
  object: THREE.Group;
  update(points: V3[], markerRadius: number): void;
  dispose(): void;
}

/** Two end markers and the line between them, drawn over the cloud. */
export function createMeasureOverlay(): MeasureOverlay {
  const object = new THREE.Group();
  object.visible = false;
  const mat = new THREE.MeshBasicMaterial({ color: 0xfbbf24, depthTest: false, transparent: true, opacity: 0.95 });
  const geo = new THREE.SphereGeometry(1, 12, 8);
  const markers = [new THREE.Mesh(geo, mat), new THREE.Mesh(geo, mat)];
  for (const m of markers) {
    m.renderOrder = 1000;
    m.visible = false;
    object.add(m);
  }
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false });
  const line = new THREE.Line(lineGeo, lineMat);
  line.renderOrder = 1000;
  line.frustumCulled = false;
  line.visible = false;
  object.add(line);

  return {
    object,
    update(points, markerRadius) {
      object.visible = points.length > 0;
      markers.forEach((m, i) => {
        const p = points[i];
        m.visible = !!p;
        if (p) {
          m.position.set(p.x, p.y, p.z);
          m.scale.setScalar(markerRadius);
        }
      });
      const [a, b] = points;
      line.visible = !!a && !!b;
      if (a && b) {
        const pos = lineGeo.getAttribute('position') as THREE.BufferAttribute;
        pos.setXYZ(0, a.x, a.y, a.z);
        pos.setXYZ(1, b.x, b.y, b.z);
        pos.needsUpdate = true;
      }
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      lineGeo.dispose();
      lineMat.dispose();
    },
  };
}
