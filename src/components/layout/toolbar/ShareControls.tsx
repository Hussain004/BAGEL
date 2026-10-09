import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../../../store/uiStore';

/**
 * CopyLinkButton - copies the current URL, whose hash already encodes the
 * open layout, playhead, and bag URL (see useUrlState). The feature existed
 * since v0.7 but nothing in the UI ever surfaced it.
 */
export function CopyLinkButton() {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (permissions / insecure context);
      // the same URL is still in the address bar, so fail quietly.
    }
  };
  return (
    <button
      onClick={onCopy}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition-colors ${
        copied
          ? 'border-accent-emerald/40 bg-accent-emerald/10 text-accent-emerald'
          : 'border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover hover:border-accent-blue/40'
      }`}
      title="Copy a link that restores this layout and playhead. Local bag files must be opened again by the recipient; URL-loaded bags restore automatically."
      aria-label="Copy link to this layout"
    >
      <LinkIcon />
      <span className="hidden xl:inline" aria-live="polite">
        {copied ? 'Copied' : 'Link'}
      </span>
    </button>
  );
}

/**
 * ShareButton - opens the Share modal, which builds a dataset badge and a
 * permalink. Separate from CopyLinkButton because the two answer different
 * questions: "give me this link" versus "how do I publish this".
 */
export function ShareButton() {
  const setModal = useUiStore((s) => s.setModal);
  return (
    <button
      onClick={() => setModal('share')}
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border border-border text-text-secondary hover:text-text-primary hover:bg-surface-hover hover:border-accent-blue/40 transition-colors"
      title="Build a shareable link or an Open in BAGEL badge for a dataset README"
      aria-label="Share this view"
    >
      <ShareIcon />
      <span className="hidden xl:inline">Share</span>
    </button>
  );
}

function ShareIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.7}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"
      />
    </svg>
  );
}
