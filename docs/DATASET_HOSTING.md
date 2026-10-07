# Hosting a dataset so BAGEL can open it

BAGEL is a static web app, so it cannot read your disk. To let someone (or a
dataset README badge) open a bag without downloading it first, the bag has to
live at an HTTP URL that the browser will let BAGEL read directly.

This page is the part that trips people up. Every failure below looks identical
in the browser: `TypeError: Failed to fetch`. That is deliberate on the browser's
part (distinguishing "host unreachable" from "CORS rejected" would leak whether a
host exists), so BAGEL cannot guess either. What it takes is a short list of
headers.

## Requirements

BAGEL streams `.mcap` and `.bag` with HTTP Range requests, so only the bytes you
scrub through hit the network. That needs four things:

| Requirement | Why |
|---|---|
| `Access-Control-Allow-Origin` | Without it the browser blocks the response before BAGEL sees it. |
| `Content-Length`, exposed | BAGEL needs the total size to size the timeline and seek bar. |
| `Accept-Ranges: bytes` | Declares that partial reads are supported. |
| Working Range (HTTP 206) | A `Range` request must return 206 with the requested bytes. |
| `Content-Range`, exposed | Lets BAGEL verify the byte range it got back. |

Two subtleties that cause most of the remaining confusion:

- **`Content-Range` is not CORS-safelisted.** A server can send it correctly and
  the browser will still hide it from JavaScript unless it appears in
  `Access-Control-Expose-Headers`. This looks exactly like the server not
  sending it.
- **A host can advertise Range support and then ignore it.** Answering a
  `Range: bytes=0-15` request with `200 OK` and the entire body is not an error;
  it just means the browser buffers the whole multi-gigabyte file before anything
  renders. There is no error message for this one at all, which is why the Share
  modal probes for it.

### Checking your host

Open the app, load a bag by URL, then click **Share** and use the **Check a
dataset host** field. It runs the probe from `src/utils/corsProbe.ts` against your
URL and names the specific missing header with the fix. It reports what the
browser actually saw, not what the server config claims, so it also catches the
`Content-Range` exposure problem above.

## Copy-paste configurations

### Amazon S3

S3 satisfies all of it once CORS is configured. Range support is built in.

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges"],
    "MaxAgeSeconds": 3600
  }
]
```

```bash
aws s3api put-bucket-cors --bucket my-bucket --cors-configuration file://cors.json
```

Note that a **presigned** URL must be signed with the `Range` header in
`SignedHeaders`, or the ranged request returns 403 instead of 206.

### Google Cloud Storage

```bash
gcloud storage buckets update gs://my-bucket --cors-file=cors.json
```

```json
[
  {
    "origin": ["*"],
    "method": ["GET", "HEAD"],
    "responseHeader": ["Content-Length", "Content-Range", "Accept-Ranges"],
    "maxAgeSeconds": 3600
  }
]
```

### Cloudflare R2

R2 takes an S3-compatible CORS config:

```json
{
  "rules": [
    {
      "allowed": {
        "origins": ["*"],
        "methods": ["GET", "HEAD"],
        "headers": ["*"]
      },
      "exposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges"],
      "maxAgeSeconds": 3600
    }
  ]
}
```

### nginx

nginx supports Range natively. CORS is what you add:

```nginx
server {
    listen 443 ssl;
    server_name data.example.com;

    # Handle preflights for the parser's HEAD and ranged GET.
    if ($request_method = OPTIONS) {
        add_header Access-Control-Allow-Origin  "$http_origin";
        add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS";
        add_header Access-Control-Allow-Headers "Range";
        add_header Access-Control-Max-Age       86400;
        return 204;
    }

    add_header Access-Control-Allow-Origin   "$http_origin" always;
    # Without these two lines the browser hides the headers from JavaScript,
    # which makes Range support look broken even when it works.
    add_header Access-Control-Expose-Headers "Content-Length, Content-Range, Accept-Ranges" always;

    root /srv/datasets;

    # Let nginx answer Range requests itself (the default). Do not disable this:
    # proxy_buffering off is sometimes suggested, but the real requirement is
    # that the response status is 206 and Content-Range is present.
    location / {
        autoindex off;
        types { }
        default_type application/octet-stream;
    }
}
```

### Apache

```apache
<IfModule mod_headers.c>
    Header always set Access-Control-Allow-Origin "*"
    Header always set Access-Control-Expose-Headers "Content-Length, Content-Range, Accept-Ranges"
    Header always set Access-Control-Allow-Methods "GET, HEAD, OPTIONS"
</IfModule>
```

`mod_headers` is required. `Accept-Ranges` is on by default and must not be
overridden with `Header set Accept-Ranges none`.

## Hosts you cannot configure

If you cannot set headers on the host, BAGEL cannot stream from it directly. The
practical workarounds, in order of preference:

1. **Mirror it somewhere you control.** An S3 bucket or a small static server
   is enough, and a bag can be copied with `mc mirror` or `aws s3 sync`.
2. **GitHub Releases.** Release assets are served from
   `objects.githubusercontent.com` with CORS enabled. Not verified here (no
   release asset was available to probe), so check it with the probe before
   relying on it.
3. **A CDN in front of the origin** (Cloudflare, CloudFront) where you can add
   response headers at the edge. This often works even when the origin is not
   configurable, because the CDN controls the response headers it emits.

Hosts that are known **not** to work without a mirror:

### Hosts measured directly

The following was checked by issuing a real cross-origin `HEAD` and a real
`Range: bytes=0-15` request against each host, which is exactly what the Share
modal's probe does.

**Works: Hugging Face** (`huggingface.co/datasets/.../resolve/main/...`). Verified
2026-10-07. The `resolve` path 302-redirects to a CDN, and the final response
carries `Accept-Ranges: bytes`, a correct `Content-Length`,
`Access-Control-Allow-Origin: *`, and a ranged GET returns `206` with
`Content-Range: bytes 0-15/80359907`. One caveat: those are **presigned,
expiring** URLs, so a link baked into a README will expire and start failing
later. Use it for exploration and for links that get regenerated, not as a
permanent published link.

**Does not work: Zenodo.** Verified 2026-10-07. The file endpoint
(`/api/records/<id>/files/<name>/content`) answers a ranged request with
`200 OK` and the full body rather than `206`, sends no `Accept-Ranges`, and its
`Access-Control-Expose-Headers` lists only `Content-Type, ETag, Link` and rate
limit headers. So BAGEL cannot stream a Zenodo-hosted bag and will try to
download it whole. Mirror it to S3 or GCS first.

That is the complete list of hosts checked here, not a claim about all of them.
Host behaviour changes, so probe rather than trust this table: open the Share
modal, paste the direct download URL, and read what the probe reports. The probe
measures what the browser actually received, which catches cases a config
document would get wrong, including a server that sends `Content-Range` without
exposing it.

## Why the badge works at all

With a working host, a dataset README can link straight into a visualization:

```markdown
[![Open in BAGEL](https://bagel-ros2.vercel.app/badge.svg)](https://bagel-ros2.vercel.app/#b=https://data.example.com/robot-run.mcap)
```

BAGEL's Share modal generates the exact snippet for whatever layout you have open,
including the playhead position and bookmarks. The `b=` parameter is the bag URL;
the rest of the hash encodes the layout, so the link opens the same cockpit you
were looking at.

See `ROADMAP_UPGRADES.md` item A3 for the design behind this.