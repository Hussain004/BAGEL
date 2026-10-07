import { useEffect, useRef, useState } from 'react';
import { ModalShell } from './ModalShell';
import { useBagStore } from '../../store/bagStore';
import { useUiStore } from '../../store/uiStore';
import { useLayoutStore } from '../../store/layoutStore';
import { usePlayheadStore } from '../../store/playheadStore';
import { useAnnotationStore } from '../../store/annotationStore';
import { encodeHash } from '../../hooks/useUrlState';
import { probeCors, type CorsProbeResult } from '../../utils/corsProbe';
import { DATASET_HOSTING_DOC_URL } from '../../utils/actionableError';
import { BadgePreview } from './BadgePreview';

/**
 * ShareModal - builds a permalink and a dataset badge for the current session.
 *
 * Why this exists: `useUrlState` has always encoded the full layout tree,
 * playhead, bag URL, and bookmarks into the location hash. That is a genuinely
 * differentiating feature (Foxglove needs an account to share a workspace) and
 * until v0.7 it had no UI at all. `CopyLinkButton` on the toolbar surfaces the
 * plain link; this modal goes one step further, for the case BAGEL cares about
 * most: publishing a dataset somewhere people can open it without downloading
 * it first.
 *
 * The badge snippet is the payload that matters. A dataset README carrying an
 * "Open in BAGEL" link is free, permanent distribution to exactly the audience
 * already reading dataset pages.
 *
 * The hard constraint: a badge only works if the bag lives at a URL, because
 * a local File handle cannot be serialised into a link. So for a local file we
 * show the layout-only link and explain precisely what the recipient has to do,
 * rather than emitting a snippet that silently fails for them.
 */

/** Where the deployed app lives. Used to build the badge's href. */
const APP_ORIGIN = 'https://bagel-ros2.vercel.app';

type SnippetKind = 'markdown' | 'link' | 'iframe';

interface Snippets {
  markdown: string;
  link: string;
  iframe: string;
}

