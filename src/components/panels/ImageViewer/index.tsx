import { useEffect, useRef, useState } from 'react';
import { useMessageAtTime } from '../../../hooks/useMessageAtTime';
import { useBagStore, resolveBagEntry } from '../../../store/bagStore';
import { useBagLocalPlayhead } from '../../../hooks/useBagLocalPlayhead';
import { isCompressedImageType } from '../../../utils/messages';
import { nsToSeconds } from '../../../utils/time';
import { PanelShell } from '../PanelShell';
import { getTopicColor } from '../../../utils/color';
import { useCameraInfo, type CameraIntrinsics } from '../../../hooks/useCameraInfo';
import {
  DEFAULT_IMAGE_SETTINGS,
  useImagePanelStore,
} from '../../../store/panelUiStores';
import {
  isPlumbBobModel,
  buildRemapMap,
  applyRemap,
} from '../../../utils/imageRectify';
import { registerCapture } from '../../../utils/captureRegistry';

interface ImageViewerProps {
  panelId: string;
  topicName: string;
  type: string;
  bagId?: string;
}

/**
 * ImageViewer - Renders the current frame for a sensor_msgs/Image or
 * sensor_msgs/CompressedImage topic at the global playhead time.
 *
 * Uses lazy single-message reads (useMessageAtTime) instead of eagerly
 * loading every frame. Image streams in compressed bags are gigabytes of
 * raw pixel data, so preloading them would hang the UI for many minutes.
 *
 * v1.3.2: optional CameraInfo overlay - principal-point reticle, focal-
 * length badge, and a "calibration likely unfilled" chip when every
 * coefficient in D[0..4] is zero. Pairing is automatic by topic-name
 * convention (`/camera/image_raw` -> `/camera/camera_info`) with a manual
 * dropdown when convention misses.
 */
export function ImageViewer({ panelId, topicName, type, bagId }: ImageViewerProps) {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const bag = entry?.summary ?? null;
  const playheadNs = useBagLocalPlayhead(bagId);
  const compressed = isCompressedImageType(type);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => registerCapture(panelId, () => canvasRef.current), [panelId]);

  const { message, loading, error } = useMessageAtTime(topicName, playheadNs, bagId);

  const settings =
    useImagePanelStore((s) => s.byId[panelId]) ?? DEFAULT_IMAGE_SETTINGS;
  const updateSettings = useImagePanelStore((s) => s.update);

  const camera = useCameraInfo(
    topicName,
    bagId,
    playheadNs,
    settings.cameraInfoManualPair || null,
  );

  const [renderError, setRenderError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ width: number; height: number; encoding: string } | null>(
    null,
  );

  // Keep the latest CameraInfo in a ref so the decode effect can read it
  // inside the async IIFE without making camera.info a dep (which would
  // re-trigger the expensive decode on every CameraInfo tick).
  const cameraInfoRef = useRef<CameraIntrinsics | null>(null);
  cameraInfoRef.current = camera.info;

  // Draw the current frame onto the canvas.
  useEffect(() => {
    // Reset the error banner when a new message arrives. This was the
    // pre-v1.3.2 behaviour; the lint rule sees `setRenderError` and a
    // useEffect together and complains, but the reset has no cascade
    // because the same effect immediately decodes the new frame.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRenderError(null);
    if (!message?.value || !canvasRef.current) return;

    const rectifyWanted = settings.rectify;

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

        // Plumb-bob undistortion: read the latest CameraInfo from the ref
        // so this block runs on the same bitmap, not a later decode.
        const ci = cameraInfoRef.current;
        if (
          rectifyWanted &&
          ci &&
          ci.width === bitmap.width &&
          ci.height === bitmap.height &&
          isPlumbBobModel(ci.distortionModel)
        ) {
          const raw = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
          const map = buildRemapMap(ci);
          const rectified = applyRemap(raw.data, map);
          ctx.putImageData(new ImageData(rectified, bitmap.width, bitmap.height), 0, 0);
        }

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
    // settings.rectify is intentionally included so toggling rectify
    // re-decodes the current frame immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message, compressed, settings.rectify]);

  const accent = getTopicColor(topicName, type);
  const showInitialLoading = loading && !message;
  const startNs = bag?.startTime ?? 0n;

  const overlayOn = settings.cameraInfoOverlay && !!camera.info;
  const canRectify =
    camera.candidates.length > 0 &&
    !camera.hasNoInfoTopic &&
    (camera.info ? isPlumbBobModel(camera.info.distortionModel) : true);
  const headerExtras = (
    <>
      <RectifyHeaderToggle
        hasCandidates={camera.candidates.length > 0}
        enabled={settings.rectify}
        onToggle={(next) => updateSettings(panelId, { rectify: next })}
        canRectify={canRectify}
        hasInfo={!!camera.info}
      />
      <CameraInfoHeaderToggle
        hasCandidates={camera.candidates.length > 0}
        enabled={settings.cameraInfoOverlay}
        onToggle={(next) => updateSettings(panelId, { cameraInfoOverlay: next })}
        hasInfo={!!camera.info}
      />
    </>
  );

  return (
    <PanelShell
      panelId={panelId}
      kind="image"
      topicName={topicName}
      type={type}
      accentColor={accent}
      bagId={bagId}
      headerExtras={headerExtras}
    >
      {showInitialLoading && <PanelLoadingState message="Loading frame..." />}
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
              <CanvasWithOverlay
                canvasRef={canvasRef}
                showOverlay={overlayOn}
                camera={camera.info}
              />
            )}
            {loading && (
              <div
                className="absolute top-2 right-2 w-4 h-4 text-accent-blue animate-spin-slow"
                title="Loading newer frame..."
              >
                <svg fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            )}
            {overlayOn && camera.info && (
              <CameraInfoBadge
                camera={camera.info}
                calibrationLikelyUnfilled={camera.calibrationLikelyUnfilled}
              />
            )}
          </div>

          {settings.cameraInfoOverlay && camera.candidates.length > 0 && (
            <CameraInfoPairBar
              pairedTopic={camera.pairedTopic}
              isAutoPair={camera.isAutoPair}
              candidates={camera.candidates}
              manualOverride={settings.cameraInfoManualPair}
              onChange={(next) =>
                updateSettings(panelId, { cameraInfoManualPair: next })
              }
            />
          )}

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

interface CanvasWithOverlayProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  showOverlay: boolean;
  camera: CameraIntrinsics | null;
}

