/** The BAGEL mark: a bagel seen from above, drawn in the current text colour. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.25" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="12" cy="12" r="3.1" fill="currentColor" />
    </svg>
  );
}

export function BrandLockup() {
  return (
    <span className="brand-lockup">
      <BrandMark />
      <span className="brand-wordmark">BAGEL</span>
    </span>
  );
}
