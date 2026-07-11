/**
 * SplatViewer — renders `.ply` (splat-flavored), `.splat`, and `.ksplat`
 * gaussian splat files.
 *
 * Splats are a fundamentally different render path from point clouds: each
 * splat carries spherical-harmonics color, opacity, an anisotropic scale,
 * and a rotation, and correct display requires depth-sorted alpha-blended
 * screen-space billboards, not fixed-size dots. Rather than teach
 * ThreeDScene's `decodePointCloud2` pipeline (positions + packed RGB only)
 * a second data shape, this panel hands the raw file straight to
 * `@mkkellogg/gaussian-splats-3d`, which does its own parsing, sorting
 * (off the main thread), and rendering.
 *
 * The library's `DropInViewer` is built to be added to someone else's
 * three.js scene as a plain `Object3D` rather than own the render loop, so
 * it slots into the same `useScene()` renderer/camera/OrbitControls this
 * app already uses for ThreeDScene. `sharedMemoryForWorkers` (worker/main-
 * thread sort data uses a `SharedArrayBuffer` instead of being copied every
 * frame) needs COOP/COEP response headers; BAGEL ships those (see
 * vercel.json and vite.config.ts, originally required for sql.js) so it's on
 * whenever the page is actually cross-origin isolated. That's checked at
 * runtime (`window.crossOriginIsolated`) rather than assumed, so the splat
 * path degrades to the slower copy-based path instead of throwing if those
 * headers are ever removed for an unrelated reason (e.g. sql.js stops
 * needing them). `gpuAcceleratedSort` stays off despite needing the same
 * headers: it renders a blank panel with no console error under this app's
 * own Playwright/SwiftShader test setup (likely a WebGL2 transform-feedback
 * quirk under software rendering), and there's no way to verify from here
 * whether that's specific to software rendering or a broader compatibility
 * issue, so it's not worth the silent-failure risk for real users.
 * `dynamicScene: true` is on so the up-axis correction (see
 * ORIENTATION_PRESETS below) can actually be cycled after load instead of
 * requiring a hardcoded guess baked in once at load time.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { useScene } from '../ThreeDScene/useScene';
import { createGroundGrid, createWorldAxes, disposeObject } from '../ThreeDScene/sceneObjects';
import { PanelShell } from '../PanelShell';
import { useBagStore, resolveBagEntry } from '../../../store/bagStore';
import type { BagSource } from '../../../parsers';

interface SplatViewerProps {
  panelId: string;
  topicName: string;
  type: string;
  /** Which bag the panel reads from (multi-bag). Defaults to focused bag. */
  bagId?: string;
}

type LoadState =
  | { status: 'idle' }
  | { status: 'loading'; percent: number }
  | { status: 'loaded'; splatCount: number }
  | { status: 'error'; message: string };

function sourceFileName(source: BagSource): string {
  return source.kind === 'file' ? source.file.name : source.displayName;
}

function sceneFormatFor(name: string): GaussianSplats3D.SceneFormat {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'splat') return GaussianSplats3D.SceneFormat.Splat;
  if (ext === 'ksplat') return GaussianSplats3D.SceneFormat.KSplat;
  return GaussianSplats3D.SceneFormat.Ply;
}

/** `SharedArrayBuffer` only exists when the page is cross-origin isolated
 * (COOP/COEP headers), which is what actually gates the library's faster
 * sort path - checking this directly is more robust than assuming the
 * headers are present just because BAGEL currently ships them. */
const HAS_SHARED_ARRAY_BUFFER = typeof window !== 'undefined' && window.crossOriginIsolated === true;