function CanvasWithOverlay({ canvasRef, showOverlay, camera }: CanvasWithOverlayProps) {
  // The reticle sits over the canvas in absolute coords. We compute its CSS
  // position from (cx, cy) and the rendered canvas size, kept in sync via
  // ResizeObserver so a resize from a panel drag doesn't drift it.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [reticle, setReticle] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!showOverlay || !camera || !wrapperRef.current || !canvasRef.current) {
      setReticle(null);
      return;
    }
    const canvas = canvasRef.current;
    const compute = () => {
      const rect = canvas.getBoundingClientRect();
      const wrapperRect = wrapperRef.current!.getBoundingClientRect();
      if (canvas.width === 0 || canvas.height === 0) return;
      const scaleX = rect.width / canvas.width;
      const scaleY = rect.height / canvas.height;
      const leftPx = rect.left - wrapperRect.left + camera.cx * scaleX;
      const topPx = rect.top - wrapperRect.top + camera.cy * scaleY;
      setReticle({ left: leftPx, top: topPx });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(canvas);
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, [showOverlay, camera, canvasRef]);

  return (
    <div ref={wrapperRef} className="relative max-w-full max-h-full flex items-center justify-center">
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full object-contain rounded-md border border-border"
      />
      {showOverlay && reticle && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: `${reticle.left}px`,
            top: `${reticle.top}px`,
            transform: 'translate(-50%, -50%)',
          }}
          aria-hidden
        >
          <svg width="22" height="22" viewBox="0 0 22 22">
            <circle cx="11" cy="11" r="8" fill="none" stroke="#06b6d4" strokeWidth="1" opacity="0.85" />
            <line x1="11" y1="0" x2="11" y2="22" stroke="#06b6d4" strokeWidth="0.7" opacity="0.85" />
            <line x1="0" y1="11" x2="22" y2="11" stroke="#06b6d4" strokeWidth="0.7" opacity="0.85" />
            <circle cx="11" cy="11" r="1.5" fill="#06b6d4" />
          </svg>
        </div>
      )}
    </div>
  );
}

interface CameraInfoBadgeProps {
  camera: CameraIntrinsics;
  calibrationLikelyUnfilled: boolean;
}

