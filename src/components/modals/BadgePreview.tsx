/**
 * BadgePreview - renders the "Open in BAGEL" badge the Share modal generates,
 * as an `<img>` pointing at the real `/badge.svg`.
 *
 * Two reasons this is a component rather than an inline tag:
 *
 * 1. It proves the badge actually resolves. If `/badge.svg` were missing or
 *    renamed, the snippet would still copy fine and fail only once someone
 *    pasted it into their own README. Here it is visibly broken in the modal
 *    instead.
 * 2. It shows the user exactly what they are about to paste, including the
 *    gradient that a shields-style endpoint cannot render.
 */
export function BadgePreview({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-block rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-blue/60"
      title="Opens this view in BAGEL"
    >
      <img
        src={`${import.meta.env.BASE_URL ?? '/'}badge.svg`}
        alt="Open in BAGEL"
        height={20}
        className="block"
      />
    </a>
  );
}