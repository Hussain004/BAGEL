/**
 * Tests for the CORS / Range probe.
 *
 * `fetch` is mocked rather than hitting a real host: the whole point of the
 * probe is to classify responses, and a real server would only let us test the
 * happy case. Each mock asserts the exact failure mode the probe is meant to
 * catch, which is the part worth pinning down.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { probeCors, classifyFetchFailure, type CorsProbeCheck } from '../../src/utils/corsProbe';

const TEST_URL = 'https://example.com/datasets/robot.mcap';

/** Find one check by id, failing loudly if the probe stopped emitting it. */
function check(result: { checks: CorsProbeCheck[] }, id: CorsProbeCheck['id']): CorsProbeCheck {
  const found = result.checks.find((c) => c.id === id);
  if (!found) throw new Error(`probe did not emit a "${id}" check; got: ${result.checks.map((c) => c.id).join(', ')}`);
  return found;
}

/**
 * Build a fetch mock from per-call responses.
 *
 * The probe makes at most two calls (HEAD, then ranged GET) and stops early on
 * failure, so `head` and `ranged` are optional and a missing one throws, which
 * catches an unexpected extra request.
 */
function mockFetch(opts: {
  head?: Response | Error;
  ranged?: Response | Error;
}) {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    const isHead = init?.method === 'HEAD';
    const value = isHead ? opts.head : opts.ranged;
    if (value === undefined) throw new Error(`unexpected ${isHead ? 'HEAD' : 'GET'} request`);
    if (value instanceof Error) throw value;
    return value;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** A HEAD response that passes everything up to the range check. */
function goodHead(overrides: Record<string, string> = {}) {
  return new Response(null, {
    status: 200,
    headers: { 'content-length': '4096', 'accept-ranges': 'bytes', ...overrides },
  });
}

describe('classifyFetchFailure', () => {
  it('treats a TypeError as a CORS or reachability problem, naming the header', () => {
    const message = classifyFetchFailure(new TypeError('Failed to fetch'));
    expect(message).toContain('Access-Control-Allow-Origin');
  });

  it('passes a non-TypeError message through unchanged', () => {
    expect(classifyFetchFailure(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-Error throwables', () => {
    expect(classifyFetchFailure('plain string')).toBe('plain string');
  });
});

describe('probeCors', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes when the host satisfies every requirement', async () => {
    mockFetch({
      head: goodHead(),
      ranged: new Response(new Uint8Array(16), {
        status: 206,
        headers: { 'content-range': 'bytes 0-15/4096' },
      }),
    });

    const result = await probeCors(TEST_URL);

    expect(result.ok).toBe(true);
    expect(result.summary).toBeNull();
    expect(result.checks.every((c) => c.ok)).toBe(true);
    expect(check(result, 'content-range-exposed').detail).toContain('bytes 0-15/4096');
  });

  it('reports an unreachable host and stops before making a second request', async () => {
    const fetchMock = mockFetch({ head: new TypeError('Failed to fetch') });

    const result = await probeCors(TEST_URL);

    expect(result.ok).toBe(false);
    expect(check(result, 'reachable').ok).toBe(false);
    // No point probing Range when we never got a response.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a non-OK HEAD status with the status code in the detail', async () => {
    mockFetch({ head: new Response(null, { status: 404, statusText: 'Not Found' }) });

    const result = await probeCors(TEST_URL);

    expect(result.ok).toBe(false);
    expect(check(result, 'reachable').detail).toContain('404');
    expect(check(result, 'reachable').remedy).toContain('URL');
  });

  it('flags a missing Content-Length', async () => {
    const head = new Response(null, { status: 200, headers: { 'accept-ranges': 'bytes' } });
    mockFetch({
      head,
      ranged: new Response(new Uint8Array(16), {
        status: 206,
        headers: { 'content-range': 'bytes 0-15/4096' },
      }),
    });

    const result = await probeCors(TEST_URL);

    expect(check(result, 'content-length').ok).toBe(false);
    expect(result.summary).toContain('Content-Length');
  });

  it('flags a non-numeric Content-Length as unusable rather than absent', async () => {
    mockFetch({
      head: goodHead({ 'content-length': 'not-a-number' }),
      ranged: new Response(new Uint8Array(16), { status: 206 }),
    });

    const result = await probeCors(TEST_URL);

    const len = check(result, 'content-length');
    expect(len.ok).toBe(false);
    expect(len.detail).toContain('not-a-number');
  });

  it('flags Accept-Ranges: none, the explicit "no range support" signal', async () => {
    mockFetch({ head: goodHead({ 'accept-ranges': 'none' }) });

    const result = await probeCors(TEST_URL);

    const ranges = check(result, 'accept-ranges');
    expect(ranges.ok).toBe(false);
    expect(ranges.detail).toBe('none');
  });

  it('catches a host that claims Range support but returns 200 with the whole body', async () => {
    // This is the failure worth catching above all: nothing errors, the load
    // just silently stalls while a multi-GB file is buffered.
    mockFetch({
      head: goodHead(),
      ranged: new Response(new Uint8Array(16), { status: 200 }),
    });

    const result = await probeCors(TEST_URL);

    const honoured = check(result, 'range-honoured');
    expect(honoured.ok).toBe(false);
    expect(honoured.detail).toContain('200');
    expect(honoured.detail).toContain('entire file');
  });

  it('flags Content-Range that the server sent but CORS did not expose', async () => {
    // A 206 with no readable Content-Range is the subtle one: the server
    // behaved correctly, but the browser hides the header from JS, so BAGEL
    // still cannot verify the byte range it got back.
    mockFetch({
      head: goodHead(),
      ranged: new Response(new Uint8Array(16), { status: 206 }),
    });

    const result = await probeCors(TEST_URL);

    const exposed = check(result, 'content-range-exposed');
    expect(exposed.ok).toBe(false);
    expect(exposed.remedy).toContain('Access-Control-Expose-Headers');
  });

  it('reports an unexpected status on the ranged GET', async () => {
    mockFetch({
      head: goodHead(),
      ranged: new Response(null, { status: 416, statusText: 'Range Not Satisfiable' }),
    });

    const result = await probeCors(TEST_URL);

    const honoured = check(result, 'range-honoured');
    expect(honoured.ok).toBe(false);
    expect(honoured.detail).toContain('416');
  });

  it('stops and reports when the ranged GET itself throws', async () => {
    mockFetch({ head: goodHead(), ranged: new TypeError('Failed to fetch') });

    const result = await probeCors(TEST_URL);

    expect(result.ok).toBe(false);
    expect(check(result, 'range-honoured').ok).toBe(false);
    // Nothing after a thrown ranged request can be assessed.
    expect(result.checks.find((c) => c.id === 'content-range-exposed')).toBeUndefined();
  });

  it('summarises a fully-permissive head by naming every unmet requirement', async () => {
    // No CORS headers on the HEAD at all, and a 200 in reply to a Range
    // request. In a real browser this combination is unreachable (a head
    // without Access-Control-Allow-Origin fails the fetch outright), but the
    // probe must still degrade gracefully rather than mis-report.
    mockFetch({
      head: new Response(null, { status: 200, headers: {} }),
      ranged: new Response(new Uint8Array(16), { status: 200 }),
    });

    const result = await probeCors(TEST_URL);

    expect(result.ok).toBe(false);
    expect(result.summary).toContain('requirements are not met');
    // Names every failed check by its label, lowercased.
    expect(result.summary).toContain('content-length is exposed');
    expect(result.summary).toContain('accept-ranges advertises bytes');
    expect(result.summary).toContain('a ranged get returns partial content');
    expect(result.summary).toContain('content-range is exposed to the browser');
  });

  it('summarises a single failure in plain language', async () => {
    // Exactly one unmet requirement: the host omits Accept-Ranges but honours
    // Range anyway. The summary should name just that one, without the
    // "N requirements" phrasing that reads badly for a single item.
    mockFetch({
      head: goodHead({ 'accept-ranges': 'none' }),
      ranged: new Response(new Uint8Array(16), {
        status: 206,
        headers: { 'content-range': 'bytes 0-15/4096' },
      }),
    });

    const result = await probeCors(TEST_URL);

    expect(result.checks.filter((c) => !c.ok)).toHaveLength(1);
    expect(result.summary).toBe('Accept-Ranges advertises bytes is missing');
  });

  it('echoes the probed URL back for display', async () => {
    mockFetch({ head: goodHead(), ranged: new Response(new Uint8Array(16), { status: 206 }) });
    const result = await probeCors(TEST_URL);
    expect(result.url).toBe(TEST_URL);
  });

  it('tolerates a missing body on the ranged response', async () => {
    // Body cancellation is best-effort; a host that already closed the stream
    // must not turn a successful probe into a thrown error.
    mockFetch({
      head: goodHead(),
      ranged: new Response(null, { status: 206, headers: { 'content-range': 'bytes 0-15/4096' } }),
    });

    await expect(probeCors(TEST_URL)).resolves.toBeDefined();
  });
});