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
  export-audio, captions, silences, transcribe, status, close, open, docs.
  Rebuild always backs up to `.bak` and refuses to run with a
  `~project.tscproj` lock or an existing backup unless `--force`. Always
  `--dry-run` first. `export-audio` flat-mixes the timeline's audio to one file
  (m4a/wav/flac/…) for cleanup in Audacity/Auphonic — pure ffmpeg, honours track
  mute and per-clip gain (`--raw` to bypass). `captions` injects an animated
  Dynamic Caption track straight into the project from a transcript (same
  backup/lock safety as rebuild).
- **@camkit/mcp** — placeholder; will wrap core later.

## Prerequisites

- **Bun** ≥ 1.x
- **ffmpeg** on PATH — required by `camkit export-audio`, `silences`, and
  `transcribe` (`brew install ffmpeg`)
- **A transcription engine** — required by `camkit transcribe` only; see
  *Transcription engines* below. `OPENAI_API_KEY` (cloud),
  `REPLICATE_API_TOKEN` (hosted), or `whisper-cpp` (local,
  `brew install whisper-cpp`).
- **macOS + Camtasia** — required by `status`/`close`/`open`/`docs` only;
  everything else is cross-platform

## Transcription engines

`camkit transcribe` resolves an engine by precedence (highest wins): an
explicit `--engine openai|replicate|whisper-cpp` flag, then environment, then
the `auto` default. `auto` picks:

1. **`OPENAI_API_KEY` set → OpenAI `whisper-1`** (best quality). Note: this is
   pinned to `whisper-1`, not a "newer" model — the `gpt-4o-transcribe` models
   don't return the word-level timestamps the rebuild step needs.
2. **Else `REPLICATE_API_TOKEN` set → Replicate** hosted
   `vaibhavs10/incredibly-fast-whisper` (word-level timestamps). Beats local
   whisper-cpp whenever the token is present — use `--engine whisper-cpp` to
   force local. Model version is pinned in code; refresh via Replicate's
   `/v1/models/.../versions` API if predictions start failing.
3. **Else `whisper-cli` on PATH → local whisper.cpp.** By default it reuses the
   `ggml` model Camtasia downloads to
   `Camtasia.app/Contents/Resources/models/speechToText/` (tiny/quantized —
   fast, lower fidelity). Override with `CAMKIT_WHISPER_MODEL` (path to a
   larger `ggml-*.bin`) or `CAMKIT_WHISPER_BIN`.
4. **None → an error** telling you to set `OPENAI_API_KEY` or
   `REPLICATE_API_TOKEN`, or run `brew install whisper-cpp`. camkit never
   auto-installs (no silent `brew`).

camkit reuses Camtasia's *model file* but not its bundled `libwhisper.dylib`
(private, code-signed, undocumented ABI) — you bring your own `whisper-cli`
runner. The tiny local model has coarser word timestamps, so cross-checking
with `camkit silences` matters even more on the local path.

## Captions in the Camtasia UI

To get higher-quality captions than Camtasia's built-in tiny model: transcribe
with camkit (OpenAI or a larger local model), then either bring the result into
Camtasia via SRT import (File ▸ Import ▸ Captions), or use `camkit captions` to
inject an animated **Dynamic Caption** track straight into the project. Do
**not** swap Camtasia's bundled model file — it's redownloaded on update and
unsupported.

`camkit captions --from take.transcript.json --preset "Bebas 3 Line Word Red"`
writes the word-level stream onto the source and adds a styled caption track via
the same `close → edit → open` cycle as rebuild (with a `.bak` backup). The
style comes from a Camtasia Dynamic Caption preset, resolved on demand from
Camtasia's app-support dir — list them with `camkit captions --list-presets`,
including any custom presets you've saved. Classic (non-animated) captions
aren't supported; they can't do the per-word highlight, and you can promote a
Dynamic track's styling further in Camtasia's UI.

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
