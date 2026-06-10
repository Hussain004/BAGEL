/**
 * Clip encoding utilities for the export pipeline.
 *
 * Two output formats:
 *  - PNG zip:  each frame is a PNG blob zipped with fflate (level 0 -
 *              PNGs are already compressed, no need to recompress).
 *  - WebM:     frames are played through a MediaRecorder attached to an
 *              OffscreenCanvas via captureStream(0) + requestFrame(), so
 *              the video plays at exactly the requested fps.
 */

import { zipSync } from 'fflate';

/**
 * Wait for the panel to finish re-rendering at the new playhead time.
 * Two rAF cycles flush the React update + Three.js render tick; the
 * 250 ms tail covers async worker decodes (images, point clouds).
 */
export function waitForPanelRender(): Promise<void> {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setTimeout(resolve, 250)),
    );
  });
}

/** Capture a canvas as a PNG blob. */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
      'image/png',
    );
  });
}

/**
 * Zip a sequence of PNG blobs as `frame_00001.png` … using STORED (level 0)
 * since PNGs are already deflated — additional compression only wastes CPU.
 */
export async function encodePngZip(frames: Blob[]): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  await Promise.all(
    frames.map(async (blob, i) => {
      const num = String(i + 1).padStart(5, '0');
      files[`frame_${num}.png`] = new Uint8Array(await blob.arrayBuffer());
    }),
  );
  return zipSync(files, { level: 0 });
}

/**
 * Encode a sequence of PNG blobs into a WebM video.
 *
 * Phase: offline, runs after all frames are captured. Each blob is drawn
 * onto an OffscreenCanvas and pushed to a MediaRecorder via requestFrame().
 * A `frameMs` sleep between pushes keeps the recorder's timestamps correct
 * so the video plays at exactly `fps`.
 */
export async function encodeWebM(
  frames: Blob[],
  fps: number,
  width: number,
  height: number,
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const frameMs = 1000 / fps;

  return new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    recorder.start();

    (async () => {
      for (const blob of frames) {
        const bmp = await createImageBitmap(blob);
        ctx.drawImage(bmp, 0, 0, width, height);
        bmp.close();
        track.requestFrame();
        await new Promise((r) => setTimeout(r, frameMs));
      }
      recorder.stop();
    })();
  });
}

/** Trigger a browser file download from a Uint8Array or Blob. */
export function downloadBytes(data: Uint8Array | Blob, filename: string): void {
  let blob: Blob;
  if (data instanceof Blob) {
    blob = data;
  } else {
    // Copy into a plain ArrayBuffer - fflate returns Uint8Array<ArrayBufferLike>
    // which TypeScript's Blob constructor does not accept under strict lib checks.
    const ab = new ArrayBuffer(data.byteLength);
    new Uint8Array(ab).set(data);
    blob = new Blob([ab]);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
