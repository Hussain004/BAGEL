import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Node test environment doesn't ship `localStorage`, `window`, or
 * `URL.createObjectURL`. We polyfill the minimum surface the resolver
 * touches before importing it (the module reads `window` at hydrate time).
 */
function installBrowserPolyfills(): {
  storage: Map<string, string>;
  urls: Map<string, Blob>;
  restore: () => void;
} {
  const storage = new Map<string, string>();
  const urls = new Map<string, Blob>();
  let urlCounter = 0;

  const fakeStorage = {
    getItem: (key: string) => (storage.has(key) ? storage.get(key)! : null),
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => storage.clear(),
    key: (i: number) => Array.from(storage.keys())[i] ?? null,
    get length() {
      return storage.size;
    },
  };

  // Cast through `any` because the `Window` type carries dozens of fields
  // the test doesn't touch; reproducing them all here is noise.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fakeWindow: any = { localStorage: fakeStorage };
  const prevWindow = (globalThis as Record<string, unknown>).window;
  (globalThis as Record<string, unknown>).window = fakeWindow;

  const prevCreateObjectUrl = URL.createObjectURL;
  const prevRevokeObjectUrl = URL.revokeObjectURL;
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    urlCounter++;
    const out = `blob:test/${urlCounter}`;
    if (obj instanceof Blob) urls.set(out, obj);
    return out;
  };
  URL.revokeObjectURL = (url: string) => {
    urls.delete(url);
  };

  return {
    storage,
    urls,
    restore: () => {
      if (prevWindow === undefined) {
        delete (globalThis as Record<string, unknown>).window;
      } else {
        (globalThis as Record<string, unknown>).window = prevWindow;
      }
      URL.createObjectURL = prevCreateObjectUrl;
      URL.revokeObjectURL = prevRevokeObjectUrl;
    },
  };
}

// We re-import the module inside each test so the module-level `hydrated`
// flag resets cleanly.
async function loadResolver() {
  // Bust the cached module so the storage hydration runs fresh.
  vi.resetModules();
  return await import('../../src/parsers/packageResolver');
}

let cleanup: { restore: () => void; storage: Map<string, string>; urls: Map<string, Blob> } | null = null;

beforeEach(() => {
  cleanup = installBrowserPolyfills();
});

afterEach(() => {
  cleanup?.restore();
  cleanup = null;
});

function makeFile(path: string, contents: string): File {
  // Synthesise the webkitRelativePath the same way Chromium does for
  // `<input type="file" webkitdirectory>`.
  const file = new File([contents], path.split('/').pop() ?? path, {
    type: 'text/plain',
  });
  Object.defineProperty(file, 'webkitRelativePath', { value: path });
  return file;
}

describe('packageResolver - URL bindings', () => {
  it('persists URL bindings across reloads via localStorage', async () => {
    const { setUrlBinding, hasPackageBinding, resolveMeshUri } = await loadResolver();
    setUrlBinding('my_pkg', 'https://example.com/assets');
    expect(hasPackageBinding('my_pkg')).toBe(true);
    const resolved = await resolveMeshUri('package://my_pkg/meshes/base.stl');
    expect(resolved.url).toBe('https://example.com/assets/meshes/base.stl');
    expect(resolved.extension).toBe('stl');

    // Reload: re-import the module, the resolver hydrates from storage.
    const reloaded = await loadResolver();
    expect(reloaded.hasPackageBinding('my_pkg')).toBe(true);
    const reresolved = await reloaded.resolveMeshUri('package://my_pkg/foo/bar.obj');
    expect(reresolved.url).toBe('https://example.com/assets/foo/bar.obj');
  });

  it('normalises trailing slashes on URL prefixes', async () => {
    const { setUrlBinding, resolveMeshUri } = await loadResolver();
    setUrlBinding('my_pkg', 'https://cdn.example/');
    const a = await resolveMeshUri('package://my_pkg/x.stl');
    expect(a.url).toBe('https://cdn.example/x.stl');
    setUrlBinding('my_pkg', 'https://cdn.example///');
    const b = await resolveMeshUri('package://my_pkg/y.stl');
    expect(b.url).toBe('https://cdn.example/y.stl');
  });
});