/**
 * Gaussian splat training pipelines (the INRIA reference implementation and
 * everything descended from it: nerfstudio/gsplat, Postshot, Polycam, Luma,
 * ...) inherit their world frame from COLMAP/OpenGL camera math, which is
 * conventionally Y-up, while BAGEL's whole scene is Z-up (ROS convention,
 * `camera.up` is fixed to (0,0,1) in useScene.ts) for every other panel. But
 * "conventionally" is doing a lot of work there - there's no single
 * standard every capture tool actually follows, so a single hardcoded guess
 * isn't reliable enough to commit to as the only option. This is a small
 * cycle of plausible corrections the user can step through with a key press
 * until one looks right.
 *
 * Mutating a loaded scene's `quaternion` only reaches the renderer if the
 * viewer was constructed with `dynamicScene: true` (see the DropInViewer
 * options below) - with the library's default (static) scenes, the vertex
 * shader never reads a scene's transform at all, so the same mutation
 * silently changes nothing on screen while still changing what
 * `getSplatCenter()` reports (that CPU accessor applies the scene transform
 * regardless of mode), which made a stale-render bug here easy to mistake
 * for a working fix. `dynamicScene: true` forgoes a few static-scene
 * optimizations (a per-vertex transform multiply, extra sort-worker
 * bookkeeping) in exchange for `updateTransforms()` actually mattering.
 */
const ORIENTATION_PRESETS: { label: string; quaternion: THREE.Quaternion }[] = [
  { label: 'Y-up', quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2) },
  { label: 'Y-up (flipped)', quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2) },
  { label: 'Z-up (as loaded)', quaternion: new THREE.Quaternion() },
  { label: 'Z-up (flipped)', quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI) },
];

/**
 * Splats with essentially-zero opacity are near-universal noise in real
 * captures (the training optimizer rarely converges exactly to 0), and
 * unlike genuinely-translucent surface detail, they're just as likely to be
 * scattered far from the subject as near it - exactly the kind of outlier
 * that wrecks a bounding-box-based camera fit. The library's own load-time
 * filter (default 1 - only near-fully-transparent splats) is raised
 * slightly to catch more of this class before it ever reaches the fit
 * calculation or the renderer, without touching splats with any real
 * visible contribution (this is still under 2% opacity).
 */
const SPLAT_ALPHA_REMOVAL_THRESHOLD = 5;

/** Cap on how many splat centers to sample for the robust fit below. Real
 * scenes can carry millions of splats; a few thousand evenly-strided samples
 * are plenty to estimate the dense cluster's extent without reading every one. */
const FIT_SAMPLE_CAP = 20_000;

/**
 * Robust centroid + spread of a splat mesh, ignoring stray outliers.
 *
 * `computeBoundingBox()`'s min/max is not safe to fit a camera to: real
 * trained gaussian splat scenes very commonly carry stray "floater" splats
 * far from the main subject (a well-known training artifact), and even one
 * of them inflates the box enough to push the camera back until the actual
 * scene is a barely-visible speck. Sample splat centers directly and take
 * the coordinate-wise **median** as the centroid - unlike a box center or a
 * mean, a handful of outliers can't drag a median far.
 *
 * The spread uses the **median distance** from that centroid (not a high
 * percentile like the 90th): a median has a 50% breakdown point, meaning it
 * stays a meaningful "typical distance" even if up to half the sampled
 * splats are stray noise, whereas a 90th-percentile cutoff is only safe up
 * to 10% contamination before the cutoff itself starts being pulled outward
 * by the very outliers it's supposed to exclude. Real captures can have a
 * lot more low-level noise than a "handful of floaters" - the caller
 * multiplies this by a padding factor to get an actual fit radius, since
 * "median distance" alone is tighter than the point where most splats
 * actually sit.
 */
function robustSplatBounds(
  viewer: GaussianSplats3D.DropInViewer,
): { center: THREE.Vector3; radius: number } | null {
  const mesh = viewer.splatMesh;
  const count = mesh?.getSplatCount() ?? 0;
  if (!mesh || count === 0) return null;

  const stride = Math.max(1, Math.floor(count / FIT_SAMPLE_CAP));
  const tmp = new THREE.Vector3();
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i < count; i += stride) {
    mesh.getSplatCenter(i, tmp, true);
    xs.push(tmp.x);
    ys.push(tmp.y);
    zs.push(tmp.z);
  }
  if (xs.length === 0) return null;

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  const center = new THREE.Vector3(xs[mid], ys[mid], zs[mid]);

  const dists = xs.map((_, i) => center.distanceTo(new THREE.Vector3(xs[i], ys[i], zs[i]))).sort((a, b) => a - b);
  const radius = dists[Math.floor(dists.length * 0.5)];
  return { center, radius };
}

