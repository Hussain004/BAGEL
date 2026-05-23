import { useEffect, useMemo, useRef, useState } from 'react';
import { useTopicMessages } from '../../../hooks/useTopicMessages';
import { usePlayheadStore } from '../../../store/playheadStore';
import { nearestMessageIndex, isCompressedImageType } from '../../../utils/messages';
import { nsToSeconds } from '../../../utils/time';
import { PanelShell } from '../PanelShell';
import { getTopicColor } from '../../../utils/color';

interface ImageViewerProps {
  panelId: string;
  topicName: string;
  type: string;
}

/**
 * ImageViewer — Renders the current frame for a sensor_msgs/Image or
 * sensor_msgs/CompressedImage topic at the global playhead time.
 */
export function ImageViewer({ panelId, topicName, type }: ImageViewerProps) {
  const { messages, loading, error } = useTopicMessages(topicName);
  const playheadNs = usePlayheadStore((s) => s.timeNs);
  const seek = usePlayheadStore((s) => s.seek);
  const compressed = isCompressedImageType(type);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const currentIndex = useMemo(() => {
    if (!messages || messages.length === 0) return -1;
    return nearestMessageIndex(messages, playheadNs);
  }, [messages, playheadNs]);

  const currentMsg = currentIndex >= 0 && messages ? messages[currentIndex] : null;
  const [renderError, setRenderError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ width: number; height: number; encoding: string } | null>(
    null,
  );

  useEffect(() => {
    setRenderError(null);
    if (!currentMsg?.value || !canvasRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const bitmap = compressed
          ? await decodeCompressed(currentMsg.value!)
          : await decodeRaw(currentMsg.value!);
        if (cancelled) {
          bitmap?.close?.();
          return;
        }
        const canvas = canvasRef.current!;
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close?.();
        setMeta({
          width: bitmap.width,
          height: bitmap.height,
          encoding: (currentMsg.value!.encoding as string) ?? (compressed ? 'compressed' : 'raw'),
        });
      } catch (err) {
        if (cancelled) return;
        setRenderError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentMsg, compressed]);

  const accent = getTopicColor(topicName, type);

  return (
    <PanelShell panelId={panelId} kind="image" topicName={topicName} type={type} accentColor={accent}>
      {loading && <PanelLoadingState message="Decoding frames…" />}
      {error && <PanelErrorState message={error} />}
      {!loading && !error && (!messages || messages.length === 0) && (
        <PanelEmptyState message="No image messages on this topic." />
      )}
      {messages && messages.length > 0 && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 flex items-center justify-center bg-bg-primary/60 overflow-hidden min-h-[200px] p-3">
            {renderError ? (
              <div className="text-center max-w-md">
                <div className="text-accent-rose text-sm font-medium mb-1">
                  Could not decode frame
                </div>
                <div className="text-text-muted text-xs">{renderError}</div>
              </div>
            ) : (
              <canvas
                ref={canvasRef}
                className="max-w-full max-h-full object-contain rounded-md border border-border"
              />
            )}
          </div>

          <div className="px-4 py-2 border-t border-border flex items-center gap-3 mono text-xs text-text-secondary">
            <FrameStepper
              currentIndex={currentIndex}
              total={messages.length}
              onJump={(i) => seek(messages[i].timestamp)}
            />
            <div className="flex-1 text-right">
              {meta && (
                <span>
                  <span className="text-text-primary">{meta.width}×{meta.height}</span>
                  <span className="text-text-muted ml-2">{meta.encoding}</span>
                </span>
              )}
            </div>
          </div>

          <div className="px-4 py-1.5 border-t border-border flex items-center justify-between text-text-muted text-xs mono">
            <span>
              frame {Math.max(0, currentIndex) + 1} / {messages.length}
            </span>
            {currentMsg && (
              <span>
                t = {nsToSeconds(currentMsg.timestamp - messages[0].timestamp).toFixed(3)}s
              </span>
            )}
          </div>
        </div>
      )}
    </PanelShell>
  );
}

function FrameStepper({
  currentIndex,
  total,
  onJump,
}: {
  currentIndex: number;
  total: number;
  onJump: (i: number) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onJump(Math.max(0, currentIndex - 1))}
        disabled={currentIndex <= 0}
        className="w-7 h-7 rounded-md flex items-center justify-center bg-surface border border-border hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        title="Previous frame"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
      </button>
      <button
        onClick={() => onJump(Math.min(total - 1, currentIndex + 1))}
        disabled={currentIndex >= total - 1}
        className="w-7 h-7 rounded-md flex items-center justify-center bg-surface border border-border hover:bg-surface-hover disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        title="Next frame"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </button>
    </div>
  );
}

/** Decode a sensor_msgs/CompressedImage. */
async function decodeCompressed(msg: Record<string, unknown>): Promise<ImageBitmap> {
  const data = msg.data as Uint8Array;
  const format = (msg.format as string) || 'jpeg';
  const mimeFormat = format.toLowerCase().includes('png') ? 'png' : 'jpeg';
  // Copy into a fresh ArrayBuffer so TS doesn't flag SharedArrayBuffer compatibility.
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const blob = new Blob([copy.buffer], { type: `image/${mimeFormat}` });
  return await createImageBitmap(blob);
}

/** Decode a sensor_msgs/Image (raw pixels in a supported encoding). */
async function decodeRaw(msg: Record<string, unknown>): Promise<ImageBitmap> {
  const width = msg.width as number;
  const height = msg.height as number;
  const encoding = String(msg.encoding ?? 'rgb8').toLowerCase();
  const data = msg.data as Uint8Array;

  const rgba = new Uint8ClampedArray(width * height * 4);

  switch (encoding) {
    case 'rgb8':
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = data[i * 3];
        rgba[i * 4 + 1] = data[i * 3 + 1];
        rgba[i * 4 + 2] = data[i * 3 + 2];
        rgba[i * 4 + 3] = 255;
      }
      break;
    case 'bgr8':
      for (let i = 0; i < width * height; i++) {
        rgba[i * 4] = data[i * 3 + 2];
        rgba[i * 4 + 1] = data[i * 3 + 1];
        rgba[i * 4 + 2] = data[i * 3];
        rgba[i * 4 + 3] = 255;
      }
      break;
    case 'rgba8':
      rgba.set(data);
      break;
    case 'mono8':
      for (let i = 0; i < width * height; i++) {
        const v = data[i];
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
      }
      break;
    case 'mono16': {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      let max = 1;
      for (let i = 0; i < width * height; i++) {
        const v = view.getUint16(i * 2, true);
        if (v > max) max = v;
      }
      for (let i = 0; i < width * height; i++) {
        const v = Math.round((view.getUint16(i * 2, true) / max) * 255);
        rgba[i * 4] = v;
        rgba[i * 4 + 1] = v;
        rgba[i * 4 + 2] = v;
        rgba[i * 4 + 3] = 255;
      }
      break;
    }
    default:
      throw new Error(`Unsupported image encoding: "${encoding}".`);
  }

  const imageData = new ImageData(rgba, width, height);
  return await createImageBitmap(imageData);
}

function PanelLoadingState({ message }: { message: string }) {
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

function PanelErrorState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="text-accent-rose text-sm font-medium">Failed to load messages</div>
      <div className="text-text-secondary text-xs max-w-md">{message}</div>
    </div>
  );
}

function PanelEmptyState({ message }: { message: string }) {
  return (
    <div className="flex-1 flex items-center justify-center text-text-muted text-sm p-8">
      {message}
    </div>
  );
}
