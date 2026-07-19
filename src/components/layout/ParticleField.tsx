import { useEffect, useRef } from 'react';

/**
 * ParticleField - Canvas-based animated particle/node background for the
 * landing page. Softly drifting dots with subtle connecting lines evoking
 * a neural-network or constellation aesthetic. Matches the robotics theme.
 *
 * Respects prefers-reduced-motion: renders a static frame and stops.
 * Uses devicePixelRatio for crisp rendering on HiDPI displays.
 * Pauses when the tab is hidden (requestAnimationFrame loop).
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Base opacity, slight per-particle variation */
  baseAlpha: number;
  /** Hue offset for subtle colour variation (blue/cyan range) */
  hueShift: number;
}

const PARTICLE_COUNT = 60;
const CONNECTION_DISTANCE = 140;
const MOUSE_INFLUENCE_RADIUS = 200;
const MOUSE_PUSH_STRENGTH = 0.3;

/** Speed scale tied to device performance heuristic. */
function speedScale(): number {
  if (typeof navigator === 'undefined') return 1;
  const cores = navigator.hardwareConcurrency ?? 4;
  // Fewer particles / slower on low-core machines
  return cores <= 2 ? 0.6 : 1;
}

function createParticle(w: number, h: number): Particle {
  const angle = Math.random() * Math.PI * 2;
  const speed = (0.15 + Math.random() * 0.25) * speedScale();
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    r: 1.2 + Math.random() * 1.2,
    baseAlpha: 0.15 + Math.random() * 0.2,
    hueShift: -10 + Math.random() * 30, // -10 to +20 around cyan(185)
  };
}

export function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    prefersReducedMotion.current = mql.matches;

    const onChange = (e: MediaQueryListEvent) => {
      prefersReducedMotion.current = e.matches;
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let particles: Particle[] = [];
    let animId = 0;
    let lastTime = 0;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas!.getBoundingClientRect();
      canvas!.width = rect.width * dpr;
      canvas!.height = rect.height * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function init() {
      resize();
      const rect = canvas!.getBoundingClientRect();
      particles = Array.from({ length: PARTICLE_COUNT }, () =>
        createParticle(rect.width, rect.height)
      );
    }

    function onMouseMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    }

    function onMouseLeave() {
      mouseRef.current.x = -9999;
      mouseRef.current.y = -9999;
    }

    function frame(time: number) {
      animId = requestAnimationFrame(frame);

      if (!lastTime) lastTime = time;
      const dt = Math.min((time - lastTime) / 16.667, 3); // cap at 3 frames
      lastTime = time;

      const rect = canvas!.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      ctx!.clearRect(0, 0, w, h);

      // Static frame for reduced-motion
      if (prefersReducedMotion.current) {
        drawStaticParticles(ctx!, particles);
        return;
      }

      // Update positions
      for (const p of particles) {
        // Mouse repulsion
        const dx = p.x - mx;
        const dy = p.y - my;
        const distSq = dx * dx + dy * dy;
        const influence = MOUSE_INFLUENCE_RADIUS * MOUSE_INFLUENCE_RADIUS;
        if (distSq < influence && distSq > 1) {
          const dist = Math.sqrt(distSq);
          const force = (1 - dist / MOUSE_INFLUENCE_RADIUS) * MOUSE_PUSH_STRENGTH;
          p.vx += (dx / dist) * force * dt;
          p.vy += (dy / dist) * force * dt;
        }

        // Damping to prevent runaway
        p.vx *= 0.998;
        p.vy *= 0.998;

        p.x += p.vx * dt;
        p.y += p.vy * dt;

        // Wrap around
        if (p.x < -10) p.x = w + 10;
        else if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        else if (p.y > h + 10) p.y = -10;
      }

      // Draw connections
      const connectionDistSq = CONNECTION_DISTANCE * CONNECTION_DISTANCE;
      ctx!.lineWidth = 0.5;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distSq = dx * dx + dy * dy;
          if (distSq < connectionDistSq) {
            const alpha = (1 - distSq / connectionDistSq) * 0.08;
            ctx!.strokeStyle = `rgba(100, 160, 220, ${alpha})`;
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.stroke();
          }
        }
      }

      // Draw particles
      for (const p of particles) {
        // Slight breathing animation on opacity
        const breathe = Math.sin(time * 0.001 + p.hueShift) * 0.05;
        const alpha = Math.max(0, p.baseAlpha + breathe);
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fillStyle = `hsla(${185 + p.hueShift}, 70%, 65%, ${alpha})`;
        ctx!.fill();

        // Subtle glow
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.r * 2.5, 0, Math.PI * 2);
        ctx!.fillStyle = `hsla(${185 + p.hueShift}, 70%, 65%, ${alpha * 0.15})`;
        ctx!.fill();
      }
    }

    function drawStaticParticles(
      c: CanvasRenderingContext2D,
      ps: Particle[],
    ) {
      const distSq = CONNECTION_DISTANCE * CONNECTION_DISTANCE;
      c.lineWidth = 0.5;
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const dx = ps[i].x - ps[j].x;
          const dy = ps[i].y - ps[j].y;
          const d = dx * dx + dy * dy;
          if (d < distSq) {
            c.strokeStyle = `rgba(100, 160, 220, ${(1 - d / distSq) * 0.08})`;
            c.beginPath();
            c.moveTo(ps[i].x, ps[i].y);
            c.lineTo(ps[j].x, ps[j].y);
            c.stroke();
          }
        }
      }
      for (const p of ps) {
        c.beginPath();
        c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        c.fillStyle = `hsla(${185 + p.hueShift}, 70%, 65%, ${p.baseAlpha})`;
        c.fill();
      }
    }

    init();
    animId = requestAnimationFrame(frame);

    window.addEventListener('resize', resize);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);

    // Pause when hidden
    const onVis = () => {
      if (document.hidden) {
        cancelAnimationFrame(animId);
      } else {
        lastTime = 0;
        animId = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-auto"
      style={{ opacity: 0.7 }}
      aria-hidden="true"
    />
  );
}