/** Fit the scene's camera (position + orbit target) to the splat mesh. */
function fitCameraToSplats(
  refs: { resetCamera: (target: THREE.Vector3, radius: number) => void },
  viewer: GaussianSplats3D.DropInViewer,
): void {
  const bounds = robustSplatBounds(viewer);
  if (!bounds) return;
  refs.resetCamera(bounds.center, Math.max(bounds.radius * 2.0, 3));
}

/**
 * Fit the camera to the current splat bounds and create/move the ground
 * grid + axes reference geometry to match. Called after initial load and
 * again after every V-cycle orientation change, since rotating the scene
 * moves its bounds.
 */
function applyOrientationFit(
  refs: {
    resetCamera: (target: THREE.Vector3, radius: number) => void;
    worldGroup: THREE.Group;
  },
  viewer: GaussianSplats3D.DropInViewer,
  referenceGeometryRef: { current: { grid: THREE.GridHelper; axes: THREE.AxesHelper } | null },
): void {
  const bounds = robustSplatBounds(viewer);
  const fitRadius = bounds ? Math.max(bounds.radius * 2.0, 3) : 10;
  const center = bounds?.center ?? new THREE.Vector3();
  refs.resetCamera(center, fitRadius);

  const existing = referenceGeometryRef.current;
  if (existing) {
    existing.grid.position.set(center.x, center.y, center.z - fitRadius * 0.7);
    existing.axes.position.copy(center);
  } else {
    // Splats have no floor/wall geometry of their own to judge movement
    // against (unlike a real room, there's nothing here that visually
    // recedes or gets taller as the camera moves), so without some
    // reference, "forward" and "up" both just look like "the blob changed
    // size" - the same problem doesn't exist for ThreeDScene's point clouds
    // because those are almost always sparse/thin enough that empty space
    // around them already reads as space. Reuse ThreeDScene's own ground
    // grid + axes helpers, sized off the fitted radius so they're a
    // sensible reference regardless of whether the scene is tabletop-sized
    // or room-sized.
    const gridSize = Math.max(fitRadius * 4, 10);
    const grid = createGroundGrid(gridSize, Math.round(Math.min(Math.max(gridSize / 2, 10), 100)));
    grid.position.set(center.x, center.y, center.z - fitRadius * 0.7);
    const axes = createWorldAxes(Math.max(fitRadius * 0.3, 1));
    axes.position.copy(center);
    refs.worldGroup.add(grid);
    refs.worldGroup.add(axes);
    referenceGeometryRef.current = { grid, axes };
  }
}

/** Load the splat scene with an initial up-axis correction, then fit the
 * camera and reference geometry to it. */
async function loadSplatScene(
  refs: {
    resetCamera: (target: THREE.Vector3, radius: number) => void;
    worldGroup: THREE.Group;
    renderOnce: () => void;
  },
  viewer: GaussianSplats3D.DropInViewer,
  path: string,
  format: GaussianSplats3D.SceneFormat,
  initialQuaternion: THREE.Quaternion,
  referenceGeometryRef: { current: { grid: THREE.GridHelper; axes: THREE.AxesHelper } | null },
  onProgress: (percent: number) => void,
): Promise<number> {
  await viewer.addSplatScene(path, {
    format,
    showLoadingUI: false,
    splatAlphaRemovalThreshold: SPLAT_ALPHA_REMOVAL_THRESHOLD,
    rotation: initialQuaternion.toArray() as [number, number, number, number],
    onProgress: (percent) => {
      onProgress(percent);
      refs.renderOnce();
    },
  });
  applyOrientationFit(refs, viewer, referenceGeometryRef);
  return viewer.splatMesh?.getSplatCount() ?? 0;
}

