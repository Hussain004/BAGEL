/**
 * CORS / HTTP Range probe for remote bag URLs.
 *
 * BAGEL streams remote `.mcap` and `.bag` files with HTTP Range requests, which
 * means the host has to satisfy four separate requirements. When one is
 * missing the browser reports it as a generic `TypeError: Failed to fetch`, and
 * `createUrlSource` can only guess at the cause. That is a bad experience for
 * someone trying to publish a dataset: they are asked to configure CORS and
 * given nothing specific to act on.
 *
 * This probe checks each requirement independently and names the exact missing
 * header, so the Share modal can tell a dataset author what to change instead
 * of showing them a fetch failure. See `docs/DATASET_HOSTING.md` for the
 * copy-paste server configs.
 *
 * It is deliberately a *probe*, not a gate. A failed probe never blocks the
 * user from trying the URL anyway, since some hosts work well enough despite
 * missing a header we would prefer (and browser behaviour varies).
 */

export interface CorsProbeResult {
  /** The URL that was probed, echoed back for display. */
  url: string;
  /** True when the host satisfied every requirement we depend on. */
  ok: boolean;
  /** Individual checks, in the order a reader would hit them. */
  checks: CorsProbeCheck[];
  /**
   * Short human summary of the outcome, or null when everything passed.
   * Never contains the URL twice; callers compose their own message.
   */
  summary: string | null;
}

export interface CorsProbeCheck {
  id: 'reachable' | 'cors' | 'accept-ranges' | 'range-honoured' | 'content-range-exposed' | 'content-length';
  label: string;
  ok: boolean;
  /**
   * What was actually observed, for the detail line. Null when the check
   * could not run at all (for example `range-honoured` after the CORS check
   * already failed), which is distinct from a failed check.
   */
  detail: string | null;
  /** The fix, when this specific check failed. */
  remedy: string | null;
}

/**
 * Classify one `fetch` rejection.
 *
 * A browser deliberately gives an identical opaque error for "server
 * unreachable", "CORS preflight rejected", and "response blocked by policy",
 * because distinguishing them would leak whether a host exists. So we can only
 * say "something about cross-origin policy", not which side is at fault.
 */
