/**
 * PanelStates — the loading/error/empty chrome every panel needs. Was
 * copy-pasted into 7 panel files (13 near-identical implementations); one
 * shared version so a future tweak (icon, type scale, wording) lands
 * everywhere instead of drifting per panel.
 */

export function PanelLoadingState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
      <svg className="w-6 h-6 text-accent-blue animate-spin-slow" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span className="text-text-secondary text-sm">{message}</span>
    </div>
  );
}

export function PanelErrorState({
  message,
  title = 'Failed to load data',
}: {
  message: string;
  title?: string;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="text-accent-rose text-sm font-medium">{title}</div>
      <div className="text-text-secondary text-xs max-w-md">{message}</div>
    </div>
  );
}

export function PanelEmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-text-muted text-sm p-8">
      {message}
    </div>
  );
}