export function SplatViewer({ panelId, topicName, type, bagId }: SplatViewerProps) {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const source = entry?.source ?? null;
  const { containerRef, sceneRef } = useScene();
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [pivot, setPivot] = useState<{ x: number; y: number; z: number } | null>(null);
  const [orientationIndex, setOrientationIndex] = useState(0);
  const orientationIndexRef = useRef(0);
  const viewerRef = useRef<GaussianSplats3D.DropInViewer | null>(null);
  const pivotMarkerRef = useRef<THREE.Mesh | null>(null);
  const isHoveringRef = useRef(false);
  const referenceGeometryRef = useRef<{ grid: THREE.GridHelper; axes: THREE.AxesHelper } | null>(null);

  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs || !source) return;

    let cancelled = false;
    let objectUrl: string | null = null;
    const viewer = new GaussianSplats3D.DropInViewer({
      threeScene: refs.scene,
      renderer: refs.renderer,
      camera: refs.camera,
      sharedMemoryForWorkers: HAS_SHARED_ARRAY_BUFFER,
      gpuAcceleratedSort: false,
      dynamicScene: true,
    });
    refs.scene.add(viewer);
    viewerRef.current = viewer;
    orientationIndexRef.current = 0;
    setOrientationIndex(0);
    setLoadState({ status: 'loading', percent: 0 });

    const path =
      source.kind === 'file'
        ? (objectUrl = URL.createObjectURL(source.file))
        : source.url;
    const format = sceneFormatFor(sourceFileName(source));

    loadSplatScene(
      refs,
      viewer,
      path,
      format,
      ORIENTATION_PRESETS[0].quaternion,
      referenceGeometryRef,
      (percent) => {
        if (cancelled) return;
        setLoadState({ status: 'loading', percent });
      },
    )
      .then((splatCount) => {
        if (cancelled) return;
        setLoadState({ status: 'loaded', splatCount });
        refs.renderOnce();
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Failed to load splat scene.';
        setLoadState({ status: 'error', message });
      });

    return () => {
      cancelled = true;
      if (viewerRef.current === viewer) viewerRef.current = null;
      refs.scene.remove(viewer);
      viewer.dispose().catch(() => {});
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      const ref = referenceGeometryRef.current;
      if (ref) {
        refs.worldGroup.remove(ref.grid);
        refs.worldGroup.remove(ref.axes);
        disposeObject(ref.grid);
        disposeObject(ref.axes);
        referenceGeometryRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sceneRef/source drive this; refs is a ref object
  }, [source]);

  // Shift+Click -> pick a custom orbit pivot, matching ThreeDScene's point-
  // cloud panel. Splats have no raycastable geometry through the public
  // library API (its own splat-tree raycaster isn't exported), so the pick
  // point comes from a plane facing the camera through the current orbit
  // target's depth instead. That always resolves to a hit and keeps the
  // pivot roughly where the user is looking, without assuming any floor/up
  // convention - unlike ThreeDScene's z=0 ground-plane fallback, real
  // captured splat scenes aren't reliably floor-aligned.
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    const canvas = refs.renderer.domElement;
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    const plane = new THREE.Plane();
    const planeHit = new THREE.Vector3();
    const viewDir = new THREE.Vector3();

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.shiftKey || event.button !== 0) return;
      // Block OrbitControls from interpreting this as a drag-start.
      event.preventDefault();
      event.stopPropagation();

      const rect = canvas.getBoundingClientRect();
      ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(ndc, refs.camera);

      refs.camera.getWorldDirection(viewDir);
      plane.setFromNormalAndCoplanarPoint(viewDir, refs.controls.target);
      if (!raycaster.ray.intersectPlane(plane, planeHit)) return;

      refs.setOrbitTarget(planeHit);
      setPivot({ x: planeHit.x, y: planeHit.y, z: planeHit.z });
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    return () => canvas.removeEventListener('pointerdown', handlePointerDown);
  }, [sceneRef]);

  // Keyboard fly-through: mouse-drag orbit alone is awkward for exploring a
  // splat scene the way it's fine for a bounded point-cloud scan - splats are
  // usually a walkable room/space, and OrbitControls' pan speed (scaled by
  // camera-to-target distance) makes fine-grained movement through one hard
  // to control. W/S move forward/back, A/D strafe left/right, Q/E turn
  // left/right (rotating the view around the camera's own position, not
  // orbiting around the target - a real "turn your head", distinct from
  // mouse-drag rotate), R/F move up/down, Z/C orbit left/right around the
  // current pivot (target stays fixed, camera swings around it - the
  // keyboard equivalent of mouse-drag rotate, unlike Q/E). B/N spin the
  // splat itself left/right around that same pivot - camera and reference
  // grid stay completely still, only the object turns, which is the point:
  // Z/C moves your viewpoint around the object, B/N moves the object under
  // a fixed viewpoint, useful for lining the scene up against the grid
  // without the camera's perspective distortion changing mid-adjustment. V
  // cycles the up-axis orientation preset (see ORIENTATION_PRESETS) - there's
  // no single convention every gaussian-splatting capture tool actually
  // follows, so rather than commit to one hardcoded guess, this is a fast,
  // no-reload way to step through the plausible ones until one looks right.
  // Deliberately NOT bound to arrow keys/Space - those are already global
  // app shortcuts (playhead step, play/pause) bound on `window`, and reusing
  // them here would fire both at once ('A' used to be About, freed up for
  // strafe - see useKeyboardShortcuts.ts). Active only while the pointer is
  // over this panel, so it doesn't hijack keys from other panels or the rest
  // of the app; keys are read on `window` (hover alone doesn't grant
  // keyboard focus) but gated by the hover flag.
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    const heldKeys = new Set<string>();
    const FLY_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyZ', 'KeyC', 'KeyB', 'KeyN']);
    const TURN_SPEED = 1.5; // radians/sec

    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isHoveringRef.current || isTypingTarget(e.target)) return;
      if (e.code === 'KeyV') {
        const viewer = viewerRef.current;
        const mesh = viewer?.splatMesh;
        if (!mesh || mesh.getSplatCount() === 0) return;
        const next = (orientationIndexRef.current + 1) % ORIENTATION_PRESETS.length;
        const scene = mesh.getScene(0);
        // Resets position too, not just quaternion: B/N (spin) can leave the
        // scene's position offset from origin (it rotates position along with
        // quaternion to spin around the pivot rather than the object's own
        // local origin - see the fly-through tick loop). A preset should
        // always be a clean, canonical orientation, not compounded with
        // whatever spinning happened before this press.
        scene.position.set(0, 0, 0);
        scene.quaternion.copy(ORIENTATION_PRESETS[next].quaternion);
        mesh.updateTransforms();
        orientationIndexRef.current = next;
        setOrientationIndex(next);
        applyOrientationFit(refs, viewer, referenceGeometryRef);
        refs.renderOnce();
        return;
      }
      if (!FLY_CODES.has(e.code)) return;
      heldKeys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => heldKeys.delete(e.code);
    const onBlur = () => heldKeys.clear();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const delta = new THREE.Vector3();
    const spinQuat = new THREE.Quaternion();
    const spinOffset = new THREE.Vector3();
    let lastTime = performance.now();
    let rafId = requestAnimationFrame(tick);

    function tick(now: number) {
      rafId = requestAnimationFrame(tick);
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      if (heldKeys.size === 0) return;
      const live = sceneRef.current;
      if (!live) return;

      const distance = live.camera.position.distanceTo(live.controls.target);
      const moveSpeed = Math.min(Math.max(distance * 0.6, 0.5), 200);

      live.camera.getWorldDirection(forward);
      right.crossVectors(forward, live.camera.up).normalize();
      delta.set(0, 0, 0);
      if (heldKeys.has('KeyW')) delta.addScaledVector(forward, moveSpeed * dt);
      if (heldKeys.has('KeyS')) delta.addScaledVector(forward, -moveSpeed * dt);
      if (heldKeys.has('KeyD')) delta.addScaledVector(right, moveSpeed * dt);
      if (heldKeys.has('KeyA')) delta.addScaledVector(right, -moveSpeed * dt);
      if (heldKeys.has('KeyR')) delta.addScaledVector(live.camera.up, moveSpeed * dt);
      if (heldKeys.has('KeyF')) delta.addScaledVector(live.camera.up, -moveSpeed * dt);
      if (delta.lengthSq() > 0) {
        live.camera.position.add(delta);
        live.controls.target.add(delta);
      }

      let yaw = 0;
      if (heldKeys.has('KeyQ')) yaw += TURN_SPEED * dt;
      if (heldKeys.has('KeyE')) yaw -= TURN_SPEED * dt;
      if (yaw !== 0) {
        offset.copy(live.controls.target).sub(live.camera.position);
        offset.applyAxisAngle(live.camera.up, yaw);
        live.controls.target.copy(live.camera.position).add(offset);
      }

      // Orbit around the pivot (target stays fixed, camera swings around
      // it) - the keyboard equivalent of mouse-drag rotate, as distinct from
      // Q/E above which turns in place around the camera itself. Unlike
      // W/A/S/D/R/F/Q/E, this never moves the target, so it doesn't
      // invalidate a custom shift+click pivot - orbiting around exactly
      // that point is the point.
      let orbit = 0;
      if (heldKeys.has('KeyZ')) orbit += TURN_SPEED * dt;
      if (heldKeys.has('KeyC')) orbit -= TURN_SPEED * dt;
      if (orbit !== 0) {
        offset.copy(live.camera.position).sub(live.controls.target);
        offset.applyAxisAngle(live.camera.up, orbit);
        live.camera.position.copy(live.controls.target).add(offset);
      }

      // Spin the splat itself around the pivot (camera and target both stay
      // put) - the object-space counterpart to Z/C's camera orbit. Rotating
      // just the scene's quaternion would swing the cloud around its own
      // (usually off-center) local origin instead of the pivot the user is
      // actually looking at, so the position is counter-rotated too: the
      // point currently sitting at the pivot stays there, everything else
      // swings around it.
      let objectYaw = 0;
      if (heldKeys.has('KeyB')) objectYaw += TURN_SPEED * dt;
      if (heldKeys.has('KeyN')) objectYaw -= TURN_SPEED * dt;
      if (objectYaw !== 0) {
        const mesh = viewerRef.current?.splatMesh;
        if (mesh && mesh.getSplatCount() > 0) {
          const scene = mesh.getScene(0);
          spinQuat.setFromAxisAngle(live.camera.up, objectYaw);
          spinOffset.copy(scene.position).sub(live.controls.target);
          spinOffset.applyQuaternion(spinQuat);
          scene.position.copy(live.controls.target).add(spinOffset);
          scene.quaternion.premultiply(spinQuat);
          mesh.updateTransforms();
        }
      }

      if (delta.lengthSq() > 0 || yaw !== 0) {
        setPivot(null);
      }
      if (delta.lengthSq() > 0 || yaw !== 0 || orbit !== 0 || objectYaw !== 0) {
        live.controls.update();
        live.renderOnce();
      }
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [sceneRef]);

  // Visual marker at the custom pivot - wireframe sphere, depthTest off so it
  // stays visible against the splat cloud, matching ThreeDScene's convention.
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    const geometry = new THREE.SphereGeometry(0.15, 12, 8);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
      depthTest: false,
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.renderOrder = 999;
    marker.visible = false;
    refs.worldGroup.add(marker);
    pivotMarkerRef.current = marker;
    return () => {
      refs.worldGroup.remove(marker);
      geometry.dispose();
      material.dispose();
      pivotMarkerRef.current = null;
    };
  }, [sceneRef]);

  useEffect(() => {
    const marker = pivotMarkerRef.current;
    if (!marker) return;
    if (pivot) {
      marker.position.set(pivot.x, pivot.y, pivot.z);
      marker.visible = true;
    } else {
      marker.visible = false;
    }
    sceneRef.current?.renderOnce();
  }, [pivot, sceneRef]);

  const handleResetPivot = () => {
    const refs = sceneRef.current;
    const viewer = viewerRef.current;
    if (!refs) return;
    const bounds = viewer ? robustSplatBounds(viewer) : null;
    refs.setOrbitTarget(bounds ? bounds.center : new THREE.Vector3(0, 0, 0));
    setPivot(null);
  };

  const handleResetCamera = () => {
    const refs = sceneRef.current;
    const viewer = viewerRef.current;
    if (!refs) return;
    if (viewer) {
      fitCameraToSplats(refs, viewer);
    } else {
      refs.resetCamera(new THREE.Vector3(0, 0, 0), 10);
    }
    // Fit re-centres the orbit on the whole scene, which implicitly
    // overrides any manual pivot - drop the marker so the user isn't left
    // wondering why orbiting no longer happens around their picked point.
    setPivot(null);
  };

  return (
    <PanelShell panelId={panelId} kind="splat" topicName={topicName} type={type} bagId={bagId}>
      <div className="flex-1 flex flex-col min-h-0">
        <div
          className="flex-1 min-h-[260px] relative bg-bg-primary/60 overflow-hidden"
          onMouseEnter={() => { isHoveringRef.current = true; }}
          onMouseLeave={() => { isHoveringRef.current = false; }}
        >
          <div ref={containerRef} className="absolute inset-0" />

          {loadState.status === 'loaded' && (
            <div className="absolute top-2 left-2 text-xs mono text-text-tertiary pointer-events-none leading-relaxed">
              <div>shift+click sets orbit centre</div>
              <div>hover + W/S forward/back, A/D strafe, Q/E turn, R/F up/down, Z/C orbit</div>
              <div>B/N spin the splat, V cycle orientation</div>
            </div>
          )}

          <div className="absolute top-2 right-2 flex flex-col gap-1.5 items-end">
            <div className="flex gap-1">
              {pivot && (
                <button
                  onClick={handleResetPivot}
                  className="px-2 py-1 rounded-md text-xs mono bg-surface/80 border border-border hover:border-accent-blue/40 hover:text-accent-blue text-text-secondary transition-all"
                  title="Return orbit centre to the auto-fit point"
                >
                  Reset pivot
                </button>
              )}
              <button
                onClick={handleResetCamera}
                className="px-2 py-1 rounded-md text-xs mono bg-surface/80 border border-border hover:border-accent-blue/40 hover:text-accent-blue text-text-secondary transition-all"
                title="Reset camera"
              >
                Fit
              </button>
            </div>
          </div>

          {loadState.status === 'loading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-bg-primary/40 pointer-events-none">
              <div className="px-3 py-1.5 rounded-md text-xs mono bg-surface/90 border border-border text-text-secondary">
                Loading splats... {Math.round(loadState.percent)}%
              </div>
            </div>
          )}

          {loadState.status === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center bg-bg-primary/40 pointer-events-none">
              <div className="px-3 py-1.5 rounded-md text-xs mono bg-surface/90 border border-red-500/40 text-red-400 max-w-md text-center">
                {loadState.message}
              </div>
            </div>
          )}

          {loadState.status === 'loaded' && (
            <div className="absolute bottom-2 left-2 flex items-center gap-2 px-2 py-1 rounded-md text-xs mono bg-surface/80 border border-border text-text-secondary pointer-events-none">
              <span>{loadState.splatCount.toLocaleString()} splats</span>
              <span className="text-text-tertiary">· {ORIENTATION_PRESETS[orientationIndex].label} (V to cycle)</span>
            </div>
          )}
        </div>
      </div>
    </PanelShell>
  );
}
