import type { ReactNode } from 'react';
import { useLayoutStore, type PanelKind } from '../../store/layoutStore';

interface PanelShellProps {
  panelId: string;
  kind: PanelKind;
  topicName: string;
  type: string;
  accentColor?: string;
  children: ReactNode;
}

const KIND_LABELS: Record<PanelKind, string> = {
  plot: 'Plot',
  image: 'Image',
  raw: 'Raw',
};

/**
 * PanelShell — Chrome shared by every panel. Provides a header with the topic
 * name, type, panel-kind label and a close button, and a flex content area
 * for the panel-specific UI.
 */
export function PanelShell({
  panelId,
  kind,
  topicName,
  type,
  accentColor,
  children,
}: PanelShellProps) {
  const closePanel = useLayoutStore((s) => s.closePanel);
  const parts = type.split('/');
  const shortType = parts[parts.length - 1] || type;
  const pkg = parts[0] || '';

  return (
    <div className="flex-1 flex flex-col min-h-0 rounded-xl border border-border bg-bg-secondary/60 backdrop-blur-md shadow-panel overflow-hidden animate-fade-in-scale">
      <header className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-surface/60">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: accentColor ?? '#94a3b8' }}
        />
        <span className="badge badge-slate flex-shrink-0">{KIND_LABELS[kind]}</span>
        <span className="mono text-sm text-text-primary font-medium truncate flex-1">
          {topicName}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0 text-xs">
          {pkg && <span className="text-text-muted mono">{pkg}/</span>}
          <span className="text-text-secondary mono">{shortType}</span>
        </div>
        <button
          onClick={() => closePanel(panelId)}
          className="ml-2 w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-all"
          title="Close panel"
          id={`close-panel-${panelId}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </header>
      <div className="flex-1 flex flex-col min-h-0">{children}</div>
    </div>
  );
}
