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
 * app already uses for ThreeDScene. `sharedMemoryForWorkers`/
 * `gpuAcceleratedSort` stay off - the faster path needs SharedArrayBuffer,
 * which needs COOP/COEP response headers. BAGEL already ships those (see
 * vercel.json, required for sql.js), but keeping the splat path independent
 * of that config means it still works if those headers are ever removed.
 */
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import * as GaussianSplats3D from '@mkkellogg/gaussian-splats-3d';
import { useScene } from '../ThreeDScene/useScene';
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

/** Cap on how many splat centers to sample for the robust fit below. Real
 * scenes can carry millions of splats; a few thousand evenly-strided samples
 * are plenty to estimate the dense cluster's extent without reading every one. */
const FIT_SAMPLE_CAP = 20_000;

/**
 * Robust centroid + spread of a splat mesh, ignoring stray outliers.
 *
 * `computeBoundingBox()`'s min/max is not safe to fit a camera to: real
 * trained gaussian splat scenes very commonly carry a handful of stray
 * "floater" splats far from the main subject (a well-known training
 * artifact), and even one of them inflates the box enough to push the
 * camera back until the actual scene is a barely-visible speck. Instead,
 * sample splat centers directly, take the coordinate-wise median as a
 * robust centroid (unlike the box center, one outlier can't drag a median
 * far), and size the spread off the 90th-percentile distance from it rather
 * than the true max, so the handful of outlier splats in the excluded tail
 * don't determine the framing.
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
  const radius = dists[Math.floor(dists.length * 0.9)];
  return { center, radius };
}

/** Fit the scene's camera (position + orbit target) to the splat mesh. */
function fitCameraToSplats(
  refs: { resetCamera: (target: THREE.Vector3, radius: number) => void },
  viewer: GaussianSplats3D.DropInViewer,
): void {
  const bounds = robustSplatBounds(viewer);
  if (!bounds) return;
  refs.resetCamera(bounds.center, Math.max(bounds.radius * 1.5, 3));
}

export function SplatViewer({ panelId, topicName, type, bagId }: SplatViewerProps) {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const source = entry?.source ?? null;
  const { containerRef, sceneRef } = useScene();
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [pivot, setPivot] = useState<{ x: number; y: number; z: number } | null>(null);
  const viewerRef = useRef<GaussianSplats3D.DropInViewer | null>(null);
  const pivotMarkerRef = useRef<THREE.Mesh | null>(null);
  const isHoveringRef = useRef(false);

  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs || !source) return;

    let cancelled = false;
    let objectUrl: string | null = null;
    const viewer = new GaussianSplats3D.DropInViewer({
      threeScene: refs.scene,
      renderer: refs.renderer,
      camera: refs.camera,
      sharedMemoryForWorkers: false,
      gpuAcceleratedSort: false,
    });
    refs.scene.add(viewer);
    viewerRef.current = viewer;
    setLoadState({ status: 'loading', percent: 0 });

    const path =
      source.kind === 'file'
        ? (objectUrl = URL.createObjectURL(source.file))
        : source.url;
    const format = sceneFormatFor(sourceFileName(source));

    viewer
      .addSplatScene(path, {
        format,
        showLoadingUI: false,
        onProgress: (percent) => {
          if (cancelled) return;
          setLoadState({ status: 'loading', percent });
          refs.renderOnce();
        },
      })
      .then(() => {
        if (cancelled) return;
        fitCameraToSplats(refs, viewer);
        setLoadState({
          status: 'loaded',
          splatCount: viewer.splatMesh?.getSplatCount() ?? 0,
        });
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
  // to control. W/S move forward/back and Q/E turn left/right (rotating the
  // view around the camera's own position, not orbiting around the target -
  // a real "turn your head", distinct from mouse-drag rotate), R/F move
  // up/down. Deliberately NOT bound to arrow keys/Space/A - those are already
  // global app shortcuts (playhead step, play/pause, About) bound on
  // `window`, and reusing them here would fire both at once. Active only
  // while the pointer is over this panel, so it doesn't hijack keys from
  // other panels or the rest of the app; keys are read on `window` (hover
  // alone doesn't grant keyboard focus) but gated by the hover flag.
  useEffect(() => {
    const refs = sceneRef.current;
    if (!refs) return;
    const heldKeys = new Set<string>();
    const FLY_CODES = new Set(['KeyW', 'KeyS', 'KeyQ', 'KeyE', 'KeyR', 'KeyF']);
    const TURN_SPEED = 1.5; // radians/sec

    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isHoveringRef.current || !FLY_CODES.has(e.code) || isTypingTarget(e.target)) return;
      heldKeys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => heldKeys.delete(e.code);
    const onBlur = () => heldKeys.clear();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    const forward = new THREE.Vector3();
    const offset = new THREE.Vector3();
    const delta = new THREE.Vector3();
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
      delta.set(0, 0, 0);
      if (heldKeys.has('KeyW')) delta.addScaledVector(forward, moveSpeed * dt);
      if (heldKeys.has('KeyS')) delta.addScaledVector(forward, -moveSpeed * dt);
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

      if (delta.lengthSq() > 0 || yaw !== 0) {
        live.controls.update();
        live.renderOnce();
        setPivot(null);
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
              <div>hover + W/S forward/back, Q/E turn, R/F up/down</div>
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
            <div className="absolute bottom-2 left-2 px-2 py-1 rounded-md text-xs mono bg-surface/80 border border-border text-text-secondary pointer-events-none">
              {loadState.splatCount.toLocaleString()} splats
            </div>
          )}
        </div>
      </div>
    </PanelShell>
  );
}
