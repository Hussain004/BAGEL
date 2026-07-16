/**
 * useScene — Own the lifetime of the Three.js renderer / scene / camera /
 * orbit controls for a single 3D panel.
 *
 * - Creates a WebGLRenderer attached to a container <div> on mount, with
 *   matching ResizeObserver so the canvas tracks layout changes.
 * - Sets up a Z-up coordinate system to match ROS (camera.up = (0,0,1)).
 * - Runs a requestAnimationFrame render loop, throttled to ~60 fps.
 * - Returns refs to the live scene + camera + controls + a `renderOnce()`
 *   helper for after-data-change repaints.
 *
 * The "userGroup" exists so each panel can place its data inside one Object3D
 * and apply a single transform to relocate everything into the chosen world
 * frame, without having to walk every leaf object.
 */
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { useThemeStore } from '../../../store/themeStore';
import { chartTheme } from '../../../utils/chartTheme';

export interface SceneRefs {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  /** Group for user data (point cloud, scan, pose). Cleared on update. */
  userGroup: THREE.Group;
  /** Group for the world helpers (grid, axes). */
  worldGroup: THREE.Group;
  renderOnce: () => void;
  /** Reset camera to a default top-down isometric view of a bounding box. */
  resetCamera: (
    target?: THREE.Vector3,
    radius?: number,
  ) => void;
  /**
   * Move the orbit pivot without changing the camera position. Use for
   * "Shift+Click here" interactions where the user wants to keep the same
   * viewpoint but pivot around a different scene point.
   */
  setOrbitTarget: (target: THREE.Vector3) => void;
  /**
   * Orbit the camera around `controls.target` by the given angles (radians).
   * Keyboard-accessible equivalent of mouse-drag rotate - see the panel's
   * onKeyDown for the actual key bindings.
   */
  orbitBy: (deltaAzimuthRad: number, deltaPolarRad: number) => void;
  /** Zoom by a multiplicative factor (<1 zooms in, >1 zooms out), clamped
   * to the same min/max distance as scroll-to-zoom. */
  zoomBy: (factor: number) => void;
}

export function useScene(): {
  containerRef: React.RefObject<HTMLDivElement | null>;
  sceneRef: React.RefObject<SceneRefs | null>;
} {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneRefs | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'default',
      preserveDrawingBuffer: true, // required for canvas.toBlob() in clip export
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    // Clear colour follows the app theme so a light UI doesn't frame a
    // permanently dark viewport. Subscription below repaints on toggle.
    renderer.setClearColor(chartTheme(useThemeStore.getState().theme).sceneClear, 1.0);
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    container.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      55,
      Math.max(container.clientWidth / Math.max(container.clientHeight, 1), 0.1),
      0.05,
      5000,
    );
    // ROS convention: Z is up. Three.js default is Y up; OrbitControls picks
    // up `camera.up` so this also keeps orbiting feeling natural.
    camera.up.set(0, 0, 1);
    camera.position.set(8, -8, 5);
    camera.lookAt(0, 0, 0);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = false;
    controls.minDistance = 0.5;
    controls.maxDistance = 1500;
    controls.target.set(0, 0, 0);

    // A subtle directional + ambient light so any meshes we ever add aren't black.
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);
    const directional = new THREE.DirectionalLight(0xffffff, 0.4);
    directional.position.set(10, 10, 20);
    scene.add(directional);

    const userGroup = new THREE.Group();
    scene.add(userGroup);
    const worldGroup = new THREE.Group();
    scene.add(worldGroup);

    let needsRender = true;
    let rafId = 0;
    let lastFrame = 0;
    const FRAME_MS = 1000 / 60;
    const tick = (now: number) => {
      rafId = requestAnimationFrame(tick);
      const elapsed = now - lastFrame;
      // Damping needs every frame to settle, but we only paint when there's
      // a reason — either damping is still moving or data changed.
      if (controls.update()) needsRender = true;
      if (needsRender && elapsed >= FRAME_MS) {
        renderer.render(scene, camera);
        needsRender = false;
        lastFrame = now;
      }
    };
    rafId = requestAnimationFrame(tick);

    // Keep canvas sized to its container. The container may be inside a
    // resizable splitter so this runs frequently while the user drags.
    const ro = new ResizeObserver(() => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = Math.max(w / Math.max(h, 1), 0.1);
      camera.updateProjectionMatrix();
      needsRender = true;
    });
    ro.observe(container);

    // Repaint with the new clear colour when the user toggles the theme.
    const unsubTheme = useThemeStore.subscribe((state) => {
      renderer.setClearColor(chartTheme(state.theme).sceneClear, 1.0);
      needsRender = true;
    });

    const renderOnce = () => {
      needsRender = true;
    };

    const resetCamera = (target?: THREE.Vector3, radius?: number) => {
      const t = target ?? new THREE.Vector3(0, 0, 0);
      const r = Math.max(radius ?? 10, 1);
      controls.target.copy(t);
      // Isometric-ish position: offset along +X, -Y, +Z by the radius.
      camera.position.set(t.x + r * 1.0, t.y - r * 1.0, t.z + r * 0.7);
      camera.lookAt(t);
      controls.update();
      needsRender = true;
    };

    const setOrbitTarget = (target: THREE.Vector3) => {
      controls.target.copy(target);
      controls.update();
      needsRender = true;
    };

    // THREE.Spherical always measures phi from the *Y* axis, regardless of
    // camera.up - this scene is Z-up (ROS convention), so raw Spherical
    // math here would orbit around the wrong axis. Mirrors the quaternion
    // trick OrbitControls itself uses internally: rotate into Y-up space,
    // do the spherical math, rotate back.
    const orbitBy = (deltaAzimuthRad: number, deltaPolarRad: number) => {
      const quat = new THREE.Quaternion().setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
      const quatInverse = quat.clone().invert();

      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      offset.applyQuaternion(quat);

      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta += deltaAzimuthRad;
      // Clamp away from the poles - exactly at phi=0/PI the azimuth becomes
      // undefined and the view can flip.
      spherical.phi = Math.max(0.02, Math.min(Math.PI - 0.02, spherical.phi + deltaPolarRad));

      offset.setFromSpherical(spherical);
      offset.applyQuaternion(quatInverse);

      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
      controls.update();
      needsRender = true;
    };

    const zoomBy = (factor: number) => {
      const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
      const newLength = Math.max(
        controls.minDistance,
        Math.min(controls.maxDistance, offset.length() * factor),
      );
      offset.setLength(newLength);
      camera.position.copy(controls.target).add(offset);
      controls.update();
      needsRender = true;
    };

    sceneRef.current = {
      renderer,
      scene,
      camera,
      controls,
      userGroup,
      worldGroup,
      renderOnce,
      resetCamera,
      setOrbitTarget,
      orbitBy,
      zoomBy,
    };

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      unsubTheme();
      controls.dispose();
      // Dispose every geometry / material we ever attached.
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh & {
          geometry?: THREE.BufferGeometry;
          material?: THREE.Material | THREE.Material[];
        };
        if (mesh.geometry) mesh.geometry.dispose();
        const m = mesh.material;
        if (Array.isArray(m)) m.forEach((mm) => mm.dispose());
        else if (m) m.dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, []);

  return { containerRef, sceneRef };
}
