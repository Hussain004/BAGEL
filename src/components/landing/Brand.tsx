import { motion, useReducedMotion } from 'framer-motion';

export function BrandMark({ compact = false }: { compact?: boolean }) {
  const reduceMotion = useReducedMotion();
  const size = compact ? 30 : 42;

  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <motion.span
        className="brand-mark__orbit"
        animate={reduceMotion ? undefined : { rotate: 360 }}
        transition={{ duration: 14, ease: 'linear', repeat: Infinity }}
      />
      <span className="brand-mark__ring" />
      <span className="brand-mark__core" />
    </span>
  );
}

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand-lockup">
      <BrandMark compact={compact} />
      <span className={compact ? 'brand-wordmark brand-wordmark--compact' : 'brand-wordmark'}>
        BAGEL
      </span>
    </span>
  );
}
