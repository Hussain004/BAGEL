import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  sourceKey,
  sourceDisplayName,
  sourceSize,
  sourceReadAll,
  sourceReadSlice,
  createFileSource,
  createUrlSource,
  HttpReadable,
  HttpFilelike,
  type BagSource,
} from '../../src/parsers/source';

// ── Mocked fetch infrastructure ───────────────────────────────────────────
// Each test registers a per-URL handler; the handler is the single source
// of truth for what the network "returns". Resetting between tests so we
// don't leak handlers across cases.

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response;
let handlers = new Map<string, FetchHandler>();
const originalFetch = globalThis.fetch;

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return (input as Request).url;
}

function installFetchMock() {
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    const handler = handlers.get(url);
    if (!handler) {
      return Promise.reject(new TypeError(`No handler registered for ${url}`));
    }
    return Promise.resolve(handler(input, init));
  };
}

function uninstallFetchMock() {
  globalThis.fetch = originalFetch;
}

beforeEach(() => {
  handlers = new Map();
  installFetchMock();
});
afterEach(() => {
  uninstallFetchMock();
  vi.restoreAllMocks();
});

// ── Helpers for crafting Response objects ─────────────────────────────────

function rangeResponse(
  body: Uint8Array,
  rangeHeader: string | null,
  contentLength: number,
): Response {
  if (!rangeHeader) {
    return new Response(body, {
      status: 200,
      headers: { 'content-length': String(contentLength) },
    });
  }
  const m = /^bytes=(\d+)-(\d+)$/.exec(rangeHeader);
  if (!m) {
    return new Response(null, { status: 416 });
  }
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (start > contentLength - 1 || end >= contentLength) {
    return new Response(null, { status: 416 });
  }
  return new Response(body.subarray(start, end + 1), {
    status: 206,
    headers: { 'content-length': String(end - start + 1) },
  });
}

// ── sourceKey / sourceDisplayName / sourceSize ────────────────────────────

describe('source/identity helpers', () => {
  it('sourceKey distinguishes files by name + size', () => {
    const a = createFileSource(new File([new Uint8Array(3)], 'a.bag'));
    const b = createFileSource(new File([new Uint8Array(5)], 'a.bag'));
    expect(sourceKey(a)).not.toBe(sourceKey(b));
  });

  it('sourceKey for URLs is the URL string', () => {
    const s: BagSource = {
      kind: 'url',
      url: 'https://example.com/x.mcap',
      contentLength: 100,
      displayName: 'x.mcap',
    };
    expect(sourceKey(s)).toBe('url:https://example.com/x.mcap');
  });

  it('sourceDisplayName / sourceSize work uniformly across kinds', () => {
    const file = createFileSource(new File([new Uint8Array(7)], 'tour.mcap'));
    expect(sourceDisplayName(file)).toBe('tour.mcap');
    expect(sourceSize(file)).toBe(7);
    const url: BagSource = {
      kind: 'url',
      url: 'https://example.com/data',
      contentLength: 999,
      displayName: 'data',
    };
    expect(sourceDisplayName(url)).toBe('data');
    expect(sourceSize(url)).toBe(999);
  });
});

// ── sourceReadAll / sourceReadSlice on File sources ───────────────────────

describe('source/sourceReadAll + sourceReadSlice on files', () => {
  it('reads the full file as a Uint8Array', async () => {
    const file = createFileSource(new File([new Uint8Array([1, 2, 3, 4])], 'x.bin'));
    const all = await sourceReadAll(file);
    expect(Array.from(all)).toEqual([1, 2, 3, 4]);
  });

  it('reads a slice with exclusive end', async () => {
    const file = createFileSource(new File([new Uint8Array([1, 2, 3, 4, 5])], 'x.bin'));
    const slice = await sourceReadSlice(file, 1, 4);
    expect(Array.from(slice)).toEqual([2, 3, 4]);
  });
});

// ── sourceReadAll on URL sources (eager GET) ──────────────────────────────

describe('source/sourceReadAll on URLs', () => {
  it('does a plain GET and returns the body bytes', async () => {
    const body = new Uint8Array([10, 20, 30]);
    handlers.set('https://example.com/x.bin', () => new Response(body, { status: 200 }));
    const url: BagSource = {
      kind: 'url',
      url: 'https://example.com/x.bin',
      contentLength: 3,
      displayName: 'x.bin',
    };
    const all = await sourceReadAll(url);
    expect(Array.from(all)).toEqual([10, 20, 30]);
  });

  it('throws with a CORS-flavoured message on non-2xx', async () => {
    handlers.set(
      'https://example.com/missing',
      () => new Response(null, { status: 404, statusText: 'Not Found' }),
    );
    const url: BagSource = {
      kind: 'url',
      url: 'https://example.com/missing',
      contentLength: 0,
      displayName: 'missing',
    };
    await expect(sourceReadAll(url)).rejects.toThrow(/HTTP 404 Not Found/);
  });
});

// ── HttpReadable (MCAP IReadable adapter) ─────────────────────────────────

