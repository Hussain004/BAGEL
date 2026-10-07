# BAGEL Agent Instructions

These instructions apply to the entire repository.

## Project context

- BAGEL means BAG ExpLoration. It is a browser-based ROS bag exploration and visualization application.
- Read `.codex/memory/MEMORY.md` before substantial work. It contains the curated project history migrated from Claude Code on 2026-07-17.
- Treat historical release, branch, PR, issue, and remote status as a lead, not current truth. Re-check the repository and remote state before relying on it.

## Permanent user preferences

- Never use the em dash character (U+2014) in repository content, code comments, UI copy, documentation, commit messages, PR text, or other project writing. Rephrase or use a hyphen, comma, parentheses, semicolon, or separate sentence.
- Never add Claude, Codex, OpenAI, Anthropic, or other AI attribution or co-author trailers to commits or PRs.

## Git safety

- Preserve pre-existing user changes. Never sweep unrelated working-tree changes into a task.
- The current checkout has historically contained extensive unrelated modifications. Inspect status and committed divergence before editing.
- For a PR when the checkout is dirty, prefer a fresh worktree and branch based on the latest `origin/main`. Copy or reproduce only task-specific changes there.
- Before committing a small change, inspect the diff size and check for accidental CRLF conversion when a file appears fully rewritten.
- Do not assume local `main` is current. Check `origin/main` before describing shipped behavior or starting release work.

## Testing principles

- Test parsers, codecs, and binary formats with realistic data shapes and deliberately varied producer options, including absent or inaccurate optional lengths and sizes.
- For stateful or WASM dependencies used in hot paths, test many varied sequential calls on reused instances. A few one-shot happy-path tests are insufficient.
- If a replacement is stricter than an existing forgiving implementation, explicitly test the assumptions introduced by that strictness.

