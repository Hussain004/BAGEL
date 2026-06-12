/**
 * Panel capture registry for clip export.
 *
 * Each canvas-based panel calls `registerCapture` on mount and receives a
 * cleanup function to call on unmount. The export engine calls `captureCanvas`
 * to get the live HTMLCanvasElement for a given panelId at frame-capture time.
 */

const registry = new Map<string, () => HTMLCanvasElement | null>();

/**
 * Register a canvas getter for a panel. Returns a cleanup function that
 * removes the registration (suitable as a useEffect return value).
 */
export function registerCapture(
  panelId: string,
  getter: () => HTMLCanvasElement | null,
): () => void {
  registry.set(panelId, getter);
  return () => registry.delete(panelId);
}

/** Get the live canvas for a panel, or null if not registered / canvas gone. */
export function captureCanvas(panelId: string): HTMLCanvasElement | null {
  return registry.get(panelId)?.() ?? null;
}

/** All currently-registered panel ids. */
export function listCapturablePanelIds(): string[] {
  return [...registry.keys()];
}
