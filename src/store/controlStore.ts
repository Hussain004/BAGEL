import { create } from 'zustand';

/**
 * What the control card shows for each live connection. The truth lives in the
 * connection's `TeleopController`; this mirrors it so React can render. Cleared
 * with the connection, and always starts disarmed.
 */
import type { FoxgloveService } from '../live/foxgloveClient';

export interface ControlView {
  enabled: boolean;
  /** The last send did not go out: the robot may not have received a stop. */
  sendFailed: boolean;
  /** Services the server offers (empty unless it has the services capability). */
  services: FoxgloveService[];
}

interface ControlState {
  views: ReadonlyMap<string, ControlView>;
  set: (bagId: string, view: ControlView) => void;
  clear: (bagId: string) => void;
}

export const DISARMED: ControlView = { enabled: false, sendFailed: false, services: [] };

export const useControlStore = create<ControlState>((set) => ({
  views: new Map(),
  set: (bagId, view) => set((s) => ({ views: new Map(s.views).set(bagId, view) })),
  clear: (bagId) =>
    set((s) => {
      const next = new Map(s.views);
      next.delete(bagId);
      return { views: next };
    }),
}));
