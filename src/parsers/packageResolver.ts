/**
 * Package resolver - v1.3.0
 *
 * Maps `package://<name>/<path>` URIs (as used by URDF `<mesh filename="…"/>`
 * elements) to concrete fetchable URLs or in-browser `File` handles.
 *
 * Why this needs to be its own module: URDFs reference meshes by ROS package
 * convention rather than by URL. BAGEL can't auto-resolve those - it has no
 * ROS distro to look in - so users tell us *once* where their
 * `<pkg>/meshes/` directory lives. We persist that choice in localStorage so
 * the next URDF that references the same package skips the prompt.
 *
 * Two binding kinds per package:
 *   - `file`: the user drag-dropped a folder. We hold `File` handles by
 *     relative path. `File` objects don't survive a reload, so the mapping
 *     re-prompts on the next browser session for file-bound packages (we
 *     persist the package name though, so the modal can show "you mapped
 *     `my_robot` last session - re-drop the folder?").
 *   - `url`: the user pasted a URL prefix (e.g. a CDN or GitHub raw URL).
 *     This DOES survive a reload because the prefix is just a string.
 *
 * Direct URI schemes (`file://`, `http://`, `https://`) pass through as
 * fetchable URLs without any resolver state - the resolver only kicks in
 * for `package://` URIs.
 */

const STORAGE_KEY = 'bagel:package-roots:v1';

export type PackageBinding =
  | { kind: 'file'; rootFiles: Map<string, File> }
  | { kind: 'url'; prefix: string };

export interface PackageMappingMetadata {
  /**
   * Last time the user touched this binding (ms since epoch). The modal can
   * use this to surface "stale, last seen N days ago" hints for file-kind
   * bindings whose `File` handles have since been dropped.
   */
  updatedAt: number;
  /** Sticky hint for the modal across reloads when the file binding is gone. */
  lastKnownFolderHint?: string;
}

interface SerialisedMapping {
  /** Persisted hint only - file bindings are not deserialised. */
  kind: 'url' | 'file';
  prefix?: string;
  updatedAt: number;
  lastKnownFolderHint?: string;
}

type ResolverListener = () => void;

/**
 * In-memory mappings. The `Map` keys are package names (e.g. "my_robot").
 *
 * `file` bindings live only in memory; `url` bindings are also persisted to
 * localStorage. The metadata map is kept separately because both kinds carry
 * the same timestamp/folder-hint state and we don't want to allocate it
 * twice.
 */
const bindings = new Map<string, PackageBinding>();
const metadata = new Map<string, PackageMappingMetadata>();
const listeners = new Set<ResolverListener>();

let hydrated = false;

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return;
    for (const [name, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as SerialisedMapping;
      const updatedAt = typeof e.updatedAt === 'number' ? e.updatedAt : Date.now();
      const meta: PackageMappingMetadata = { updatedAt };
      if (typeof e.lastKnownFolderHint === 'string') {
        meta.lastKnownFolderHint = e.lastKnownFolderHint;
      }
      metadata.set(name, meta);
      if (e.kind === 'url' && typeof e.prefix === 'string') {
        bindings.set(name, { kind: 'url', prefix: e.prefix });
      }
    }
  } catch {
    // Corrupted JSON - drop it.
  }
}

function persist(): void {
  if (typeof window === 'undefined') return;
  const out: Record<string, SerialisedMapping> = {};
  for (const [name, meta] of metadata.entries()) {
    const binding = bindings.get(name);
    if (binding?.kind === 'url') {
      out[name] = {
        kind: 'url',
        prefix: binding.prefix,
        updatedAt: meta.updatedAt,
      };
      if (meta.lastKnownFolderHint) {
        out[name].lastKnownFolderHint = meta.lastKnownFolderHint;
      }
    } else if (meta.lastKnownFolderHint) {
      // Persist the hint even without an active binding so the next session
      // can suggest "you mapped this from `meshes/my_robot/` last time".
      out[name] = {
        kind: 'file',
        updatedAt: meta.updatedAt,
        lastKnownFolderHint: meta.lastKnownFolderHint,
      };
    }
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch {
    // QuotaExceeded - in-memory copy still works for this session.
  }
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // Listener error shouldn't break others.
    }
  }
}

