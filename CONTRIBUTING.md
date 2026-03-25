# Contributing to Touch Grass

Thanks for contributing to Touch Grass. This project is an open source Chrome extension focused on enforced recovery during deep work sessions, and small, focused improvements are the easiest way to keep it moving.

## Local setup

For the full setup and extension-loading flow, start with [README.md](README.md).

Basic local setup:

1. Install dependencies with `npm install`.
2. Build once with `npm run build`.
3. During development, use `npm run dev`.
4. Run `npm run typecheck` before opening a pull request.

## Finding something to work on

- Check GitHub Issues for open work.
- Start with issues labeled `good first issue` if you want something scoped and beginner-friendly.
- If you want to work on a larger change, open or comment on an issue first so effort does not overlap.

## Branch naming

Use one of these branch prefixes:

- `feat/name`
- `fix/name`
- `chore/name`

Keep the suffix short and descriptive, for example `feat/check-in-flow` or `fix/break-overlay-timer`.

## Pull requests

- Keep each pull request focused on one change.
- Describe what the change does and why it is needed.
- Link the relevant issue when there is one.
- Include screenshots or short recordings for UI changes when they help reviewers verify behavior quickly.

## Code style

- TypeScript runs in strict mode.
- Do not use `any`.
- Prefer a single responsibility per file.
- Keep shared types and storage contracts explicit rather than inferred through loose objects.

## Reporting bugs

Open a GitHub issue and include:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Chrome version
- Operating system
- Screenshots or recordings if the bug is UI- or timing-related