describe('packageResolver - file bindings', () => {
  it('resolves package URIs to fresh object URLs from a folder drop', async () => {
    const { setFileBinding, resolveMeshUri } = await loadResolver();
    const baseFile = makeFile('robot_pkg/meshes/base.stl', 'stl-bytes');
    const armFile = makeFile('robot_pkg/meshes/arm.dae', 'dae-bytes');
    setFileBinding('robot_pkg', [baseFile, armFile], 'robot_pkg');

    const resolved = await resolveMeshUri('package://robot_pkg/meshes/base.stl');
    expect(resolved.url.startsWith('blob:test/')).toBe(true);
    expect(resolved.extension).toBe('stl');

    // The blob URL should hold the right file - check via the polyfilled map.
    const blob = cleanup?.urls.get(resolved.url);
    expect(blob).toBeDefined();
    expect(await blob!.text()).toBe('stl-bytes');

    // release() removes the URL from the polyfill map (mimics
    // URL.revokeObjectURL).
    resolved.release();
    expect(cleanup?.urls.get(resolved.url)).toBeUndefined();
  });

  it('falls back to suffix and basename matching when the drop root differs', async () => {
    const { setFileBinding, resolveMeshUri } = await loadResolver();
    // User dropped the *parent* of the package, so paths are prefixed with
    // an extra directory segment.
    const baseFile = makeFile('parent_dir/robot_pkg/meshes/base.stl', 'A');
    setFileBinding('robot_pkg', [baseFile], 'parent_dir');
    const resolved = await resolveMeshUri('package://robot_pkg/meshes/base.stl');
    expect(cleanup?.urls.get(resolved.url)).toBeDefined();
  });

  it('clearing a binding removes it everywhere', async () => {
    const { setUrlBinding, clearBinding, hasPackageBinding, resolveMeshUri } = await loadResolver();
    setUrlBinding('my_pkg', 'https://example.com');
    expect(hasPackageBinding('my_pkg')).toBe(true);
    clearBinding('my_pkg');
    expect(hasPackageBinding('my_pkg')).toBe(false);
    await expect(resolveMeshUri('package://my_pkg/x.stl')).rejects.toThrow(/No mapping/);
  });
});

describe('packageResolver - error paths', () => {
  it('errors clearly when no mapping exists for a package', async () => {
    const { resolveMeshUri } = await loadResolver();
    await expect(resolveMeshUri('package://unknown_pkg/meshes/foo.stl')).rejects.toThrow(
      /No mapping for package "unknown_pkg"/,
    );
  });

  it('errors for malformed package URIs', async () => {
    const { resolveMeshUri } = await loadResolver();
    await expect(resolveMeshUri('package://no_path_here')).rejects.toThrow(
      /Malformed package URI/,
    );
  });

  it('rejects file:// URIs explicitly', async () => {
    const { resolveMeshUri } = await loadResolver();
    await expect(resolveMeshUri('file:///abs/path/foo.stl')).rejects.toThrow(/file:\/\//);
  });

  it('passes http/https URIs through unchanged', async () => {
    const { resolveMeshUri } = await loadResolver();
    const r = await resolveMeshUri('https://example.com/meshes/base.STL?token=abc');
    expect(r.url).toBe('https://example.com/meshes/base.STL?token=abc');
    expect(r.extension).toBe('stl');
  });

  it('errors when a package file is mapped but the path is missing', async () => {
    const { setFileBinding, resolveMeshUri } = await loadResolver();
    setFileBinding('pkg', [makeFile('pkg/something_else.stl', 'A')], 'pkg');
    await expect(resolveMeshUri('package://pkg/meshes/missing.stl')).rejects.toThrow(
      /doesn't contain "meshes\/missing\.stl"/,
    );
  });
});
