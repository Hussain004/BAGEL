/**
 * LiDAR points drawn over the camera image, coloured by depth.
 *
 * Mounted only while a cloud topic is selected: it loads the TF tree and a
 * decoded cloud, both of which an ordinary image panel has no need for.
 */

import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useDecodedCloud } from '../ThreeDScene/useDecodedPointCloud';
import { composeTFChain } from '../ThreeDScene/tfTransform';
import { useTFGraph } from '../TFTree/useTFGraph';
import type { CameraIntrinsics } from '../../../hooks/useCameraInfo';
import { paintProjection, projectCloud } from '../../../utils/projectCloud';
import { useCanvasRect } from './useCanvasRect';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Cap on points projected per frame; plenty to judge alignment, cheap to draw. */
const MAX_POINTS = 200_000;

interface Props {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  topic: string;
  bagId?: string;
  /** Log time of the displayed image; the nearest cloud is used. */
  timeNs: bigint;
  camera: CameraIntrinsics;
  imageSize: { width: number; height: number };
  /** The displayed frame is undistorted. */
  rectified: boolean;
  /** Where the one-line status goes (the panel footer), so it never covers the picture. */
  statusSlot: HTMLElement | null;
}

export function CloudProjection({ canvasRef, topic, bagId, timeNs, camera, imageSize, rectified, statusSlot }: Props) {
  const rect = useCanvasRect(canvasRef, true, imageSize);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const { cloud } = useDecodedCloud({
    kind: 'pointcloud',
    topicName: topic,
    timeNs,
    colorMode: 'single',
    maxPoints: MAX_POINTS,
    bagId,
  });
  const { graph } = useTFGraph(bagId);

  const cloudFrame = cloud?.frameId ?? '';
  const matrix = useMemo(() => {
    if (!cloud || !cloudFrame || !camera.frameId) return null;
    if (cloudFrame === camera.frameId) return IDENTITY;
    return graph ? (composeTFChain(graph, cloudFrame, camera.frameId, timeNs)?.elements ?? null) : null;
  }, [cloud, cloudFrame, camera.frameId, graph, timeNs]);

  const projected = useMemo(
    () =>
      cloud && matrix
        ? projectCloud(cloud.positions, matrix, camera, {
            rectified,
            imageWidth: imageSize.width,
            imageHeight: imageSize.height,
          })
        : null,
    [cloud, matrix, camera, rectified, imageSize.width, imageSize.height],
  );

  useEffect(() => {
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (projected) paintProjection(ctx, projected, Math.max(2, imageSize.width / 320));
  }, [projected, imageSize.width, imageSize.height]);

  let status: string;
  let detail = `${cloudFrame || '?'} to ${camera.frameId || '?'}`;
  if (!cloud) status = 'waiting for a point cloud...';
  else if (!cloudFrame) status = 'cloud has no frame_id, cannot place it';
  else if (!camera.frameId) status = 'CameraInfo has no frame_id, cannot place the camera';
  else if (!matrix) status = `no TF path from ${cloudFrame} to ${camera.frameId}`;
  else if (projected && projected.count === 0) {
    status = projected.inFront === 0 ? 'every point is behind the camera' : 'no point lands inside the image';
  } else if (projected) status = `${projected.count.toLocaleString()} of ${projected.total.toLocaleString()} points`;
  else status = '';
  if (cloud && matrix) detail = `${cloudFrame} to ${camera.frameId}`;

  return (
    <>
      {rect && (
        <canvas
          ref={overlayRef}
          width={imageSize.width}
          height={imageSize.height}
          className="pointer-events-none absolute"
          style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          aria-hidden
          data-testid="cloud-projection"
        />
      )}
      {statusSlot && createPortal(<span data-testid="cloud-projection-status" title={detail}>{status}</span>, statusSlot)}
    </>
  );
}
