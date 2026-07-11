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
 * Fit the scene's camera to the splat mesh, ignoring stray outliers.
 *
 * `computeBoundingBox()`'s min/max is not safe to fit a camera to: real
 * trained gaussian splat scenes very commonly carry a handful of stray
 * "floater" splats far from the main subject (a well-known training
 * artifact), and even one of them inflates the box enough to push the
 * camera back until the actual scene is a barely-visible speck. Instead,
 * sample splat centers directly, take the coordinate-wise median as a
 * robust centroid (unlike the box center, one outlier can't drag a median
 * far), and size the fit off the 90th-percentile distance from it rather
 * than the true max, so the handful of outlier splats in the excluded tail
 * don't determine the framing.
 */
function fitCameraToSplats(
  refs: { resetCamera: (target: THREE.Vector3, radius: number) => void },
  viewer: GaussianSplats3D.DropInViewer,
): void {
  const mesh = viewer.splatMesh;
  const count = mesh?.getSplatCount() ?? 0;
  if (!mesh || count === 0) return;

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
  if (xs.length === 0) return;

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);
  zs.sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  const center = new THREE.Vector3(xs[mid], ys[mid], zs[mid]);

  const dists = xs.map((_, i) => center.distanceTo(new THREE.Vector3(xs[i], ys[i], zs[i]))).sort((a, b) => a - b);
  const p90 = dists[Math.floor(dists.length * 0.9)];
  const radius = Math.max(p90 * 1.5, 3);
  refs.resetCamera(center, radius);
}

export function SplatViewer({ panelId, topicName, type, bagId }: SplatViewerProps) {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const source = entry?.source ?? null;
  const { containerRef, sceneRef } = useScene();
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const viewerRef = useRef<GaussianSplats3D.DropInViewer | null>(null);

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

  const handleResetCamera = () => {
    const refs = sceneRef.current;
    const viewer = viewerRef.current;
    if (!refs) return;
    if (viewer) {
      fitCameraToSplats(refs, viewer);
    } else {
      refs.resetCamera(new THREE.Vector3(0, 0, 0), 10);
    }
  };

  return (
    <PanelShell panelId={panelId} kind="splat" topicName={topicName} type={type} bagId={bagId}>
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 min-h-[260px] relative bg-bg-primary/60 overflow-hidden">
          <div ref={containerRef} className="absolute inset-0" />

          <div className="absolute top-2 right-2 flex flex-col gap-1.5 items-end">
            <button
              onClick={handleResetCamera}
              className="px-2 py-1 rounded-md text-xs mono bg-surface/80 border border-border hover:border-accent-blue/40 hover:text-accent-blue text-text-secondary transition-all"
              title="Reset camera"
            >
              Fit
            </button>
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
