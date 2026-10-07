## What does this change?

<!-- One or two sentences. What is different after this PR? -->

## Why?

<!-- The problem being solved. Link the issue if there is one: Fixes #123 -->

## How was it verified?

<!-- Be specific. "Looks good" is not verification. -->

- [ ] I ran `pnpm test` and the full suite passes
- [ ] I ran `pnpm lint` and it exits 0
- [ ] I ran `pnpm exec tsc -b` and it type-checks
- [ ] I ran the app and used the change myself (`pnpm dev`)

## Checklist

- [ ] Tests added or updated. The suite is logic-only: pure logic goes in `src/utils/` with a test in `tests/utils/`, store logic in `tests/store/`.
- [ ] If this adds support for a new message type: the `is*Type` detector, the entry in `panelOptionsFor()`, the render path, and a `tests/fixtures/synth.ts` fixture.
- [ ] If user-facing: added a line to `FEATURES.md`.
- [ ] No em dashes (U+2014) anywhere in the diff. Checked with `grep -rn $'\u2014' src/`.
- [ ] No AI co-author trailers on the commit.
- [ ] Zustand selectors return a stable reference, not a fresh `[]` or `{}` (that causes an infinite render loop that tests will not catch).
- [ ] Parsing still happens in the worker, not on the main thread.

## Screenshots

<!-- For visual changes: before and after, in both themes if relevant. -->