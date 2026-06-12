# camkit

Programmatic Camtasia (Mac) editing toolkit. A Camtasia `.cmproj` bundle's
timeline is plain JSON (`project.tscproj`); camkit reads and rewrites it
directly — no ffmpeg re-encoding, Camtasia stays the final renderer.

Extracted from a working rough-cut workflow: record long takes → transcribe
with word-level Whisper timestamps → pick the best takes → `camkit rebuild`
rewrites the timeline to keep only the good segments.

## Packages

- **@camkit/core** — pure cross-platform logic: tscproj load/mutate, editRate
  time math (705600000 units/s at the project level), clips/sources listing,
  rebuild planning (per-(src,track) template dedup keeps two-track
  screen+camera recordings in sync), transcript + silence parsing. Functions
  return structured data; no console output, no platform calls.
- **@camkit/darwin** — macOS Camtasia app control via AppleScript: open
  documents list, status, open, close-with-save. Camtasia never re-reads
  project.tscproj while a document is open, so the edit cycle is
  `close (saves) → edit JSON → open (reloads)`. Throws on other platforms.
- **@camkit/cli** — the `camkit` binary: info, clips, sources, rebuild,
  silences, transcribe, status, close, open, docs. Rebuild always backs up to
  `.bak` and refuses to run with a `~project.tscproj` lock or an existing
  backup unless `--force`. Always `--dry-run` first.
- **@camkit/mcp** — placeholder; will wrap core later.

## Prerequisites

- **Bun** ≥ 1.x
- **ffmpeg** on PATH — required by `camkit silences` and `camkit
  transcribe` (`brew install ffmpeg`)
- **OPENAI_API_KEY** — required by `camkit transcribe` only (whisper-1, the
  only OpenAI model returning word timestamps)
- **macOS + Camtasia** — required by `status`/`close`/`open`/`docs` only;
  everything else is cross-platform

## Use

```sh
bun install
bun test             # unit tests (time math, rebuild planning, silence parsing)
bun run typecheck
bun run build        # standalone executable → packages/cli/dist/camkit
bun packages/cli/src/camkit.ts info --project path/to/foo.cmproj

# or put the bin on your PATH (it's the TS source, run by bun via shebang):
ln -sf "$PWD/packages/cli/src/camkit.ts" ~/.bun/bin/camkit
camkit --help
```

See `packages/cli/README.md` for full command documentation; every command
also has `camkit <command> --help`.

## Gotchas carried over from the reference workflow

- `.trec` recordings are QuickTime containers: ffmpeg reads the audio and
  h264 streams but cannot decode the tscc2 screen stream.
- Whisper folds pauses into stretched word timestamps — always cross-check
  kept ranges with `camkit silences` before finalizing a cut.
- After a rebuild the project is already cut and `.bak` holds the original;
  to recut, restore the `.bak` first or you'll back up the cut file.
