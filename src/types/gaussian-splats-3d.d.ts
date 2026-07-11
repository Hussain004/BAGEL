/**
 * Minimal ambient types for `@mkkellogg/gaussian-splats-3d` (0.4.7), which
 * ships no type declarations of its own. Only the surface BAGEL actually
 * calls is declared; see node_modules/@mkkellogg/gaussian-splats-3d/build
 * for the full untyped API if more of it is needed later.
 */
declare module '@mkkellogg/gaussian-splats-3d' {
  import * as THREE from 'three';

  export interface SplatSceneOptions {
    path: string;
    format?: number;
    splatAlphaRemovalThreshold?: number;
    showLoadingUI?: boolean;
    position?: [number, number, number];
    rotation?: [number, number, number, number];
    scale?: [number, number, number];
    onProgress?: (percent: number, message?: string, stage?: unknown) => void;
  }

  export interface DropInViewerOptions {
    threeScene?: THREE.Scene;
    renderer?: THREE.WebGLRenderer;
    camera?: THREE.Camera;
    sharedMemoryForWorkers?: boolean;
    gpuAcceleratedSort?: boolean;
    halfPrecisionCovariancesOnGPU?: boolean;
  }

  export class SplatMesh extends THREE.Mesh {
    computeBoundingBox(applySceneTransforms?: boolean, sceneIndex?: number): THREE.Box3;
    getSplatCount(includeSinceLastBuild?: boolean): number;
  }

  export class DropInViewer extends THREE.Group {
    constructor(options?: DropInViewerOptions);
    splatMesh: SplatMesh | null;
    addSplatScene(path: string, options?: Omit<SplatSceneOptions, 'path'>): Promise<void>;
    addSplatScenes(sceneOptions: SplatSceneOptions[], showLoadingUI?: boolean): Promise<void>;
    getSceneCount(): number;
    dispose(): Promise<void>;
  }

  export enum SceneFormat {
    Splat = 0,
    KSplat = 1,
    Ply = 2,
    Spz = 3,
  }
}