function CameraInfoBadge({ camera, calibrationLikelyUnfilled }: CameraInfoBadgeProps) {
  return (
    <div className="absolute bottom-2 left-2 flex flex-col gap-1 items-start">
      <div className="bg-bg-primary/85 backdrop-blur border border-border rounded-md px-2 py-1 text-[10px] mono text-text-secondary">
        f = ({camera.fx.toFixed(1)}, {camera.fy.toFixed(1)}) px
        <span className="text-text-tertiary ml-2">
          {camera.width}×{camera.height}
        </span>
      </div>
      {calibrationLikelyUnfilled && (
        <div
          className="bg-amber-500/15 border border-amber-500/40 text-amber-300 rounded-md px-2 py-1 text-[10px] mono"
          title="Every coefficient in D[0..4] is zero. This is almost always a calibration template that was never run."
        >
          calibration likely unfilled
        </div>
      )}
    </div>
  );
}

interface CameraInfoPairBarProps {
  pairedTopic: string | null;
  isAutoPair: boolean;
  candidates: string[];
  manualOverride: string;
  onChange: (next: string) => void;
}

function CameraInfoPairBar({
  pairedTopic,
  isAutoPair,
  candidates,
  manualOverride,
  onChange,
}: CameraInfoPairBarProps) {
  // The select drives the manual override; "" maps to "use auto-pair".
  const selectValue = manualOverride || '';
  return (
    <div className="px-4 py-1 border-t border-border flex items-center gap-2 text-[10px] mono">
      <span className="text-text-tertiary">camera_info</span>
      <select
        value={selectValue}
        onChange={(e) => onChange(e.target.value)}
        className="px-1.5 py-0.5 bg-surface border border-border rounded text-text-secondary focus:outline-none focus:border-accent-blue/50"
        title={
          isAutoPair
            ? `Auto-paired with ${pairedTopic ?? 'none'}`
            : selectValue
              ? 'Manual pair (overrides auto-detection)'
              : 'No pair selected'
        }
      >
        <option value="">auto: {pairedTopic ?? 'none'}</option>
        {candidates.map((cand) => (
          <option key={cand} value={cand}>
            {cand}
          </option>
        ))}
      </select>
      {!isAutoPair && selectValue && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-text-tertiary hover:text-accent-blue underline decoration-dotted"
          title="Revert to the auto-detected pair"
        >
          clear
        </button>
      )}
    </div>
  );
}

interface CameraInfoHeaderToggleProps {
  hasCandidates: boolean;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  hasInfo: boolean;
}

function CameraInfoHeaderToggle({
  hasCandidates,
  enabled,
  onToggle,
  hasInfo,
}: CameraInfoHeaderToggleProps) {
  if (!hasCandidates) return null;
  return (
    <button
      type="button"
      onClick={() => onToggle(!enabled)}
      className={`text-[10px] mono px-1.5 py-0.5 rounded border transition-colors ${
        enabled
          ? 'border-accent-cyan/60 text-accent-cyan bg-accent-cyan/10'
          : 'border-border text-text-tertiary hover:text-text-secondary hover:border-border-strong'
      }`}
      title={
        enabled
          ? hasInfo
            ? 'CameraInfo overlay on - click to hide'
            : 'CameraInfo overlay on but no message at this timestamp'
          : 'Show the CameraInfo overlay (principal point + focal length)'
      }
    >
      CameraInfo
    </button>
  );
}

interface RectifyHeaderToggleProps {
  hasCandidates: boolean;
  enabled: boolean;
  onToggle: (next: boolean) => void;
  /** False when the paired CameraInfo uses an unsupported model (fisheye etc). */
  canRectify: boolean;
  hasInfo: boolean;
}

function RectifyHeaderToggle({
  hasCandidates,
  enabled,
  onToggle,
  canRectify,
  hasInfo,
}: RectifyHeaderToggleProps) {
  if (!hasCandidates) return null;
  const unsupported = hasInfo && !canRectify;
  return (
    <button
      type="button"
      onClick={() => { if (!unsupported) onToggle(!enabled); }}
      disabled={unsupported}
      className={`text-[10px] mono px-1.5 py-0.5 rounded border transition-colors ${
        unsupported
          ? 'border-border text-text-tertiary opacity-50 cursor-not-allowed'
          : enabled
            ? 'border-accent-violet/60 text-accent-violet bg-accent-violet/10'
            : 'border-border text-text-tertiary hover:text-text-secondary hover:border-border-strong'
      }`}
      title={
        unsupported
          ? 'Unsupported distortion model - only plumb_bob is supported'
          : enabled
            ? hasInfo
              ? 'Undistortion on - click to disable'
              : 'Undistortion on but no CameraInfo at this timestamp'
            : 'Undistort frames using the paired CameraInfo D coefficients (plumb_bob)'
      }
    >
      undistort
    </button>
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