export function classifyFetchFailure(error: unknown): string {
  if (error instanceof TypeError) {
    return (
      'The request failed before a response arrived. The browser hides the real ' +
      'reason, but this is almost always either the host not sending CORS ' +
      'headers or the file not being reachable. Check the Access-Control-Allow-Origin ' +
      'header on the host.'
    );
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run the probe.
 *
 * Two requests: a HEAD for metadata, then a tiny ranged GET. The ranged GET is
 * the one that actually matters, because a host can advertise `Accept-Ranges:
 * bytes` and still answer a Range request with `200 OK` and the entire body,
 * which for a 4 GB bag means the browser tries to buffer the whole thing.
 */
export async function probeCors(url: string): Promise<CorsProbeResult> {
  const checks: CorsProbeCheck[] = [];

  // Step 1: HEAD for size and range capability.
  let head: Response;
  try {
    head = await fetch(url, { method: 'HEAD', mode: 'cors' });
  } catch (error) {
    checks.push({
      id: 'reachable',
      label: 'Host responds to a HEAD request',
      ok: false,
      detail: classifyFetchFailure(error),
      remedy:
        'The host must return a response to a cross-origin HEAD request. If it needs a signed or expiring URL, generate a fresh one.',
    });
    return finish(url, checks);
  }

  const reachableOk = head.ok;
  checks.push({
    id: 'reachable',
    label: 'Host responds to a HEAD request',
    ok: reachableOk,
    detail: reachableOk
      ? `HTTP ${head.status}`
      : `HTTP ${head.status} ${head.statusText}`,
    remedy: reachableOk ? null : 'The URL returned an error status. Check the path and that the file still exists.',
  });

  if (!reachableOk) return finish(url, checks);

  // A cross-origin HEAD that reached us at all means CORS headers were present
  // on the response; if they were not, the fetch above would have thrown.
  // Note this is true for simple GET/HEAD without custom headers, which is
  // exactly the shape of request the parser makes.
  checks.push({
    id: 'cors',
    label: 'Response includes CORS headers',
    ok: true,
    detail: 'The HEAD request completed, so Access-Control-Allow-Origin is present.',
    remedy: null,
  });

  const lenHeader = head.headers.get('content-length');
  const parsedLen = lenHeader === null ? NaN : Number(lenHeader);
  const lenOk = Number.isFinite(parsedLen) && parsedLen > 0;
  checks.push({
    id: 'content-length',
    label: 'Content-Length is exposed',
    ok: lenOk,
    detail: lenOk ? `${parsedLen} bytes` : lenHeader === null ? 'Header absent' : `Unusable value: "${lenHeader}"`,
    remedy: lenOk
      ? null
      : 'The host must return Content-Length and expose it to cross-origin readers. Most object stores do this by default.',
  });

  const acceptRanges = head.headers.get('accept-ranges');
  const rangesOk = acceptRanges !== null && acceptRanges.toLowerCase() !== 'none';
  checks.push({
    id: 'accept-ranges',
    label: 'Accept-Ranges advertises bytes',
    ok: rangesOk,
    detail: acceptRanges === null ? 'Header absent' : acceptRanges,
    remedy: rangesOk
      ? null
      : 'BAGEL needs HTTP Range to stream the file in chunks. Without it, a multi-GB bag must be downloaded whole before anything renders.',
  });

  // Step 2: actually ask for 16 bytes. This is the check that catches a host
  // claiming range support and then ignoring it.
  let ranged: Response;
  try {
    ranged = await fetch(url, { headers: { Range: 'bytes=0-15' }, mode: 'cors' });
  } catch (error) {
    checks.push({
      id: 'range-honoured',
      label: 'A ranged GET returns partial content',
      ok: false,
      detail: classifyFetchFailure(error),
      remedy: 'A request with a Range header failed outright. If the host signs URLs, the signature may not cover Range requests.',
    });
    return finish(url, checks);
  }

  // 206 is Partial Content. A 200 means the server ignored Range and is
  // sending the whole body, which is the failure mode worth catching: nothing
  // errors, the load just stalls until the whole file is buffered.
  const partialOk = ranged.status === 206;
  checks.push({
    id: 'range-honoured',
    label: 'A ranged GET returns partial content',
    ok: partialOk,
    detail: partialOk
      ? `HTTP 206 Partial Content`
      : ranged.status === 200
        ? 'HTTP 200 OK: the server ignored the Range header and sent the entire file.'
        : `HTTP ${ranged.status} ${ranged.statusText}`,
    remedy: partialOk
      ? null
      : ranged.status === 200
        ? 'The server returned the whole file instead of the requested 16 bytes. Enable HTTP Range support on the host.'
        : 'A ranged request should answer 206. Check whether the host rejects or mishandles Range requests.',
  });

  // Content-Range has to be *exposed* to be readable from JS: it is not a
  // CORS-safelisted response header, so without
  // Access-Control-Expose-Headers it reads as null even when the server sent it.
  const contentRange = ranged.headers.get('content-range');
  const exposedOk = contentRange !== null;
  checks.push({
    id: 'content-range-exposed',
    label: 'Content-Range is exposed to the browser',
    ok: exposedOk,
    detail: exposedOk
      ? contentRange
      : 'Header not readable from JavaScript. Either it was not sent, or Access-Control-Expose-Headers does not list it.',
    remedy: exposedOk
      ? null
      : 'Add Content-Range to Access-Control-Expose-Headers. Without it the browser hides the header even when the server sends it, and BAGEL cannot verify the returned byte range.',
  });

  // We only read the first 16 bytes, and always abort rather than reading a
  // body, so this cannot pull down a large file even on a host that ignored
  // the Range header.
  try {
    await ranged.body?.cancel();
  } catch {
    // Cancelling an already-consumed or errored body is not a problem.
  }

  return finish(url, checks);
}

/** Roll the checks up into an ok/summary pair. */
function finish(url: string, checks: CorsProbeCheck[]): CorsProbeResult {
  const failed = checks.filter((c) => !c.ok);
  let summary: string | null = null;

  if (failed.length === 1) {
    summary = `${failed[0].label} is missing`;
  } else if (failed.length > 1) {
    summary = `${failed.length} requirements are not met: ${failed.map((c) => c.label.toLowerCase()).join(', ')}`;
  }

  return { url, ok: failed.length === 0, checks, summary };
}