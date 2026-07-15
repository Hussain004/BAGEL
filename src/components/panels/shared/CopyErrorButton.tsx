import { useEffect, useRef, useState } from 'react';

/**
 * CopyErrorButton — small "copy the raw error text" affordance for error
 * states. Most failures here (corrupt file, worker exception, network
 * error) don't have a scripted next step, so the honest fallback is making
 * it one click to grab the exact text for a bug report instead of a
 * screenshot or manual retype.
 */
export function CopyErrorButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be unavailable (permissions / insecure context) -
      // the error text is still visible on screen to copy manually.
    }
  };

  return (
    <button
      onClick={onCopy}
      className="mt-1 px-2 py-1 rounded-md text-[11px] text-text-tertiary hover:text-text-primary hover:bg-surface-hover border border-border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
      aria-label="Copy error details"
    >
      <span aria-live="polite">{copied ? 'Copied' : 'Copy error details'}</span>
    </button>
  );
}
