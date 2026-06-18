# Contributing to camkit

Thanks for your interest in improving camkit. This guide covers how to get set
up, the conventions the codebase follows, and how to land a change.

## Getting started

camkit is a [Bun](https://bun.sh) workspace. You'll need Bun ≥ 1.x. A few
commands also need `ffmpeg` on your PATH and an `OPENAI_API_KEY` (see the
README's prerequisites).

```sh
bun install
bun test          # unit tests
bun run typecheck # tsc --noEmit
bun run build     # standalone CLI binary → packages/cli/dist/camkit
```

## Project layout

The workspace is split into packages with deliberately strict boundaries:

- **@camkit/core** — pure, cross-platform logic. Functions return structured
  data; no console output and no platform calls. New parsing, time-math, or
  rebuild-planning logic belongs here, behind unit tests.
- **@camkit/darwin** — macOS Camtasia control via AppleScript. Anything that
  shells out to the OS or the Camtasia app lives here and throws on other
  platforms.
- **@camkit/cli** — the `camkit` binary. Argument parsing, console output, and
  orchestration only; the real work should delegate to core/darwin.
- **@camkit/mcp** — placeholder, wraps core later. Keep it a stub for now.

When adding behavior, push the testable logic into `core` and keep `cli` thin.

## Conventions

- Keep core free of side effects — no `console.*`, no filesystem or process
  calls in functions that compute results.
- Time math uses the project editRate (705600000 units/s). Reuse the existing
  helpers rather than hand-rolling conversions.
- Rebuild always writes a `.bak` and refuses to clobber an existing backup or
  run against a `~project.tscproj` lock without `--force`. Preserve those
  safety checks.
- Match the surrounding code style; this project uses TypeScript throughout.

## Tests

Add or update unit tests for any change to core logic (time math, rebuild
planning, transcript/silence parsing). Run `bun test` and `bun run typecheck`
before opening a PR — both must pass.

## Pull requests

1. Branch off `main`.
2. Make focused commits with clear messages.
3. Ensure `bun test` and `bun run typecheck` pass.
4. Open a PR describing what changed and why. Note any manual verification
   done against a real `.cmproj` if the change touches rebuild.

## Releases

camkit follows [semver](https://semver.org). Pre-1.0 the rules are:

- **New features bump the minor** (`0.1.0` → `0.2.0`).
- **Bug fixes bump the patch** (`0.1.0` → `0.1.1`).

To cut a release, from a clean `main`:

```sh
bun run release 0.2.0
```

This bumps the root and every workspace `package.json` in lockstep, commits
`chore(release): vX.Y.Z`, tags it, and pushes `main` + the tag. The pushed tag
triggers `.github/workflows/release.yml`, which cross-compiles the binaries,
generates checksums, and publishes a GitHub Release with `install.sh` attached.
The script guards against running off `main`, a dirty tree, a non-fast-forward
pull, or a duplicate tag.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE.md).