/**
 * Subscribe to mapping changes. Returns an unsubscribe.
 *
 * The modal listens so its "missing package" list refreshes after a binding
 * is added without needing a re-mount.
 */
export function subscribePackageResolver(fn: ResolverListener): () => void {
  hydrate();
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * True iff this package name has an active binding (file or URL).
 *
 * A persisted-but-not-rebound file binding does NOT count as active - the
 * `File` handles are gone after a reload.
 */
export function hasPackageBinding(name: string): boolean {
  hydrate();
  return bindings.has(name);
}

export function listPackageMappings(): Array<{
  name: string;
  binding: PackageBinding | null;
  metadata: PackageMappingMetadata | null;
}> {
  hydrate();
  const names = new Set<string>([...bindings.keys(), ...metadata.keys()]);
  return Array.from(names)
    .sort()
    .map((name) => ({
      name,
      binding: bindings.get(name) ?? null,
      metadata: metadata.get(name) ?? null,
    }));
}

/**
 * Set a file-backed binding. `files` is a list of `File` objects from a
 * `<input type="file" webkitdirectory>` or drag-dropped folder; we key them
 * by their relative path inside the dropped folder.
 *
 * `folderHint` is a short human label persisted across reloads (e.g. the
 * dropped folder's top-level name) so the modal can offer "re-drop the
 * folder" with context next session.
 */
export function setFileBinding(
  name: string,
  files: File[],
  folderHint?: string,
): void {
  hydrate();
  const rootFiles = new Map<string, File>();
  for (const file of files) {
    const rel = relativePathFor(file);
    if (!rel) continue;
    rootFiles.set(rel, file);
  }
  bindings.set(name, { kind: 'file', rootFiles });
  metadata.set(name, {
    updatedAt: Date.now(),
    lastKnownFolderHint: folderHint ?? metadata.get(name)?.lastKnownFolderHint,
  });
  persist();
  notify();
}

/**
 * Set a URL-backed binding. `prefix` is the URL up to (and including) the
 * `package://<name>/` boundary - everything after that is appended verbatim
 * for each mesh fetch.
 *
 * Accepts trailing slash or not; normalised to always end with `/`.
 */
export function setUrlBinding(name: string, prefix: string): void {
  hydrate();
  const trimmed = prefix.trim().replace(/\/+$/, '');
  if (!trimmed) {
    clearBinding(name);
    return;
  }
  bindings.set(name, { kind: 'url', prefix: `${trimmed}/` });
  const prev = metadata.get(name);
  metadata.set(name, {
    updatedAt: Date.now(),
    lastKnownFolderHint: prev?.lastKnownFolderHint,
  });
  persist();
  notify();
}

export function clearBinding(name: string): void {
  hydrate();
  bindings.delete(name);
  metadata.delete(name);
  persist();
  notify();
}

/**
 * Per-File relative path. We accept several shapes since the source varies:
 *   - `webkitdirectory` input: `file.webkitRelativePath = "robot_pkg/meshes/base.stl"`
 *   - DataTransferItem reader (drag-drop): we synthesise the same shape upstream
 *   - Plain file input: `name` only (treated as the relative path itself)
 */
function relativePathFor(file: File): string {
  type WithRelPath = File & { webkitRelativePath?: string };
  const rel = (file as WithRelPath).webkitRelativePath;
  if (typeof rel === 'string' && rel.length > 0) return rel;
  return file.name;
}

export interface ResolvedMesh {
  /** Object URL the loader can fetch from. */
  url: string;
  /** Suffix from the URI (e.g. `.stl`, `.dae`, `.obj`). Lower-cased. */
  extension: string;
  /** Caller releases this when the mesh load is done. Idempotent. */
  release: () => void;
}

/**
 * Resolve a URI (URDF `<mesh filename>` style) to a fetchable URL plus a
 * release callback.
 *
 * `package://<name>/<path>` - looks up the binding:
 *   - file kind → finds the matching `File`, returns `URL.createObjectURL`.
 *   - url kind  → returns `prefix + path`.
 * `file://...` → returns the rest of the path. Browsers won't fetch
 *   `file:` URLs from a non-file origin; surfaced explicitly so the user
 *   gets a meaningful error.
 * `http://` / `https://` → passes through unchanged.
 * Bare paths (no scheme) → treated as relative URLs; useful for mesh
 *   resources hosted alongside the URDF.
 *
 * Throws when the URI can't be resolved (missing package binding, missing
 * file inside a file binding, unknown scheme). The thrown error message is
 * user-facing and names the URI plus the specific failure reason.
 */
export async function resolveMeshUri(uri: string): Promise<ResolvedMesh> {
  hydrate();
  const trimmed = uri.trim();
  if (!trimmed) throw new Error('Empty mesh URI.');

  const extension = extractExtension(trimmed);

  if (trimmed.startsWith('package://')) {
    const match = trimmed.match(/^package:\/\/([^/]+)\/(.+)$/);
    if (!match) {
      throw new Error(`Malformed package URI: ${trimmed}`);
    }
    const pkg = match[1];
    const path = match[2];
    const binding = bindings.get(pkg);
    if (!binding) {
      throw new Error(
        `No mapping for package "${pkg}". Add a folder or URL prefix for it.`,
      );
    }
    if (binding.kind === 'url') {
      return { url: binding.prefix + path, extension, release: () => {} };
    }
    // file kind - find by exact relative path, then by name suffix fallback.
    const fileMatch =
      binding.rootFiles.get(path) ??
      findByPathSuffix(binding.rootFiles, path) ??
      findByBasename(binding.rootFiles, path);
    if (!fileMatch) {
      throw new Error(
        `Package "${pkg}" doesn't contain "${path}". ` +
          `Did you drop the right folder root?`,
      );
    }
    const objectUrl = URL.createObjectURL(fileMatch);
    return {
      url: objectUrl,
      extension,
      release: () => URL.revokeObjectURL(objectUrl),
    };
  }

  if (trimmed.startsWith('file://')) {
    throw new Error(
      `BAGEL can't fetch "file://" URIs from the browser. ` +
        `Add the file to a package mapping or rehost on http(s).`,
    );
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return { url: trimmed, extension, release: () => {} };
  }

  // Bare / relative path - usable in dev when meshes are served from /public.
  return { url: trimmed, extension, release: () => {} };
}

function extractExtension(uri: string): string {
  const m = uri.match(/\.([a-zA-Z0-9]+)(?:\?.*)?$/);
  return m ? m[1].toLowerCase() : '';
}

function findByPathSuffix(files: Map<string, File>, path: string): File | undefined {
  // Match `meshes/base.stl` against `robot_pkg/meshes/base.stl` (user dropped
  // the parent folder instead of the package root).
  for (const [key, file] of files) {
    if (key.endsWith(`/${path}`)) return file;
  }
  return undefined;
}

function findByBasename(files: Map<string, File>, path: string): File | undefined {
  // Last-ditch match by basename - useful when the dropped folder has a
  // different internal layout than the URDF expected.
  const basename = path.split('/').pop();
  if (!basename) return undefined;
  for (const [key, file] of files) {
    if (key.endsWith(`/${basename}`) || key === basename) return file;
  }
  return undefined;
}

/** Test hook: drop all in-memory bindings + persisted state. */
export function _resetPackageResolverForTests(): void {
  bindings.clear();
  metadata.clear();
  listeners.clear();
  hydrated = false;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}
