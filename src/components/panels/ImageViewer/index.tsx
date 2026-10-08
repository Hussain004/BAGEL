import { useEffect, useMemo, useRef, useState } from 'react';
import { CloudProjection } from './CloudProjection';
import { useCanvasRect } from './useCanvasRect';
import { useMessageAtTime } from '../../../hooks/useMessageAtTime';
import { useBagStore, resolveBagEntry } from '../../../store/bagStore';
import { useBagLocalPlayhead } from '../../../hooks/useBagLocalPlayhead';
import { isCloudType, isCompressedImageType, isVideoType } from '../../../utils/messages';
import { readVideoChunkRange, readVideoChunksAtTime } from '../../../parsers';
import { VideoFrameDecoder } from '../../../parsers/video';
import { nsToSeconds } from '../../../utils/time';
import { PanelShell } from '../PanelShell';
import { PanelLoadingState, PanelErrorState, PanelEmptyState } from '../shared/PanelStates';
import { openInActions } from '../../../utils/emptyActions';
import { OverlayCard } from '../shared/OverlayCard';
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
  undistortPixel,
} from '../../../utils/imageRectify';
import { registerCapture } from '../../../utils/captureRegistry';
import { decodeCompressedDepthImage } from '../../../utils/compressedDepth';
import {
  boxCorners,
  classColor,
  detectionFreshness,
  isDetection2DArrayType,
  parseDetection2DArray,
  stampNs,
  type Detection2D,
} from '../../../utils/detections';
import {
  DEPTH_COLORMAPS,
  colorizeDepth,
  decodeRawDepth,
  depthColorbarGradient,
  depthUnit,
  type ColorizeOptions,
  type DepthColormap,
} from '../../../utils/depthColor';

interface ImageViewerProps {
  panelId: string;
  topicName: string;
  type: string;
  bagId?: string;
}

interface VideoFrameState {
  bitmap: ImageBitmap | null;
  loading: boolean;
  error: string | null;
}

/** What a depth decode used, so the footer can label the color bar. */
interface DepthInfo {
  min: number;
  max: number;
  unit: 'mm' | 'm';
}

interface DecodedFrame {
  bitmap: ImageBitmap;
  depth?: DepthInfo;
}

/** How far a detection's stamp may be from the image's before its boxes are hidden. */
const DETECTION_TOLERANCE_NS = 200_000_000n;

const MAX_SEQUENTIAL_VIDEO_GAP_NS = 2_000_000_000n;

/**
 * Fetch + WebCodecs-decode video frames for the current playhead. Small
 * forward moves reuse a stateful decoder; seeks fall back to a keyframe read.
 *
 * `enabled` must be false for non-video topics. The hook is always called
 * for React rule compliance but returns empty state immediately when disabled.
 */