describe('source/HttpReadable', () => {
  it('reports its size synchronously without re-fetching', async () => {
    const r = new HttpReadable('https://example.com/x.mcap', 12345n);
    expect(await r.size()).toBe(12345n);
  });

  it('issues Range requests and returns exactly the requested slice', async () => {
    const body = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    handlers.set('https://example.com/x.mcap', (_, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      return rangeResponse(body, headers?.Range ?? null, body.length);
    });

    const r = new HttpReadable('https://example.com/x.mcap', BigInt(body.length));
    const slice = await r.read(3n, 4n);
    expect(Array.from(slice)).toEqual([3, 4, 5, 6]);
  });

  it('throws a specific 416 message when the server reports Range Not Satisfiable', async () => {
    handlers.set('https://example.com/truncated', () => new Response(null, { status: 416 }));
    const r = new HttpReadable('https://example.com/truncated', 100n);
    await expect(r.read(50n, 1000n)).rejects.toThrow(/416 Range Not Satisfiable/);
  });

  it('throws a specific non-206 message when the server fails Range with another status', async () => {
    handlers.set('https://example.com/forbidden', () => new Response(null, { status: 403 }));
    const r = new HttpReadable('https://example.com/forbidden', 100n);
    await expect(r.read(0n, 10n)).rejects.toThrow(/Server returned 403/);
  });

  it('falls back to slicing a 200 + full-body response when the host ignores Range', async () => {
    const body = new Uint8Array(20);
    for (let i = 0; i < 20; i++) body[i] = i * 2;
    handlers.set(
      'https://example.com/full.mcap',
      () => new Response(body, { status: 200 }),
    );
    const r = new HttpReadable('https://example.com/full.mcap', BigInt(body.length));
    const slice = await r.read(5n, 4n);
    // Even though the server returned the full body, we should still get the
    // correct slice (offset 5, length 4 → [10, 12, 14, 16]).
    expect(Array.from(slice)).toEqual([10, 12, 14, 16]);
  });

  it('surfaces a CORS hint when fetch throws a TypeError', async () => {
    handlers.set('https://nope.example/x.mcap', () => {
      throw new TypeError('Failed to fetch');
    });
    const r = new HttpReadable('https://nope.example/x.mcap', 100n);
    await expect(r.read(0n, 10n)).rejects.toThrow(/cross-origin/i);
  });
});

// ── HttpFilelike (rosbag Filelike adapter) ────────────────────────────────

describe('source/HttpFilelike', () => {
  it('reports its size synchronously', () => {
    const r = new HttpFilelike('https://example.com/x.bag', 9999);
    expect(r.size()).toBe(9999);
  });

  it('range-reads identically to HttpReadable', async () => {
    const body = new Uint8Array(16);
    for (let i = 0; i < 16; i++) body[i] = i;
    handlers.set('https://example.com/x.bag', (_, init) => {
      const headers = init?.headers as Record<string, string> | undefined;
      return rangeResponse(body, headers?.Range ?? null, body.length);
    });
    const r = new HttpFilelike('https://example.com/x.bag', body.length);
    const slice = await r.read(8, 4);
    expect(Array.from(slice)).toEqual([8, 9, 10, 11]);
  });
});

// ── createUrlSource ───────────────────────────────────────────────────────

describe('source/createUrlSource', () => {
  it('resolves contentLength + displayName from a HEAD response', async () => {
    handlers.set('https://example.com/dataset/tour.mcap', (_, init) => {
      expect(init?.method).toBe('HEAD');
      return new Response(null, {
        status: 200,
        headers: { 'content-length': '4242', 'accept-ranges': 'bytes' },
      });
    });
    const src = await createUrlSource('https://example.com/dataset/tour.mcap');
    expect(src).toEqual({
      kind: 'url',
      url: 'https://example.com/dataset/tour.mcap',
      contentLength: 4242,
      displayName: 'tour.mcap',
    });
  });

  it('falls back to hostname for URLs with no usable basename', async () => {
    handlers.set(
      'https://example.com/',
      () =>
        new Response(null, {
          status: 200,
          headers: { 'content-length': '8' },
        }),
    );
    const src = await createUrlSource('https://example.com/');
    expect(src.kind).toBe('url');
    if (src.kind === 'url') expect(src.displayName).toBe('example.com');
  });

  it('throws a specific message when the server omits Content-Length', async () => {
    handlers.set(
      'https://example.com/no-clen',
      () => new Response(null, { status: 200 }),
    );
    await expect(createUrlSource('https://example.com/no-clen')).rejects.toThrow(
      /Content-Length/i,
    );
  });

  it('throws a specific message when Accept-Ranges: none', async () => {
    handlers.set(
      'https://example.com/no-range',
      () =>
        new Response(null, {
          status: 200,
          headers: { 'content-length': '100', 'accept-ranges': 'none' },
        }),
    );
    await expect(createUrlSource('https://example.com/no-range')).rejects.toThrow(
      /Accept-Ranges: none/,
    );
  });

  it('throws a CORS-flavoured message when fetch itself fails', async () => {
    handlers.set('https://nope.example/x', () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(createUrlSource('https://nope.example/x')).rejects.toThrow(
      /cross-origin/i,
    );
  });

  it('throws when Content-Length is non-numeric', async () => {
    handlers.set(
      'https://example.com/bad-clen',
      () =>
        new Response(null, {
          status: 200,
          headers: { 'content-length': 'not-a-number' },
        }),
    );
    await expect(createUrlSource('https://example.com/bad-clen')).rejects.toThrow(
      /invalid Content-Length/i,
    );
  });

  it('propagates HEAD failures (404, 403, etc.) with the status code', async () => {
    handlers.set(
      'https://example.com/missing',
      () => new Response(null, { status: 404, statusText: 'Not Found' }),
    );
    await expect(createUrlSource('https://example.com/missing')).rejects.toThrow(
      /HTTP 404 Not Found/,
    );
  });
});
