/** Turning a joystick position or held keys into a speed. Pure, so it can be tested. */

export interface Command {
  linear: number;
  angular: number;
}

/** Stick travel inside this fraction of the pad counts as centred. */
export const DEADZONE = 0.12;

/**
 * `x` and `y` are the stick position in [-1, 1], x to the right and y down, as
 * on screen. Up is forward; left is a positive turn (counter-clockwise).
 */
export function padToCommand(x: number, y: number, maxLinear: number, maxAngular: number): Command {
  const clamp = (v: number) => (Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
  const shape = (v: number) => {
    const c = clamp(v);
    const m = Math.abs(c);
    if (m < DEADZONE) return 0;
    // Rescale so speed rises from zero at the edge of the dead zone to full at the rim.
    return Math.sign(c) * ((m - DEADZONE) / (1 - DEADZONE));
  };
  return { linear: -shape(y) * maxLinear + 0, angular: -shape(x) * maxAngular + 0 };
}

const FORWARD = new Set(['w', 'arrowup']);
const BACK = new Set(['s', 'arrowdown']);
const LEFT = new Set(['a', 'arrowleft']);
const RIGHT = new Set(['d', 'arrowright']);

/** Held keys (lower-cased `event.key`) to a command at full limit. Opposite keys cancel. */
export function keysToCommand(held: ReadonlySet<string>, maxLinear: number, maxAngular: number): Command {
  const any = (set: Set<string>) => [...held].some((k) => set.has(k));
  const fwd = (any(FORWARD) ? 1 : 0) - (any(BACK) ? 1 : 0);
  const left = (any(LEFT) ? 1 : 0) - (any(RIGHT) ? 1 : 0);
  return { linear: fwd * maxLinear + 0, angular: left * maxAngular + 0 };
}

export const DRIVE_KEYS: ReadonlySet<string> = new Set([...FORWARD, ...BACK, ...LEFT, ...RIGHT]);
