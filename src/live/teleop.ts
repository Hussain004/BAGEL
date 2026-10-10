/**
 * Driving a robot from the browser, with the safety rules in one place.
 *
 * A `TeleopController` is armed by an explicit `enable()` and nothing else. It
 * never publishes unless armed, it sends a zero command whenever the person lets
 * go of the controls, and a lost connection disarms it without sending anything
 * (so a reconnect can never resume driving). Everything it needs from outside is
 * injected, so the rules can be tested without a socket or a clock.
 */

import type { PublishCodec, Twist } from './controlCodec';

/** Hard ceilings, whatever the sliders say. A browser is a poor place for a fast robot. */
export const MAX_LINEAR = 2.0;
export const MAX_ANGULAR = 3.0;
export const PUBLISH_HZ = 10;
/** Zero commands sent after release, in addition to the immediate one, in case one is dropped. */
export const TAIL_ZEROS = 2;

export interface TeleopIo {
  /** Advertise the topic on the server. False if it could not be sent. */
  advertise(topic: string, codec: PublishCodec): boolean;
  /** Stop advertising it. */
  unadvertise(): void;
  /** Send one encoded message. False if the socket is not open. */
  send(payload: Uint8Array): boolean;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export type TeleopState = 'disabled' | 'enabled';

export class TeleopController {
  private state: TeleopState = 'disabled';
  private target: Twist = { linear: 0, angular: 0 };
  private codec: PublishCodec | null = null;
  private timer: unknown = null;
  private tailLeft = 0;
  /** Whether anything non-zero has gone out since the last zero. */
  private moving = false;
  private maxLinear = 0.2;
  private maxAngular = 0.5;
  /** Last send failed (socket closed): surfaced so the UI can say the robot may not have stopped. */
  sendFailed = false;
  sent = 0;

  private readonly io: TeleopIo;
  private readonly onChange: () => void;

  constructor(io: TeleopIo, onChange: () => void = () => {}) {
    this.io = io;
    this.onChange = onChange;
  }

  get enabled(): boolean {
    return this.state === 'enabled';
  }

  get limits(): { linear: number; angular: number } {
    return { linear: this.maxLinear, angular: this.maxAngular };
  }

  setLimits(linear: number, angular: number): void {
    this.maxLinear = Math.max(0, Math.min(MAX_LINEAR, Number.isFinite(linear) ? linear : 0));
    this.maxAngular = Math.max(0, Math.min(MAX_ANGULAR, Number.isFinite(angular) ? angular : 0));
    // A lowered limit applies to a command already in progress.
    this.target = this.clamp(this.target);
  }

  /** Arm control on `topic` using `codec`. False (and still disarmed) if the server would not take the channel. */
  enable(topic: string, codec: PublishCodec): boolean {
    if (this.state === 'enabled') this.disable();
    if (!this.io.advertise(topic, codec)) return false;
    this.codec = codec;
    this.state = 'enabled';
    this.target = { linear: 0, angular: 0 };
    this.sendFailed = false;
    this.onChange();
    return true;
  }

  /** Disarm: stop moving first, then withdraw the channel. */
  disable(): void {
    if (this.state !== 'enabled') return;
    this.stopTimer();
    this.target = { linear: 0, angular: 0 };
    this.sendZero();
    this.state = 'disabled';
    this.codec = null;
    this.io.unadvertise();
    this.onChange();
  }

  /** The command to hold while the controls are held. Ignored unless armed. */
  drive(linear: number, angular: number): void {
    if (this.state !== 'enabled') return;
    this.target = this.clamp({ linear, angular });
    if (this.target.linear === 0 && this.target.angular === 0) {
      this.release();
      return;
    }
    this.tailLeft = 0;
    if (this.timer === null) {
      this.tick();
      this.timer = this.io.setInterval(() => this.tick(), 1000 / PUBLISH_HZ);
    }
  }

  /** Controls let go (pointer up, key up, blur, tab hidden): a zero now, and a few more to be sure. */
  release(): void {
    if (this.state !== 'enabled') return;
    this.target = { linear: 0, angular: 0 };
    if (!this.moving && this.timer === null) return; // nothing was sent, nothing to cancel
    this.sendZero();
    this.tailLeft = TAIL_ZEROS;
    if (this.timer === null) this.timer = this.io.setInterval(() => this.tick(), 1000 / PUBLISH_HZ);
  }

  /** The connection dropped. Disarm without sending: there is no one to send to, and a reconnect must start disarmed. */
  connectionLost(): void {
    this.stopTimer();
    this.target = { linear: 0, angular: 0 };
    this.moving = false;
    if (this.state === 'enabled') {
      this.state = 'disabled';
      this.codec = null;
      this.onChange();
    }
  }

  private tick(): void {
    if (this.state !== 'enabled') return this.stopTimer();
    const zero = this.target.linear === 0 && this.target.angular === 0;
    if (zero) {
      if (this.tailLeft <= 0) return this.stopTimer();
      this.tailLeft--;
      this.sendZero();
      if (this.tailLeft === 0) this.stopTimer();
      return;
    }
    this.publish(this.target);
  }

  private sendZero(): void {
    this.publish({ linear: 0, angular: 0 });
    this.moving = false;
  }

  private publish(t: Twist): void {
    if (!this.codec) return;
    const ok = this.io.send(this.codec.encode(t));
    const failedBefore = this.sendFailed;
    this.sendFailed = !ok;
    if (failedBefore !== this.sendFailed) this.onChange();
    if (ok) {
      this.sent++;
      if (t.linear !== 0 || t.angular !== 0) this.moving = true;
    }
  }

  private clamp(t: Twist): Twist {
    const c = (v: number, max: number) => (Number.isFinite(v) ? Math.max(-max, Math.min(max, v)) : 0);
    return { linear: c(t.linear, this.maxLinear), angular: c(t.angular, this.maxAngular) };
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      this.io.clearInterval(this.timer);
      this.timer = null;
    }
    this.tailLeft = 0;
  }
}
