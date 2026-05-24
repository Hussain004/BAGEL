import { useEffect, useRef, useState } from 'react';
import { useMessageAtTime } from '../../../hooks/useMessageAtTime';
import { useBagStore } from '../../../store/bagStore';
import { usePlayheadStore } from '../../../store/playheadStore';
import { isCompressedImageType } from '../../../utils/messages';
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
 *
 * Uses lazy single-message reads (useMessageAtTime) instead of eagerly
 * loading every frame. Image streams in compressed bags are gigabytes of
 * raw pixel data — preloading them would hang the UI for many minutes.
 */
export function ImageViewer({ panelId, topicName, type }: ImageViewerProps) {
  const bag = useBagStore((s) => s.bag);
  const playheadNs = usePlayheadStore((s) => s.timeNs);
  const compressed = isCompressedImageType(type);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { message, loading, error } = useMessageAtTime(topicName, playheadNs);

  const [renderError, setRenderError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ width: number; height: number; encoding: string } | null>(
    null,
  );

  // Draw the current frame onto the canvas.
  useEffect(() => {
    setRenderError(null);
    if (!message?.value || !canvasRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const bitmap = compressed
          ? await decodeCompressed(message.value!)
          : await decodeRaw(message.value!);
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
          encoding: (message.value!.encoding as string) ?? (compressed ? 'compressed' : 'raw'),
        });
      } catch (err) {
        if (cancelled) return;
        setRenderError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [message, compressed]);

  const accent = getTopicColor(topicName, type);
  const showInitialLoading = loading && !message;
  const startNs = bag?.startTime ?? 0n;

  return (
    <PanelShell panelId={panelId} kind="image" topicName={topicName} type={type} accentColor={accent}>
      {showInitialLoading && <PanelLoadingState message="Loading frame…" />}
      {error && !message && <PanelErrorState message={error} />}
      {!loading && !error && !message && (
        <PanelEmptyState message="No image messages on this topic." />
      )}
      {message && (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 flex items-center justify-center bg-bg-primary/60 overflow-hidden min-h-[200px] p-3 relative">
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
            {loading && (
              <div
                className="absolute top-2 right-2 w-4 h-4 text-accent-blue animate-spin-slow"
                title="Loading newer frame…"
              >
                <svg fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            )}
          </div>

          <div className="px-4 py-1.5 border-t border-border flex items-center justify-between text-text-muted text-xs mono">
            <span>
              t = {nsToSeconds(message.timestamp - startNs).toFixed(3)}s
            </span>
            {meta && (
              <span>
                <span className="text-text-primary">{meta.width}×{meta.height}</span>
                <span className="text-text-muted ml-2">{meta.encoding}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </PanelShell>
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
      <div className="text-accent-rose text-sm font-medium">Failed to load frame</div>
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
