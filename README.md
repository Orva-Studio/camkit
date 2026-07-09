# camkit

**The missing CLI and MCP server for Camtasia.**

Programmatic Camtasia editing toolkit. A Camtasia `.cmproj` bundle's
timeline is plain JSON (`project.tscproj`); camkit reads and rewrites it
directly — no ffmpeg re-encoding, Camtasia stays the final renderer.

> **Platform:** the core timeline and media commands are cross-platform; the
> Camtasia app-control commands (`status`, `open`, `close`, `docs`) drive the
> macOS app via AppleScript and are macOS-only.

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
  export-audio, export-video, captions, silences, transcribe, status, close,
  open, docs.
  Rebuild always backs up to `.bak` and refuses to run with a
  `~project.tscproj` lock or an existing backup unless `--force`. Always
  `--dry-run` first. `export-audio` flat-mixes the timeline's audio to one file
  (m4a/wav/flac/…) for cleanup in Audacity/Auphonic — pure ffmpeg, honours track
  mute and per-clip gain (`--raw` to bypass). `captions` injects an animated
  Dynamic Caption track straight into the project from a transcript (same
  backup/lock safety as rebuild). `export-video` renders the current timeline to
  a ProRes 422 `.mov` by driving Camtasia's GUI export (Camtasia stays the
  renderer — effects, transitions, Dynamic Captions and `.trec` video streams
  need its engine, no ffmpeg re-encode). macOS-only; needs Accessibility
  permission. Verified on Camtasia 2026.1.3.
- **@camkit/mcp** — placeholder; will wrap core later.

## Prerequisites

- **Bun** ≥ 1.x
- **ffmpeg** on PATH — required by `camkit export-audio`, `silences`, and
  `transcribe` (`brew install ffmpeg`)
- **A transcription engine** — required by `camkit transcribe` only; see
  [Transcription engines](docs/transcription.md). `OPENAI_API_KEY` (cloud),
  `REPLICATE_API_TOKEN` (hosted), or `whisper-cpp` (local,
  `brew install whisper-cpp`).
- **macOS + Camtasia** — required by `status`/`close`/`open`/`docs` and
  `export-video`; everything else is cross-platform
- **Accessibility permission** — required by `camkit export-video` only. It
  drives Camtasia's export GUI via System Events, so grant your terminal under
  System Settings ▸ Privacy & Security ▸ Accessibility.

## Docs

- [Transcription engines](docs/transcription.md) — engine precedence (OpenAI,
  Replicate, local whisper.cpp), model overrides.
- [Captions in the Camtasia UI](docs/captions.md) — higher-quality captions,
  Dynamic Caption presets, SRT import.
- [Why `export-video` drives the GUI](docs/export-video.md) — why rendering
  can't be done from JSON, the export approaches tried, and why UI scripting is
  the only working path.

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
