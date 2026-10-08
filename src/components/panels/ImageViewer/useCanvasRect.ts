import { useEffect, useState, type RefObject } from 'react';

export interface CanvasRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the image canvas sits inside its wrapper, in the wrapper's own
 * (unzoomed) pixels, kept current through resizes. Overlays position
 * themselves with this so they stay glued to the picture.
 */
export function useCanvasRect(canvasRef: RefObject<HTMLCanvasElement | null>, active: boolean, redoOn: unknown): CanvasRect | null {
  const [rect, setRect] = useState<CanvasRect | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent || !active) return;
    const compute = () => {
      const c = canvas.getBoundingClientRect();
      const p = parent.getBoundingClientRect();
      // Positioned against the wrapper, which is not scaled by the zoom
      // transform's own box model, so divide that scale back out.
      const sx = parent.offsetWidth > 0 ? p.width / parent.offsetWidth : 1;
      setRect({
        left: (c.left - p.left) / sx,
        top: (c.top - p.top) / sx,
        width: c.width / sx,
        height: c.height / sx,
      });
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(canvas);
    ro.observe(parent);
    return () => ro.disconnect();
  }, [canvasRef, active, redoOn]);
  return rect;
}
