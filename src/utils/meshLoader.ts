/**
 * Three.js mesh loader dispatcher - v1.3.0
 *
 * One entry point: `loadMesh(uri)` → `THREE.Object3D`. The loader for the
 * file extension (.stl, .dae, .obj) is dynamically imported on first use so
 * the main bundle stays slim for users who only ever drop primitives-only
 * URDFs.
 *
 * Caching:
 *   - LRU keyed by the resolved URL. Capacity is bounded by both entry count
 *     (32 entries max) and total vertex count (~5M vertices) so a single
 *     ridiculous mesh can't keep three small ones from caching.
 *   - On eviction we dispose geometries + materials. The cache stores the
 *     loaded `Object3D` along with a clone factory so multiple panels can
 *     reuse the same parse without sharing scene-graph nodes (Three.js
 *     forbids reparenting an object that's already in a scene).
 *
 * Errors are caught at the dispatcher level and re-thrown as a single
 * shape: `MeshLoadError` carries the URI, the file kind, and a friendly
 * message so the modal can show "tried .stl, got: unexpected EOF" rather
 * than a stack trace.
 */

import * as THREE from 'three';
import { resolveMeshUri, resolveMeshUriSync, resolveRelativeUri, type ResolvedMesh } from '../parsers/packageResolver';

export type MeshKind = 'stl' | 'dae' | 'obj';

export class MeshLoadError extends Error {
  readonly uri: string;
  readonly kind: MeshKind | null;
  constructor(uri: string, kind: MeshKind | null, message: string) {
    super(`Failed to load mesh "${uri}": ${message}`);
    this.name = 'MeshLoadError';
    this.uri = uri;
    this.kind = kind;
  }
}

interface CacheEntry {
  /** Original parsed root - never added to a scene. Clones go to consumers. */
  source: THREE.Object3D;
  /** Approximate vertex count for budget tracking. */
  vertexCount: number;
}

const CACHE_MAX_ENTRIES = 32;
const CACHE_MAX_VERTICES = 5_000_000;
const cache = new Map<string, CacheEntry>();
let cachedVertices = 0;

// Lazy loader instances. Each is constructed once, then reused for every
// subsequent fetch of that file type.
let stlLoader: import('three/examples/jsm/loaders/STLLoader.js').STLLoader | null = null;
let objLoader: import('three/examples/jsm/loaders/OBJLoader.js').OBJLoader | null = null;

async function getStlLoader() {
  if (!stlLoader) {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    stlLoader = new STLLoader();
  }
  return stlLoader;
}

async function getObjLoader() {
  if (!objLoader) {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    objLoader = new OBJLoader();
  }
  return objLoader;
}

/** Prefix ColladaLoader puts in front of every texture path, so the URL modifier can recognise them. */
const TEXTURE_PREFIX = 'bagel-mesh-ref:';

/**
 * Parse a `.dae` whose textures are found the way the mesh itself was: a
 * relative `<init_from>` resolves against the mesh's own URI (so
 * `package://pkg/meshes/x.dae` + `../textures/t.png` is
 * `package://pkg/textures/t.png`) and then through the package resolver,
 * which is what makes a dropped folder work: the mesh is a blob URL there,
 * and paths relative to a blob URL lead nowhere.
 */
async function loadCollada(uri: string, resolved: ResolvedMesh): Promise<THREE.Object3D> {
  const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
  const releases: (() => void)[] = [];
  const manager = new THREE.LoadingManager();
  manager.setURLModifier((url) => {
    if (!url.startsWith(TEXTURE_PREFIX)) return url;
    try {
      const texture = resolveMeshUriSync(resolveRelativeUri(uri, url.slice(TEXTURE_PREFIX.length)));
      releases.push(texture.release);
      return texture.url;
    } catch {
      // Missing from the package: the mesh still shows, untextured, as before.
      return url.slice(TEXTURE_PREFIX.length);
    }
  });
  // Texture images finish loading after parse() returns; free their object URLs then.
  manager.onLoad = () => releases.splice(0).forEach((release) => release());
  const text = resolved.file ? await resolved.file.text() : await (await fetch(resolved.url)).text();
  const loader = new ColladaLoader(manager);
  loader.setResourcePath(TEXTURE_PREFIX);
  const dae = loader.parse(text, TEXTURE_PREFIX);
  if (!dae?.scene) throw new Error('Collada loader returned no scene.');
  return dae.scene;
}