export function ShareModal() {
  const setModal = useUiStore((s) => s.setModal);
  const source = useBagStore((s) => s.source);

  const [copied, setCopied] = useState<SnippetKind | null>(null);
  const [probeUrl, setProbeUrl] = useState('');
  const [probe, setProbe] = useState<CorsProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  // A local File cannot travel in a link, so the distinction between the two
  // cases drives what this modal offers rather than being a footnote.
  const bagUrl = source?.kind === 'url' ? source.url : null;
  const shareable = bagUrl !== null;

  const snippets: Snippets = buildSnippets(bagUrl);

  const onCopy = async (kind: SnippetKind, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard can be unavailable (insecure context, denied permission).
      // The snippet is on screen and selectable, so failing quietly is right.
    }
  };

  const runProbe = async () => {
    const trimmed = probeUrl.trim();
    if (!trimmed || probing) return;
    setProbing(true);
    setProbe(null);
    try {
      setProbe(await probeCors(trimmed));
    } finally {
      setProbing(false);
    }
  };

  return (
    <ModalShell
      title="Share this view"
      subtitle={shareable ? 'Anyone with this link opens the same bag, layout, and playhead.' : undefined}
      onClose={() => setModal(null)}
      width="lg"
    >
      <div className="flex flex-col gap-5">
        {!shareable && (
          <div className="rounded-lg border border-accent-amber/40 bg-accent-amber/10 p-3 text-xs leading-relaxed">
            <strong className="text-accent-amber">This bag is a local file.</strong>{' '}
            <span className="text-text-secondary">
              A link can carry the layout and playhead, but it cannot carry the file itself.
              The link below still works for you: reopening it restores your layout, and you
              drop the same bag in again. To give someone a link that opens the data
              directly, host the bag somewhere with CORS enabled, then load it by URL.
            </span>
          </div>
        )}

        <Snippet
          kind="markdown"
          label="Markdown badge for a dataset README"
          hint={
            shareable
              ? 'Links straight into this bag with the current layout.'
              : 'Opens BAGEL without the bag. Still worth pasting if you want people to know the tool exists, but host the bag and reload it by URL first to make it carry data.'
          }
          value={snippets.markdown}
          onCopy={onCopy}
          copied={copied === 'markdown'}
          // Shown either way: the badge image itself is valid regardless of
          // whether this particular link carries a bag, and seeing it load is
          // how the user knows `/badge.svg` resolves.
          preview={<BadgePreview href={snippets.link} />}
        />

        <Snippet
          kind="link"
          label="Plain link"
          value={snippets.link}
          onCopy={onCopy}
          copied={copied === 'link'}
        />

        <Snippet
          kind="iframe"
          label="Embed on a page"
          hint="Embeds the app in an iframe at a fixed height. Add ?embed=1 later for chrome-free embedding."
          value={snippets.iframe}
          onCopy={onCopy}
          copied={copied === 'iframe'}
        />

        <div className="border-t border-border pt-4">
          <h3 className="text-sm font-medium text-text-primary mb-1">Check a dataset host</h3>
          <p className="text-xs text-text-tertiary mb-3 leading-relaxed">
            Remote bags stream with HTTP Range requests, so the host needs CORS
            headers, an exposed <code className="mono">Content-Length</code>, and working
            Range support. Most failures look identical in the browser
            (<code className="mono">TypeError: Failed to fetch</code>), so this probe
            names the specific missing header. See{' '}
            <a
              href={DATASET_HOSTING_DOC_URL}
              target="_blank"
              rel="noreferrer"
              className="text-accent-blue hover:underline"
            >
              docs/DATASET_HOSTING.md
            </a>{' '}
            for copy-paste configs for S3, GCS, R2, and nginx.
          </p>

          <div className="flex gap-2">
            <input
              type="url"
              value={probeUrl}
              onChange={(e) => setProbeUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void runProbe();
                }
              }}
              placeholder="https://example.com/datasets/robot-run.mcap"
              className="flex-1 px-2.5 py-1.5 rounded-md bg-bg-primary border border-border text-xs mono text-text-primary focus:outline-none focus:border-accent-blue/60"
              aria-label="Dataset URL to check"
            />
            <button
              type="button"
              onClick={() => void runProbe()}
              disabled={probing || !probeUrl.trim()}
              className="px-3 py-1.5 rounded-md text-xs border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover disabled:opacity-50 transition-colors"
            >
              {probing ? 'Checking...' : 'Check'}
            </button>
          </div>

          {probe && <ProbeReport result={probe} />}

          {bagUrl && (
            <button
              type="button"
              onClick={() => setProbeUrl(bagUrl)}
              className="mt-2 text-xs text-accent-blue hover:underline"
            >
              Use the URL of the bag loaded right now
            </button>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function Snippet({
  kind,
  label,
  hint,
  value,
  onCopy,
  copied,
  preview,
}: {
  kind: SnippetKind;
  label: string;
  hint?: string;
  value: string;
  onCopy: (kind: SnippetKind, text: string) => void;
  copied: boolean;
  preview?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-medium text-text-primary">{label}</h3>
        <button
          type="button"
          onClick={() => onCopy(kind, value)}
          className={`px-2 py-1 rounded-md text-xs border transition-colors ${
            copied
              ? 'border-accent-emerald/40 bg-accent-emerald/10 text-accent-emerald'
              : 'border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover'
          }`}
        >
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      {hint && <p className="text-xs text-text-tertiary mb-2">{hint}</p>}
      {preview && <div className="mb-2">{preview}</div>}
      <pre className="px-2.5 py-2 rounded-md bg-bg-primary border border-border text-[11px] mono text-text-secondary overflow-x-auto whitespace-pre-wrap break-all">
        {value}
      </pre>
    </div>
  );
}

function ProbeReport({ result }: { result: CorsProbeResult }) {
  return (
    <div className="mt-3 rounded-lg border border-border overflow-hidden">
      <div
        className={`px-3 py-2 text-xs font-medium border-b border-border ${
          result.ok ? 'bg-accent-emerald/10 text-accent-emerald' : 'bg-accent-rose/10 text-accent-rose'
        }`}
      >
        {result.ok
          ? 'All requirements met. BAGEL can stream this bag.'
          : result.summary ?? 'This host is missing something BAGEL needs.'}
      </div>
      <ul className="divide-y divide-border">
        {result.checks.map((check) => (
          <li key={check.id} className="px-3 py-2 text-xs">
            <div className="flex items-start gap-2">
              <span aria-hidden="true" className={check.ok ? 'text-accent-emerald' : 'text-accent-rose'}>
                {check.ok ? '✓' : '✗'}
              </span>
              <div className="min-w-0">
                <div className="text-text-primary">{check.label}</div>
                {check.detail && (
                  <div className="text-text-tertiary mono text-[11px] mt-0.5 break-all">{check.detail}</div>
                )}
                {check.remedy && <div className="text-text-secondary mt-1 leading-relaxed">{check.remedy}</div>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Build the three snippets from the live session state.
 *
 * This deliberately reuses `encodeHash`, the exact serializer `useUrlState`
 * writes to the address bar, with the same arguments computed the same way
 * (`useUrlState.ts` lines 585-619). That matters more than it might look: if
 * the badge were generated by a second, parallel implementation it would drift
 * from what the app actually restores, and the failure would only surface in
 * someone else's dataset README. One codec, one behaviour.
 */
function buildSnippets(bagUrl: string | null): Snippets {
  const playhead = usePlayheadStore.getState();
  // Relative to the aligned window start, matching useUrlState. Under a
  // single bag this is still `timeNs - bag.startTime`, so v0.7/v0.8 links
  // keep round-tripping.
  const timeSec = Math.max(0, Number(playhead.timeNs - playhead.startNs) / 1e9);

  // Only bags with an explicit anchor go in the hash, so single-bag links
  // stay byte-identical to their pre-v0.9 form.
  const anchorMap = new Map<string, bigint>();
  for (const [id, entry] of useBagStore.getState().bags) {
    if (entry.anchorNs !== undefined) anchorMap.set(id, entry.anchorNs);
  }

  // Omitted entirely when empty so the common case produces a short hash.
  const { annotations } = useAnnotationStore.getState();
  const bookmarks =
    annotations.length > 0
      ? annotations.map((a) => ({
          timeSec: Math.max(0, Number(a.timeNs - playhead.startNs) / 1e9),
          label: a.label,
        }))
      : null;

  const hash = encodeHash(
    timeSec,
    useLayoutStore.getState().root,
    bagUrl,
    anchorMap.size > 0 ? anchorMap : null,
    bookmarks,
  );
  const href = `${APP_ORIGIN}/#${hash}`;

  return {
    markdown: `[![Open in BAGEL](${APP_ORIGIN}/badge.svg)](${href})`,
    link: href,
    iframe: `<iframe src="${href}" width="100%" height="600" style="border:1px solid #334155;border-radius:8px"></iframe>`,
  };
}