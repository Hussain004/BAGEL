import { useCallback, useEffect, useRef, useState } from 'react';
import { useBagStore, resolveBagEntry } from '../../store/bagStore';
import { useControlStore, DISARMED } from '../../store/controlStore';
import { useLiveStore } from '../../store/liveStore';
import { useUiStore } from '../../store/uiStore';
import { DRIVE_KEYS, keysToCommand, padToCommand } from '../../live/controlInput';
import type { TwistKind } from '../../live/controlCodec';

const PAD = 168;

/**
 * Drive a robot over a live connection. Starts disarmed; "Enable control" is
 * the only way to arm it, a red banner shows while it is armed, and every way of
 * letting go (pointer up, key up, focus loss, hiding the tab, closing the card,
 * losing the connection) stops the robot. BAGEL adds no authentication: that is
 * the bridge's job.
 */
export function ControlCard() {
  const open = useUiStore((s) => s.controlOpen);
  const setOpen = useUiStore((s) => s.setControlOpen);
  const bags = useBagStore();
  const entry = resolveBagEntry(bags, bags.focusBagId);
  const conn = entry?.kind === 'live' ? entry.liveConn : null;
  const bagId = entry?.id ?? '';
  const status = useLiveStore((s) => s.statuses.get(bagId));
  const view = useControlStore((s) => s.views.get(bagId)) ?? DISARMED;

  const [topic, setTopic] = useState('/cmd_vel');
  const [kind, setKind] = useState<TwistKind>('Twist');
  const [maxLinear, setMaxLinear] = useState(0.2);
  const [maxAngular, setMaxAngular] = useState(0.5);
  const [error, setError] = useState<string | null>(null);
  const [stick, setStick] = useState<{ x: number; y: number } | null>(null);
  const held = useRef(new Set<string>());
  const padRef = useRef<HTMLDivElement>(null);

  const stop = useCallback(() => {
    held.current.clear();
    setStick(null);
    conn?.teleop.release();
  }, [conn]);

  // Limits follow the sliders, including while a command is in flight.
  useEffect(() => {
    conn?.teleop.setLimits(maxLinear, maxAngular);
  }, [conn, maxLinear, maxAngular]);

  // Anything that takes the person's hands off the controls stops the robot.
  useEffect(() => {
    if (!conn || !view.enabled) return;
    const onHide = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [conn, view.enabled, stop]);

  // Switching bags or leaving the page disarms; so does closing the card.
  useEffect(() => {
    if (!conn) return;
    return () => conn.teleop.disable();
  }, [conn]);
  useEffect(() => {
    if (!open) conn?.teleop.disable();
  }, [open, conn]);

  if (!open || !conn) return null;
  const connected = status === 'connected';

  const arm = () => setError(conn.enableControl(topic.trim(), kind));
  const driveFromKeys = () => {
    const c = keysToCommand(held.current, maxLinear, maxAngular);
    conn.teleop.drive(c.linear, c.angular);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!view.enabled) return;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      e.preventDefault();
      e.stopPropagation();
      conn.teleop.disable();
      return;
    }
    if (key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      stop();
      return;
    }
    if (!DRIVE_KEYS.has(key)) return;
    e.preventDefault();
    e.stopPropagation(); // W/A/S/D belong to the robot here, not to panel shortcuts
    if (!e.repeat) {
      held.current.add(key);
      driveFromKeys();
    }
  };
  const onKeyUp = (e: React.KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (!held.current.delete(key)) return;
    if (held.current.size === 0) conn.teleop.release();
    else driveFromKeys();
  };

  const moveStick = (e: React.PointerEvent) => {
    const r = padRef.current!.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = ((e.clientY - r.top) / r.height) * 2 - 1;
    const mag = Math.hypot(x, y);
    const p = mag > 1 ? { x: x / mag, y: y / mag } : { x, y };
    setStick(p);
    const c = padToCommand(p.x, p.y, maxLinear, maxAngular);
    conn.teleop.drive(c.linear, c.angular);
  };

  return (
    <section
      aria-label="Robot control"
      data-testid="control-card"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) stop();
      }}
      className={`fixed z-[85] bottom-20 left-4 w-72 rounded-xl border bg-bg-secondary p-3 shadow-panel text-xs text-text-secondary focus:outline-none ${
        view.enabled ? 'border-accent-rose' : 'border-border'
      }`}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">Robot control</h2>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close control" className="text-text-tertiary hover:text-text-primary text-lg leading-none px-1">
          ×
        </button>
      </div>

      {!connected ? (
        <p className="mt-2" role="status">Not connected. Control is off.</p>
      ) : !conn.canPublish ? (
        <p className="mt-2" role="status">
          This server does not let clients publish. Start the bridge with the <code className="mono">clientPublish</code> capability to drive from here.
        </p>
      ) : !view.enabled ? (
        <div className="mt-2 space-y-2">
          <label className="flex flex-col gap-1">
            Topic
            <input value={topic} onChange={(e) => setTopic(e.target.value)} spellCheck={false} className="bg-bg-primary border border-border rounded-md px-2 py-1 mono text-text-primary" />
          </label>
          <label className="flex flex-col gap-1">
            Message
            <select value={kind} onChange={(e) => setKind(e.target.value as TwistKind)} className="bg-bg-primary border border-border rounded-md px-2 py-1 text-text-primary">
              <option value="Twist">geometry_msgs/Twist</option>
              <option value="TwistStamped">geometry_msgs/TwistStamped</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            Top speed
            <input type="range" min={0.05} max={1} step={0.05} value={maxLinear} onChange={(e) => setMaxLinear(Number(e.target.value))} className="flex-1" aria-label="Top speed" />
            <span className="mono w-14 text-right">{maxLinear.toFixed(2)} m/s</span>
          </label>
          <label className="flex items-center justify-between gap-2">
            Top turn
            <input type="range" min={0.1} max={2} step={0.1} value={maxAngular} onChange={(e) => setMaxAngular(Number(e.target.value))} className="flex-1" aria-label="Top turn rate" />
            <span className="mono w-14 text-right">{maxAngular.toFixed(1)} r/s</span>
          </label>
          {error && <p role="alert" className="text-accent-rose">{error}</p>}
          <button type="button" onClick={arm} className="w-full px-3 py-1.5 rounded-md border border-accent-rose/50 text-text-primary hover:bg-accent-rose/10">
            Enable control
          </button>
          <p className="text-[10px] text-text-tertiary">
            BAGEL adds no login and no safety limits beyond the speeds above. Keep the robot where you can reach its stop.
          </p>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <div role="alert" className="rounded-md bg-accent-rose/20 border border-accent-rose px-2 py-1 text-center font-semibold text-text-primary" data-testid="control-armed">
            CONTROL ON: sending to {topic}
          </div>
          <div
            ref={padRef}
            data-testid="control-pad"
            role="application"
            aria-label="Drive pad. Drag to drive, release to stop. W A S D or arrow keys also drive."
            tabIndex={0}
            style={{ width: PAD, height: PAD, touchAction: 'none' }}
            className="mx-auto relative rounded-full border border-border bg-bg-primary select-none cursor-grab focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-rose/60"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              e.currentTarget.focus();
              moveStick(e);
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) moveStick(e);
            }}
            onPointerUp={stop}
            onPointerCancel={stop}
            onLostPointerCapture={stop}
          >
            <div className="absolute left-1/2 top-1/2 w-px h-full -translate-x-1/2 bg-border" />
            <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-border" />
            <div
              className="absolute w-8 h-8 rounded-full bg-accent-rose/70 border border-accent-rose"
              style={{ left: PAD / 2 + (stick?.x ?? 0) * (PAD / 2 - 16) - 16, top: PAD / 2 + (stick?.y ?? 0) * (PAD / 2 - 16) - 16 }}
            />
          </div>
          <p className="text-center text-[10px] text-text-tertiary">Drag, or focus the pad and use W A S D / arrows. Space stops. Esc turns control off.</p>
          {view.sendFailed && (
            <p role="alert" className="text-accent-amber">A command could not be sent. The robot may not have received a stop.</p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={stop} className="flex-1 px-3 py-1.5 rounded-md bg-accent-rose/30 border border-accent-rose text-text-primary font-semibold">
              STOP
            </button>
            <button type="button" onClick={() => conn.teleop.disable()} className="px-3 py-1.5 rounded-md border border-border hover:border-accent-blue/40">
              Disable
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