function kindFromExtension(extension: string): MeshKind | null {
  switch (extension) {
    case 'stl':
      return 'stl';
    case 'dae':
      return 'dae';
    case 'obj':
      return 'obj';
    default:
      return null;
  }
}

function countVertices(object: THREE.Object3D): number {
  let total = 0;
  object.traverse((node) => {
    const geo = (node as THREE.Mesh).geometry;
    if (geo && (geo as THREE.BufferGeometry).attributes?.position) {
      total += (geo as THREE.BufferGeometry).attributes.position.count;
    }
  });
  return total;
}

function disposeRecursive(object: THREE.Object3D): void {
  object.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}

function evictUntilFit(needed: number): void {
  // Drop oldest entries first (insertion order on Map.keys()).
  while (
    cache.size > 0 &&
    (cache.size >= CACHE_MAX_ENTRIES || cachedVertices + needed > CACHE_MAX_VERTICES)
  ) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    const entry = cache.get(oldestKey);
    if (entry) {
      disposeRecursive(entry.source);
      cachedVertices -= entry.vertexCount;
    }
    cache.delete(oldestKey);
  }
}

function cloneForConsumer(source: THREE.Object3D): THREE.Object3D {
  // Shallow clone of the scene-graph; geometries + materials reuse the same
  // references (Three.js loaders return BufferGeometries which are safe to
  // share). If a consumer mutates a material we accept the cross-talk -
  // most callers tint via per-instance scale/colour state, not material
  // properties. The cost of a full deep-clone (material clones too) would
  // double memory for no real win on URDF visualisation.
  return source.clone(true);
}

/**
 * Load a mesh by URI. Resolves package:// via the resolver, picks the right
 * Three.js loader by extension, and returns a fresh `Object3D` the caller
 * can parent to its scene.
 *
 * Throws `MeshLoadError` on any failure (unresolved package, unknown
 * extension, malformed mesh bytes). Caller is expected to surface a
 * friendly fallback at the UI layer.
 */
export async function loadMesh(uri: string): Promise<THREE.Object3D> {
  const cached = cache.get(uri);
  if (cached) {
    // Refresh LRU position by re-inserting.
    cache.delete(uri);
    cache.set(uri, cached);
    return cloneForConsumer(cached.source);
  }

  let resolved: ResolvedMesh;
  try {
    resolved = await resolveMeshUri(uri);
  } catch (err) {
    throw new MeshLoadError(uri, null, err instanceof Error ? err.message : String(err));
  }

  const kind = kindFromExtension(resolved.extension);
  if (!kind) {
    resolved.release();
    throw new MeshLoadError(uri, null, `Unsupported file extension ".${resolved.extension || '?'}".`);
  }

  let object: THREE.Object3D;
  try {
    if (kind === 'stl') {
      const loader = await getStlLoader();
      const geometry = await loader.loadAsync(resolved.url);
      geometry.computeVertexNormals();
      object = new THREE.Mesh(
        geometry,
        new THREE.MeshLambertMaterial({ color: 0xcccccc }),
      );
    } else if (kind === 'obj') {
      const loader = await getObjLoader();
      object = await loader.loadAsync(resolved.url);
    } else {
      object = await loadCollada(uri, resolved);
    }
  } catch (err) {
    resolved.release();
    throw new MeshLoadError(uri, kind, err instanceof Error ? err.message : String(err));
  }
  resolved.release();

  const vertexCount = countVertices(object);
  evictUntilFit(vertexCount);
  cache.set(uri, { source: object, vertexCount });
  cachedVertices += vertexCount;
  return cloneForConsumer(object);
}

/** Drop everything in the cache + dispose underlying resources. */
export function clearMeshCache(): void {
  for (const entry of cache.values()) {
    disposeRecursive(entry.source);
  }
  cache.clear();
  cachedVertices = 0;
}