function useVideoFrame(
  topicName: string,
  timeNs: bigint,
  bagId: string | undefined,
  enabled: boolean,
): VideoFrameState {
  const entry = useBagStore((s) => resolveBagEntry(s, bagId));
  const [state, setState] = useState<VideoFrameState>({ bitmap: null, loading: false, error: null });
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const decoderRef = useRef<VideoFrameDecoder | null>(null);
  const desiredTimeRef = useRef(timeNs);
  const runningRef = useRef(false);
  const lastDecodedNsRef = useRef<bigint | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    generationRef.current++;
    runningRef.current = false;
    desiredTimeRef.current = timeNs;
    lastDecodedNsRef.current = null;
    decoderRef.current?.close();
    decoderRef.current = null;
    bitmapRef.current = null;
    setState({ bitmap: null, loading: false, error: null });

    return () => {
      // generationRef is a shared invalidation token, not a per-effect
      // snapshot - every in-flight async decode loop checks the CURRENT
      // value, so incrementing it here (rather than a value captured at
      // effect-setup time) is exactly the point: it invalidates any
      // outstanding work regardless of which generation started it.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generationRef.current++;
      runningRef.current = false;
      decoderRef.current?.close();
      decoderRef.current = null;
      bitmapRef.current = null;
    };
    // timeNs deliberately excluded: this effect only resets/tears down the
    // decoder on topic/bag/enabled change. Re-running it on every playhead
    // tick would reset the decoder every frame instead of decoding
    // sequentially forward; the async loop below reads the latest timeNs
    // via desiredTimeRef instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicName, bagId, enabled]);

  useEffect(() => {
    if (!enabled || !entry || entry.kind === 'live' || !entry.source) return;
    const { id: workerBagId, summary: bag, source } = entry;
    const generation = generationRef.current;
    desiredTimeRef.current = timeNs;
    if (runningRef.current) return;

    runningRef.current = true;
    setState((prev) => ({ ...prev, loading: !prev.bitmap, error: null }));

    void (async () => {
      try {
        for (;;) {
          if (generation !== generationRef.current) return;
          const targetNs = desiredTimeRef.current;
          const lastDecodedNs = lastDecodedNsRef.current;
          const canDecodeForward =
            lastDecodedNs !== null &&
            targetNs >= lastDecodedNs &&
            targetNs - lastDecodedNs <= MAX_SEQUENTIAL_VIDEO_GAP_NS;

          const result = canDecodeForward
            ? await readVideoChunkRange(
              workerBagId,
              source,
              bag.format,
              topicName,
              lastDecodedNs + 1n,
              targetNs,
            )
            : await readVideoChunksAtTime(
              workerBagId,
              source,
              bag.format,
              topicName,
              targetNs,
            );

          if (generation !== generationRef.current) return;
          if (!result || result.chunks.length === 0) {
            if (!canDecodeForward) {
              decoderRef.current?.reset();
              lastDecodedNsRef.current = null;
            }
            setState((prev) => ({ ...prev, loading: !prev.bitmap, error: null }));
          } else {
            if (!decoderRef.current) decoderRef.current = new VideoFrameDecoder();
            const bitmap = await decoderRef.current.decode(result.chunks, result.format);
            if (generation !== generationRef.current) {
              bitmap?.close();
              return;
            }
            if (bitmap) {
              bitmapRef.current = bitmap;
              setState({ bitmap, loading: false, error: null });
            } else {
              setState((prev) => ({ ...prev, loading: false, error: null }));
            }
            lastDecodedNsRef.current = result.chunks[result.chunks.length - 1]!.timestamp;
          }

          if (desiredTimeRef.current === targetNs) break;
        }
      } catch (err) {
        if (generation === generationRef.current) {
          decoderRef.current?.reset();
          lastDecodedNsRef.current = null;
          setState((prev) => ({
            bitmap: prev.bitmap,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      } finally {
        if (generation === generationRef.current) {
          runningRef.current = false;
        }
      }
    })();
  }, [entry, topicName, timeNs, enabled]);

  if (!enabled) return { bitmap: null, loading: false, error: null };
  return state;
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
  const isVideo = isVideoType(type, topicName);
  const compressed = !isVideo && isCompressedImageType(type);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawnVideoBitmapRef = useRef<ImageBitmap | null>(null);
  useEffect(() => registerCapture(panelId, () => canvasRef.current), [panelId]);

  // Standard single-message path (JPEG, raw pixels, Foxglove images).
  const { message, loading: msgLoading, error: msgError } = useMessageAtTime(topicName, playheadNs, bagId);
  // Video path (H264/H265 via WebCodecs). No-op when isVideo is false.
  const { bitmap: videoBitmap, loading: videoLoading, error: videoError } = useVideoFrame(
    topicName, playheadNs, bagId, isVideo,
  );

  const loading = isVideo ? videoLoading : msgLoading;
  const error = isVideo ? videoError : msgError;

  const settings =
    useImagePanelStore((s) => s.byId[panelId]) ?? DEFAULT_IMAGE_SETTINGS;
  const updateSettings = useImagePanelStore((s) => s.update);

  const camera = useCameraInfo(
    topicName,
    bagId,
    playheadNs,
    settings.cameraInfoManualPair || null,
  );

  // Detection boxes. The query time is the displayed image's own log time (not
  // the playhead), and the boxes are only drawn if their header stamp matches
  // the image's, so a slow detector never paints boxes on a different frame.
  const detectionCandidates = useMemo(
    () =>
      (bag?.topics ?? [])
        .filter((t) => isDetection2DArrayType(t.type))
        .map((t) => t.name)
        .sort(),
    [bag],
  );
  const cloudCandidates = useMemo(
    () =>
      (bag?.topics ?? [])
        .filter((t) => isCloudType(t.type))
        .map((t) => t.name)
        .sort(),
    [bag],
  );
  const cloudTopic = cloudCandidates.includes(settings.cloudTopic) ? settings.cloudTopic : '';
  const detectionTopic = detectionCandidates.includes(settings.detectionTopic) ? settings.detectionTopic : '';
  const detectionMsg = useMessageAtTime(detectionTopic, message?.timestamp ?? playheadNs, bagId).message;
  const detections = useMemo(() => parseDetection2DArray(detectionMsg?.value), [detectionMsg]);
  const imageStamp = useMemo(
    () => stampNs(message?.value) ?? message?.timestamp ?? null,
    [message],
  );
  const detectionStamp = detections.stampNs ?? detectionMsg?.timestamp ?? null;
  const freshness = detectionFreshness(detectionStamp, imageStamp, DETECTION_TOLERANCE_NS);

  const [renderError, setRenderError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ width: number; height: number; encoding: string } | null>(
    null,
  );
  const [depthInfo, setDepthInfo] = useState<DepthInfo | null>(null);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  // Keep the latest CameraInfo in a ref so the decode effect can read it
  // inside the async IIFE without making camera.info a dep (which would
  // re-trigger the expensive decode on every CameraInfo tick).
  const cameraInfoRef = useRef<CameraIntrinsics | null>(null);
  useEffect(() => {
    cameraInfoRef.current = camera.info;
  });

  const hasContent = isVideo ? !!videoBitmap : !!message;

  // Reset zoom/pan when the topic or bag changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView({ zoom: 1, panX: 0, panY: 0 });
    return () => {
      const previous = drawnVideoBitmapRef.current;
      drawnVideoBitmapRef.current = null;
      previous?.close();
    };
  }, [topicName, bagId]);

  // Non-passive wheel listener so we can call preventDefault() to block page scroll.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left - rect.width / 2;
      const mouseY = e.clientY - rect.top - rect.height / 2;
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setView((prev) => {
        const newZoom = Math.max(0.1, Math.min(10, prev.zoom * factor));
        const ratio = newZoom / prev.zoom;
        return {
          zoom: newZoom,
          panX: prev.panX * ratio + mouseX * (1 - ratio),
          panY: prev.panY * ratio + mouseY * (1 - ratio),
        };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasContent]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: view.panX, panY: view.panY };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setView((v) => ({ ...v, panX: drag.panX + dx, panY: drag.panY + dy }));
  };
  const onPointerUp = () => { dragRef.current = null; setIsDragging(false); };
  const onDoubleClick = () => setView({ zoom: 1, panX: 0, panY: 0 });

  // Draw the current frame onto the canvas.
  // Handles both the standard message path (JPEG/raw) and the video path
  // (H264/H265 bitmap pre-decoded by useVideoFrame).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRenderError(null);

    const drawBitmap = (bitmap: ImageBitmap, encoding: string, depth: DepthInfo | null = null) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(bitmap, 0, 0);

      const ci = cameraInfoRef.current;
      if (
        settings.rectify &&
        ci &&
        ci.width === bitmap.width &&
        ci.height === bitmap.height &&
        isPlumbBobModel(ci.distortionModel)
      ) {
        const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
        const map = buildRemapMap(ci);
        const rectified = applyRemap(imageData.data, map);
        ctx.putImageData(new ImageData(rectified, bitmap.width, bitmap.height), 0, 0);
      }

      setMeta({ width: bitmap.width, height: bitmap.height, encoding });
      setDepthInfo(depth);
    };

    // Video path: bitmap is already decoded by useVideoFrame.
    if (isVideo) {
      if (!videoBitmap || !canvasRef.current) return;
      try {
        drawBitmap(videoBitmap, 'h264/h265');
        const previous = drawnVideoBitmapRef.current;
        drawnVideoBitmapRef.current = videoBitmap;
        if (previous && previous !== videoBitmap) previous.close();
      } catch (err) {
        setRenderError(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    // Standard path: decode the message on this tick.
    if (!message?.value || !canvasRef.current) return;

    let cancelled = false;
    (async () => {
      try {
        const depthOpts: ColorizeOptions = {
          colormap: settings.depthColormap,
          min: settings.depthMin,
          max: settings.depthMax,
        };
        const { bitmap, depth } = compressed
          ? await decodeCompressed(message.value!, depthOpts)
          : await decodeRaw(message.value!, depthOpts);
        if (cancelled) {
          bitmap?.close?.();
          return;
        }
        drawBitmap(
          bitmap,
          (message.value!.encoding as string) ??
            (message.value!.format as string) ??
            (compressed ? 'compressed' : 'raw'),
          depth ?? null,
        );
        bitmap.close?.();
      } catch (err) {
        if (cancelled) return;
        setRenderError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => { cancelled = true; };
    // settings.rectify and the depth settings are intentionally included so
    // toggling them re-decodes the current frame immediately.
  }, [
    message,
    videoBitmap,
    isVideo,
    compressed,
    settings.rectify,
    settings.depthColormap,
    settings.depthMin,
    settings.depthMax,
  ]);

  const accent = getTopicColor(topicName, type);
  const showInitialLoading = loading && !hasContent;
  const startNs = bag?.startTime ?? 0n;

  const overlayOn = settings.cameraInfoOverlay && !!camera.info;
  const canRectify =
    camera.candidates.length > 0 &&
    !camera.hasNoInfoTopic &&
    (camera.info ? isPlumbBobModel(camera.info.distortionModel) : true);
  // Boxes are in raw image pixels; when the frame is being undistorted they
  // must be carried through the same correction or they drift off the object.
  const rectifyCamera =
    settings.rectify &&
    camera.info &&
    meta &&
    camera.info.width === meta.width &&
    camera.info.height === meta.height &&
    isPlumbBobModel(camera.info.distortionModel)
      ? camera.info
      : null;
  const headerExtras = (
    <>
      {detectionCandidates.length > 0 && (
        <select
          value={detectionTopic}
          onChange={(e) => updateSettings(panelId, { detectionTopic: e.target.value })}
          aria-label="Detection boxes topic"
          title="Draw 2D detection boxes (vision_msgs/Detection2DArray) on this image"
          className="text-[10px] mono px-1 py-0.5 rounded border border-border bg-bg-secondary text-text-secondary max-w-[140px]"
        >
          <option value="">boxes: off</option>
          {detectionCandidates.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}
      {cloudCandidates.length > 0 && camera.info && (
        <select
          value={cloudTopic}
          onChange={(e) => updateSettings(panelId, { cloudTopic: e.target.value })}
          aria-label="Project point cloud topic"
          title="Project a LiDAR point cloud onto this image to check the camera-LiDAR calibration"
          className="text-[10px] mono px-1 py-0.5 rounded border border-border bg-bg-secondary text-text-secondary max-w-[140px]"
        >
          <option value="">lidar: off</option>
          {cloudCandidates.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      )}
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
      {showInitialLoading && <PanelLoadingState message="Loading frame…" />}
      {error && !hasContent && (
        <PanelErrorState
          title="Failed to load frame"
          message={error}
          schemaTarget={{ typeName: type, topicName, panelKind: 'image', bagId }}
        />
      )}
      {!loading && !error && !hasContent && (
        <PanelEmptyState
          message="No image messages on this topic."
          hint="Nothing could be shown for this topic. The health dashboard lists how many messages each topic has and where it stopped publishing."
          actions={openInActions([{ kind: 'health', label: 'Open health dashboard' }], { topicName, type, bagId })}
        />
      )}
      {hasContent && (
        <div className="flex-1 flex flex-col min-h-0">
          <div
            ref={containerRef}
            className="flex-1 flex items-center justify-center bg-bg-primary/60 overflow-hidden min-h-[200px] relative select-none"
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
          >
            {renderError ? (
              <div className="text-center max-w-md">
                <div className="text-accent-rose text-sm font-medium mb-1">
                  Could not decode frame
                </div>
                <div className="text-text-muted text-xs">{renderError}</div>
              </div>
            ) : (
              <div
                style={{
                  transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})`,
                  transformOrigin: 'center',
                  willChange: 'transform',
                }}
              >
                <CanvasWithOverlay
                  canvasRef={canvasRef}
                  showOverlay={overlayOn}
                  camera={camera.info}
                  boxes={detectionTopic && freshness.fresh ? detections.detections : []}
                  imageSize={meta ? { width: meta.width, height: meta.height } : null}
                  rectifyCamera={rectifyCamera}
                  projection={
                    cloudTopic && camera.info && meta
                      ? { topic: cloudTopic, bagId, timeNs: message?.timestamp ?? playheadNs, camera: camera.info }
                      : null
                  }
                />
              </div>
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

          {depthInfo && (
            <DepthControls
              info={depthInfo}
              colormap={settings.depthColormap}
              minOverride={settings.depthMin}
              maxOverride={settings.depthMax}
              onChange={(partial) => updateSettings(panelId, partial)}
            />
          )}

          <div className="px-4 py-1.5 border-t border-border flex items-center justify-between text-text-muted text-xs mono">
            <span>
              t = {nsToSeconds((isVideo ? playheadNs : (message?.timestamp ?? playheadNs)) - startNs).toFixed(3)}s
            </span>
            <span className="flex items-center gap-3">
              {view.zoom !== 1 && (
                <span>{Math.round(view.zoom * 100)}%</span>
              )}
              {detectionTopic && (
                <span
                  className={freshness.fresh ? 'text-text-secondary' : 'text-accent-amber'}
                  title={
                    freshness.deltaNs === null
                      ? 'Detection and image carry no comparable header stamp'
                      : `Detection stamp minus image stamp: ${Number(freshness.deltaNs) / 1e6} ms`
                  }
                >
                  {freshness.fresh
                    ? `${detections.detections.length} boxes`
                    : `boxes hidden: ${Math.abs(Number(freshness.deltaNs ?? 0n) / 1e6).toFixed(0)} ms off`}
                </span>
              )}
              {meta && (
                <span>
                  <span className="text-text-primary">{meta.width}×{meta.height}</span>
                  <span className="text-text-muted ml-2">{meta.encoding}</span>
                </span>
              )}
            </span>
          </div>
        </div>
      )}
    </PanelShell>
  );
}

interface DepthControlsProps {
  info: DepthInfo;
  colormap: DepthColormap;
  minOverride: number | null;
  maxOverride: number | null;
  onChange: (partial: {
    depthColormap?: DepthColormap;
    depthMin?: number | null;
    depthMax?: number | null;
  }) => void;
}

/** Parse a range input; blank or non-numeric means "auto" (null). */
function parseRangeInput(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function DepthControls({ info, colormap, minOverride, maxOverride, onChange }: DepthControlsProps) {
  const fmt = (v: number) => (info.unit === 'm' ? v.toFixed(2) : String(Math.round(v)));
  const inputCls =
    'w-16 bg-bg-secondary border border-border rounded px-1 py-0.5 text-text-primary mono text-[11px]';
  return (
    <div className="px-4 py-1.5 border-t border-border flex flex-wrap items-center gap-x-3 gap-y-1 text-text-muted text-xs mono">
      <label className="flex items-center gap-1">
        <span>colormap</span>
        <select
          value={colormap}
          onChange={(e) => onChange({ depthColormap: e.target.value as DepthColormap })}
          className="bg-bg-secondary border border-border rounded px-1 py-0.5 text-text-primary text-[11px]"
        >
          {DEPTH_COLORMAPS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1">
        <span>min</span>
        <input
          type="number"
          className={inputCls}
          value={minOverride ?? ''}
          placeholder={fmt(info.min)}
          onChange={(e) => onChange({ depthMin: parseRangeInput(e.target.value) })}
          aria-label={`Depth range minimum (${info.unit}), blank for auto`}
        />
      </label>
      <label className="flex items-center gap-1">
        <span>max</span>
        <input
          type="number"
          className={inputCls}
          value={maxOverride ?? ''}
          placeholder={fmt(info.max)}
          onChange={(e) => onChange({ depthMax: parseRangeInput(e.target.value) })}
          aria-label={`Depth range maximum (${info.unit}), blank for auto`}
        />
      </label>
      <span className="flex items-center gap-1.5 flex-1 min-w-[140px]">
        <span>{fmt(info.min)}</span>
        <span
          className="h-2 flex-1 rounded-sm border border-border"
          style={{ background: depthColorbarGradient(colormap) }}
          role="img"
          aria-label={`Depth scale from ${fmt(info.min)} to ${fmt(info.max)} ${info.unit}`}
        />
        <span>
          {fmt(info.max)} {info.unit}
        </span>
      </span>
      {(minOverride != null || maxOverride != null) && (
        <button
          type="button"
          onClick={() => onChange({ depthMin: null, depthMax: null })}
          className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-tertiary hover:text-text-secondary hover:border-border-hover transition-colors"
        >
          auto range
        </button>
      )}
    </div>
  );
}

interface CanvasWithOverlayProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  showOverlay: boolean;
  camera: CameraIntrinsics | null;
  boxes: Detection2D[];
  imageSize: { width: number; height: number } | null;
  /** When set, box corners are undistorted with these intrinsics to match a rectified frame. */
  rectifyCamera: CameraIntrinsics | null;
  /** LiDAR projection to draw over the image, or null for none. */
  projection: { topic: string; bagId?: string; timeNs: bigint; camera: CameraIntrinsics } | null;
}

/** Detection boxes as SVG in image-pixel space, laid exactly over the canvas. */
function DetectionBoxes({
  canvasRef,
  boxes,
  imageSize,
  rectifyCamera,
}: Pick<CanvasWithOverlayProps, 'canvasRef' | 'boxes' | 'imageSize' | 'rectifyCamera'>) {
  const rect = useCanvasRect(canvasRef, boxes.length > 0, imageSize);

  if (boxes.length === 0 || !rect || !imageSize) return null;
  const fs = Math.max(11, imageSize.height / 38);
  return (
    <svg
      className="pointer-events-none absolute"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
      preserveAspectRatio="none"
      aria-hidden
      data-testid="detection-boxes"
    >
      {boxes.map((d, i) => {
        const corners = boxCorners(d).map(([x, y]) => {
          const p = rectifyCamera ? undistortPixel(rectifyCamera, x, y) : { x, y };
          return [p.x, p.y] as const;
        });
        const color = classColor(d.classKey);
        const tag = `${d.label}${d.score !== null ? ` ${Math.round(d.score * 100)}%` : ''}`.trim();
        const [lx, ly] = corners[0]!;
        const tagW = tag.length * fs * 0.58 + fs * 0.6;
        return (
          <g key={i}>
            <polygon
              points={corners.map(([x, y]) => `${x},${y}`).join(' ')}
              fill="none"
              stroke={color}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
            {tag && (
              <>
                <rect x={lx} y={ly - fs * 1.3} width={tagW} height={fs * 1.3} fill={color} opacity={0.9} />
                <text x={lx + fs * 0.3} y={ly - fs * 0.35} fontSize={fs} fill="#0b0f19" fontFamily="monospace">
                  {tag}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function CanvasWithOverlay({ canvasRef, showOverlay, camera, boxes, imageSize, rectifyCamera, projection }: CanvasWithOverlayProps) {
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
      <DetectionBoxes canvasRef={canvasRef} boxes={boxes} imageSize={imageSize} rectifyCamera={rectifyCamera} />
      {projection && imageSize && (
        <CloudProjection
          canvasRef={canvasRef}
          topic={projection.topic}
          bagId={projection.bagId}
          timeNs={projection.timeNs}
          camera={projection.camera}
          imageSize={imageSize}
          rectified={!!rectifyCamera}
        />
      )}
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
          <svg className="text-accent-cyan" width="22" height="22" viewBox="0 0 22 22">
            <circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.85" />
            <line x1="11" y1="0" x2="11" y2="22" stroke="currentColor" strokeWidth="0.7" opacity="0.85" />
            <line x1="0" y1="11" x2="22" y2="11" stroke="currentColor" strokeWidth="0.7" opacity="0.85" />
            <circle cx="11" cy="11" r="1.5" fill="currentColor" />
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
      <OverlayCard className="px-2 py-1 text-[10px] mono text-text-secondary">
        f = ({camera.fx.toFixed(1)}, {camera.fy.toFixed(1)}) px
        <span className="text-text-tertiary ml-2">
          {camera.width}×{camera.height}
        </span>
      </OverlayCard>
      {calibrationLikelyUnfilled && (
        <div
          className="bg-accent-amber/15 border border-accent-amber/40 text-accent-amber rounded-md px-2 py-1 text-[10px] mono"
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
          : 'border-border text-text-tertiary hover:text-text-secondary hover:border-border-hover'
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
            : 'border-border text-text-tertiary hover:text-text-secondary hover:border-border-hover'
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
async function decodeCompressed(
  msg: Record<string, unknown>,
  depthOpts: ColorizeOptions,
): Promise<DecodedFrame> {
  const data = msg.data as Uint8Array;
  const format = (msg.format as string) || 'jpeg';

  const depthMatch = /compressedDepth(\s+(\w+))?/.exec(format);
  if (depthMatch) {
    return decodeCompressedDepth(data, format, depthMatch[2] ?? 'png', depthOpts);
  }

  const mimeFormat = format.toLowerCase().includes('png') ? 'png' : 'jpeg';
  // Copy into a fresh ArrayBuffer so TS doesn't flag SharedArrayBuffer compatibility.
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const blob = new Blob([copy.buffer], { type: `image/${mimeFormat}` });
  return { bitmap: await createImageBitmap(blob) };
}

/**
 * Decode `compressed_depth_image_transport` data to a colorized frame. The
 * byte-level parsing and dequantization live in utils/compressedDepth.ts and
 * the colormap in utils/depthColor.ts (both unit-tested); this just joins
 * them.
 */
async function decodeCompressedDepth(
  data: Uint8Array,
  format: string,
  subFormat: string,
  depthOpts: ColorizeOptions,
): Promise<DecodedFrame> {
  if (subFormat.toLowerCase() === 'rvl') {
    throw new Error(
      'This depth stream uses the RVL compressed_depth_image_transport codec, which is not supported yet (PNG-backed compressedDepth is).',
    );
  }

  const imageEncoding = format.split(';')[0] ?? '';
  const { width, height, depth } = decodeCompressedDepthImage(data, imageEncoding);
  return colorizedFrame(depth, width, height, imageEncoding, depthOpts);
}

async function colorizedFrame(
  depth: Float32Array,
  width: number,
  height: number,
  encoding: string,
  depthOpts: ColorizeOptions,
): Promise<DecodedFrame> {
  const { rgba, min, max } = colorizeDepth(depth, depthOpts);
  const bitmap = await createImageBitmap(new ImageData(rgba, width, height));
  return { bitmap, depth: { min, max, unit: depthUnit(encoding) ?? 'm' } };
}

/** Decode a sensor_msgs/Image (raw pixels in a supported encoding). */
async function decodeRaw(
  msg: Record<string, unknown>,
  depthOpts: ColorizeOptions,
): Promise<DecodedFrame> {
  const width = msg.width as number;
  const height = msg.height as number;
  const encoding = String(msg.encoding ?? 'rgb8').toLowerCase();
  const data = msg.data as Uint8Array;

  const depth = decodeRawDepth(encoding, data, width, height, msg.is_bigendian === true || msg.is_bigendian === 1);
  if (depth) return colorizedFrame(depth, width, height, encoding, depthOpts);

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
  return { bitmap: await createImageBitmap(imageData) };
}
