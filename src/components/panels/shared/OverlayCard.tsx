import type { HTMLAttributes, ReactNode } from 'react';

type OverlayCardVariant = 'solid' | 'subtle' | 'surface';

const VARIANT_CLASSES: Record<OverlayCardVariant, string> = {
  solid: 'bg-bg-primary/85 backdrop-blur',
  subtle: 'bg-bg-primary/60 backdrop-blur',
  surface: 'bg-surface/80',
};

interface OverlayCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  elevated?: boolean;
  variant?: OverlayCardVariant;
}

/**
 * Shared chrome for controls and readouts floating over canvas data surfaces.
 * Positioning, spacing, and text styles stay at the call site because they
 * describe content; background, border, radius, and elevation belong here.
 */
export function OverlayCard({
  children,
  elevated = false,
  variant = 'solid',
  className = '',
  ...props
}: OverlayCardProps) {
  return (
    <div
      className={`${VARIANT_CLASSES[variant]} border border-border rounded-md ${elevated ? 'shadow-panel' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
