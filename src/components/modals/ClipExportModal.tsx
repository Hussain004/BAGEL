import { useRef, useState } from 'react';
import { ModalShell } from './ModalShell';
import { useUiStore } from '../../store/uiStore';
import { usePlayheadStore } from '../../store/playheadStore';
import { listCapturablePanelIds, captureCanvas } from '../../utils/captureRegistry';
import {
  waitForPanelRender,
  canvasToBlob,
  encodePngZip,
  encodeWebM,
  downloadBytes,
} from '../../utils/clipEncoder';

const KIND_LABEL: Record<string, string> = {
  '3d': '3D Scene',
  image: 'Image',
  plot: 'Plot',
  trajectory: 'Path',
};

function labelForPanelId(panelId: string): string {
  const [kind, ...rest] = panelId.split(':');
  // panelId format: kind:bagId:topicName  OR  kind:topicName (legacy, no bagId)
  const topicName = rest.length >= 2 ? rest.slice(1).join(':') : (rest[0] ?? '');
  return `${KIND_LABEL[kind] ?? kind}: ${topicName || '(unknown)'}`;
}

function stemFromPanelId(panelId: string): string {
  const parts = panelId.split(':');
  const topic = parts.at(-1) ?? 'clip';
  return topic.replace(/\//g, '_').replace(/^_+/, '') || 'clip';
}

type Phase = 'idle' | 'capturing' | 'encoding' | 'done' | 'error';

interface ExportState {
  phase: Phase;
  frame: number;
  total: number;
  errorMsg?: string;
}

const FPS_OPTIONS = [6, 12, 24, 30] as const;
type FpsOption = (typeof FPS_OPTIONS)[number];

export function ClipExportModal() {
  const close = () => useUiStore.getState().setModal(null);
  const { startNs, endNs } = usePlayheadStore();
  const durationSec = Math.max(0, Number(endNs - startNs) / 1e9);

  const [panelIds] = useState<string[]>(() => listCapturablePanelIds());
  const [selectedPanelId, setSelectedPanelId] = useState(panelIds[0] ?? '');
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(durationSec);
  const [fps, setFps] = useState<FpsOption>(12);
  const [format, setFormat] = useState<'png-zip' | 'webm'>('png-zip');
  const [exportState, setExportState] = useState<ExportState>({ phase: 'idle', frame: 0, total: 0 });
  const cancelRef = useRef(false);

  const clampedStart = Math.max(0, Math.min(startSec, durationSec));
  const clampedEnd = Math.max(clampedStart + 0.1, Math.min(endSec, durationSec));
  const windowSec = clampedEnd - clampedStart;
  const frameCount = Math.max(1, Math.round(windowSec * fps));
  const isRunning = exportState.phase === 'capturing' || exportState.phase === 'encoding';

  const handleExport = async () => {
    if (!selectedPanelId) return;
    cancelRef.current = false;

    const { startNs: bagStartNs } = usePlayheadStore.getState();
    const wasPlaying = usePlayheadStore.getState().playing;
    usePlayheadStore.getState().setPlaying(false);

    // Read canvas dimensions once before the loop (some panels lazy-allocate).
    const firstCanvas = captureCanvas(selectedPanelId);
    const width = firstCanvas?.width ?? 640;
    const height = firstCanvas?.height ?? 480;

    // Phase 1 - capture frames
    const frames: Blob[] = [];
    setExportState({ phase: 'capturing', frame: 0, total: frameCount });

    for (let i = 0; i < frameCount; i++) {
      if (cancelRef.current) break;
      const tNs = bagStartNs + BigInt(Math.round((clampedStart + i / fps) * 1e9));
      usePlayheadStore.getState().seek(tNs);
      await waitForPanelRender();
      if (cancelRef.current) break;
      const canvas = captureCanvas(selectedPanelId);
      if (canvas) {
        try { frames.push(await canvasToBlob(canvas)); } catch { /* skip blank */ }
      }
      setExportState({ phase: 'capturing', frame: i + 1, total: frameCount });
    }

    if (cancelRef.current || frames.length === 0) {
      if (wasPlaying) usePlayheadStore.getState().setPlaying(true);
      setExportState({ phase: 'idle', frame: 0, total: 0 });
      return;
    }

    // Phase 2 - encode
    setExportState({ phase: 'encoding', frame: frames.length, total: frames.length });
    const stem = stemFromPanelId(selectedPanelId);

    try {
      if (format === 'png-zip') {
        const zip = await encodePngZip(frames);
        downloadBytes(zip, `${stem}_clip.zip`);
      } else {
        const webm = await encodeWebM(frames, fps, width, height);
        downloadBytes(webm, `${stem}_clip.webm`);
      }
      setExportState({ phase: 'done', frame: frames.length, total: frames.length });
    } catch (e) {
      setExportState({ phase: 'error', frame: 0, total: 0, errorMsg: String(e) });
    }

    if (wasPlaying) usePlayheadStore.getState().setPlaying(true);
  };

  const progressPct =
    exportState.total > 0 ? Math.round((exportState.frame / exportState.total) * 100) : 100;

  return (
    <ModalShell
      title="Export Clip"
      subtitle="Render a panel frame-by-frame and download as PNG zip or WebM video"
      onClose={isRunning ? () => {} : close}
      width="sm"
    >
      <div className="px-6 py-4 space-y-5">
        {panelIds.length === 0 ? (
          <p className="text-text-muted text-sm text-center py-4">
            No capturable panels open. Open an Image, Plot, Trajectory, or 3D Scene panel first.
          </p>
        ) : (
          <>
            {/* Panel */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Panel</label>
              <select
                value={selectedPanelId}
                onChange={(e) => setSelectedPanelId(e.target.value)}
                disabled={isRunning}
                className="w-full bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-text-primary focus:outline-none focus:border-accent-blue/60 disabled:opacity-50"
              >
                {panelIds.map((id) => (
                  <option key={id} value={id}>
                    {labelForPanelId(id)}
                  </option>
                ))}
              </select>
            </div>

            {/* Time range */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Time range</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={durationSec}
                  step={0.1}
                  value={startSec.toFixed(1)}
                  onChange={(e) => setStartSec(Math.max(0, parseFloat(e.target.value) || 0))}
                  disabled={isRunning}
                  className="w-20 bg-surface border border-border rounded-md px-2 py-1 text-xs mono text-text-primary focus:outline-none focus:border-accent-blue/60 disabled:opacity-50"
                />
                <span className="text-text-muted text-xs mono">s</span>
                <span className="text-text-muted text-xs">to</span>
                <input
                  type="number"
                  min={0}
                  max={durationSec}
                  step={0.1}
                  value={endSec.toFixed(1)}
                  onChange={(e) =>
                    setEndSec(Math.min(durationSec, parseFloat(e.target.value) || durationSec))
                  }
                  disabled={isRunning}
                  className="w-20 bg-surface border border-border rounded-md px-2 py-1 text-xs mono text-text-primary focus:outline-none focus:border-accent-blue/60 disabled:opacity-50"
                />
                <span className="text-text-muted text-xs mono">s</span>
                <span className="text-text-muted text-xs mono ml-1 text-right">
                  = {windowSec.toFixed(1)}s
                </span>
              </div>
            </div>

            {/* FPS */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Frame rate</label>
              <div className="flex items-center gap-1.5">
                {FPS_OPTIONS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFps(f)}
                    disabled={isRunning}
                    className={`px-3 py-1 rounded-md text-xs mono border transition-[background-color,border-color,color,opacity] disabled:opacity-50 ${
                      fps === f
                        ? 'bg-accent-blue/10 border-accent-blue/40 text-accent-blue'
                        : 'bg-surface border-border text-text-secondary hover:border-accent-blue/40 hover:text-text-primary'
                    }`}
                  >
                    {f}
                  </button>
                ))}
                <span className="text-text-muted text-xs ml-1">fps</span>
              </div>
            </div>

            {/* Format */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">Format</label>
              <div className="flex gap-4">
                {(
                  [
                    ['png-zip', 'PNG frames (.zip)', 'Lossless, frame-accurate, large'],
                    ['webm', 'Video (.webm)', 'Compressed video, Chrome/Firefox'],
                  ] as const
                ).map(([v, label, hint]) => (
                  <label key={v} className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="clip-format"
                      value={v}
                      checked={format === v}
                      onChange={() => setFormat(v)}
                      disabled={isRunning}
                      className="mt-0.5 accent-accent-blue"
                    />
                    <span>
                      <span className="text-xs text-text-primary">{label}</span>
                      <span className="block text-[10px] text-text-muted">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Frame estimate */}
            <p className="text-xs text-text-muted mono">
              ~{frameCount.toLocaleString()} frames
              {frameCount > 200 && (
                <span className="text-accent-amber ml-2">
                  (export may take ~{Math.round(frameCount * 0.4)}s)
                </span>
              )}
            </p>
          </>
        )}

        {/* Progress */}
        {(exportState.phase === 'capturing' || exportState.phase === 'encoding') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-text-secondary mono">
                {exportState.phase === 'capturing'
                  ? `Capturing frame ${exportState.frame} / ${exportState.total}`
                  : 'Encoding video…'}
              </span>
              <span className="text-xs text-text-muted mono">{progressPct}%</span>
            </div>
            <div className="h-1.5 bg-surface rounded-full overflow-hidden">
              <div
                className="h-full bg-accent-blue rounded-full transition-colors duration-100"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {exportState.phase === 'done' && (
          <p className="text-xs text-accent-emerald mono">
            Done - {exportState.total} frames written.
          </p>
        )}

        {exportState.phase === 'error' && (
          <p className="text-xs text-accent-rose mono break-all">{exportState.errorMsg}</p>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-border flex justify-end gap-2">
        {isRunning ? (
          <button
            onClick={() => { cancelRef.current = true; }}
            className="px-3 py-1.5 rounded-md text-xs border border-border text-text-secondary hover:border-accent-rose/40 hover:text-accent-rose transition-colors"
          >
            Cancel
          </button>
        ) : (
          <>
            <button
              onClick={close}
              className="px-3 py-1.5 rounded-md text-xs border border-border text-text-secondary hover:border-border-hover transition-colors"
            >
              {exportState.phase === 'done' ? 'Close' : 'Cancel'}
            </button>
            {exportState.phase !== 'done' && panelIds.length > 0 && (
              <button
                onClick={handleExport}
                className="px-3 py-1.5 rounded-md text-xs bg-accent-blue/10 border border-accent-blue/40 text-accent-blue hover:bg-accent-blue/15 transition-colors"
              >
                Export
              </button>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}
