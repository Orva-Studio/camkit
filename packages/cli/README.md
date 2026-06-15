# @camkit/cli — the `camkit` command

CLI over `@camkit/core` (+ `@camkit/darwin` on macOS) for editing Camtasia
projects programmatically. A `.cmproj` bundle's timeline is plain JSON
(`project.tscproj`); these commands read and rewrite it directly. Camtasia is
always the final renderer — source media is never re-encoded.

## Prerequisites

- **Bun** ≥ 1.x (runs the TypeScript bin directly, no build step)
- **ffmpeg** on PATH — required by `silences` and `transcribe`
- **A transcription engine** — required by `transcribe` only: either
  `OPENAI_API_KEY` in the environment, or `whisper-cpp` (`brew install
  whisper-cpp`) for local transcription
- **macOS + Camtasia** — required by `status`, `close`, `open`, `docs` only
  (everything else is cross-platform)

## Install locally

The bin is the TypeScript source itself (`#!/usr/bin/env bun`), so a symlink
onto your PATH is all it takes — edits to the repo are live immediately:

```sh
chmod +x packages/cli/src/camkit.ts
ln -sf "$PWD/packages/cli/src/camkit.ts" ~/.bun/bin/camkit
camkit --help
```

(`bun link --global` currently leaves a dangling symlink for workspace
packages; the direct symlink does the same job.) Or run without linking:
`bun packages/cli/src/camkit.ts <command>`.

## Build a standalone binary

```sh
bun run build        # from the repo root or packages/cli
./packages/cli/dist/camkit --help
```

`bun build --compile` produces a self-contained executable (~60 MB, bundles
the Bun runtime) — no Bun install needed on the target machine. ffmpeg /
OPENAI_API_KEY are still runtime requirements for silences/transcribe.

## Global flags

- `--project PATH` — a `.cmproj` directory or a `project.tscproj` path.
  Defaults to `./search.cmproj/project.tscproj`. If neither is given and the
  default doesn't exist, the read commands (`info`, `clips`, `sources`) fall
  back to the project currently open in Camtasia (macOS) — if exactly one is
  open, it's used (noted on stderr); if several are open, they're listed so
  you can pick. `rebuild` never guesses: it always needs an explicit or
  default path, and refuses to run while the project is open anyway.
- `--help` / `-h` — global or per-command (`camkit rebuild --help`).
- `--version` / `-v` — print the camkit version.

Read commands (`info`, `clips`, `sources`, `status`, `docs`) never mutate
anything. The only mutating command is `rebuild`.

## Commands

### `camkit info [--project P]`
Project summary: dimensions, fps, project editRate (705600000 units/s on
2026.x projects), track count, source count, duration.

### `camkit clips [--project P] [--json]`
Timeline clips: track, type, source id, start/end in seconds, backing
recording — plus which recordings are actually **on the timeline**. Use this
to pick what to transcribe; raw takes in `recordings/` may not be placed yet.

### `camkit sources [--project P] [--json]`
Media-bin listing: every imported source with duration and whether it's
placed on the timeline (`clips` shows the timeline; `sources` shows the bin
including unplaced takes).

### `camkit rebuild [--project P] --keep "SRC:start-end ..." [--dry-run] [--force]`
The core rough-cut operation. Rewrites the timeline to keep only the listed
source segments, in order, ripple-laid with no gaps (seconds → editRate
units). Every track a source touches is cloned at the same timeline position,
so a screen recording's two tracks (screen capture + synced camera/audio)
stay in sync. Cloned clips get fresh non-colliding ids.

- `--keep "1:159.8-179.2 2:46.3-60.0"` — keep src-1 159.8–179.2s, then
  src-2 46.3–60.0s.
- `--from FILE` — JSON `[{src,start,end}]` or `{keep:[...]}` instead.
- `--dry-run` — print the plan, write nothing. **Always do this first.**
- `--force` — override a stale `~project.tscproj` lock / overwrite an
  existing `.bak`.

Safety rules (enforced):
1. Backs up to `project.tscproj.bak` before writing.
2. Refuses to run if `~project.tscproj` exists (Camtasia likely has the
   project open) unless `--force`.
3. Refuses to clobber an existing `.bak` unless `--force` — one bad edit
   can't destroy the only backup.

**Recutting gotcha:** after a rebuild, the project is already cut and `.bak`
holds the original. To recut, first `cp project.tscproj.bak project.tscproj`,
then rebuild — otherwise you back up the already-cut file.

### `camkit silences <input.trec> [--range a-b] [--db -35] [--min 0.4]`
ffmpeg `silencedetect` on a recording's audio. Run on every kept range before
finalizing a cut: Whisper folds pauses into a stretched neighboring word's
timestamps, so transcripts alone miss dead air — and apparent gaps in word
times can hide a clean retake that silencedetect shows as continuous speech.

### `camkit transcribe <input> [--engine openai|whisper-cpp] [--out FILE] [--model whisper-1] [--srt [FILE]] [--keep-audio]`
Word-level transcription. Extracts audio with ffmpeg (`.trec` is a QuickTime
container; audio is readable, the tscc2 video stream is not), never touches
source media.

The engine is resolved by precedence — `--engine`, then `OPENAI_API_KEY`
(OpenAI `whisper-1`, best quality; downsamples to mono mp3 under the 25 MB
upload limit), then local `whisper.cpp` if `whisper-cli` is on PATH
(`brew install whisper-cpp`; decodes a mono 16 kHz wav). camkit never
auto-installs. The OpenAI model must be `whisper-1` — the gpt-4o-transcribe
models don't return word timestamps.

The local engine reuses the ggml model Camtasia downloads for its built-in
captions by default; override with `CAMKIT_WHISPER_MODEL` (path to a larger
`ggml-*.bin`) or `CAMKIT_WHISPER_BIN`. The tiny model's word timestamps are
coarser, so cross-check kept ranges with `camkit silences`.

`--srt` also writes SRT captions (segment-level) next to the output, or to an
explicit path, for Camtasia import (File ▸ Import ▸ Captions). Output:

```json
{ "source": "...", "model": "whisper-1", "duration": 123.4, "text": "...",
  "words": [{ "word": "...", "start": 0.0, "end": 0.4 }],
  "segments": [{ "id": 0, "start": 0.0, "end": 5.2, "text": "..." }] }
```

### `camkit status [--project P]` (macOS)
Whether **this specific project** is open in Camtasia — the app staying
running with other projects open is normal and harmless. Exits 2 if open
(do not edit the JSON; Camtasia overwrites disk edits on save).

### `camkit close [--project P]` (macOS)
`close document "X" saving yes` via AppleScript: saves unsaved user edits,
closes only that document, never quits the app.

### `camkit open [--project P]` (macOS)
(Re)opens the project, e.g. after a rebuild. Full edit cycle for a project
the user has open: `close` → edit `project.tscproj` → `open`.

### `camkit docs` (macOS)
List all projects currently open in Camtasia.

## Typical rough-cut workflow

```sh
camkit status --project foo.cmproj        # exit 2? close it first
camkit close  --project foo.cmproj
camkit clips  --project foo.cmproj        # what's on the timeline?
camkit transcribe foo.cmproj/recordings/take1.trec --out transcripts/take1.transcript.json
# pick takes from the transcript...
camkit silences foo.cmproj/recordings/take1.trec --range 46-60   # verify no dead air
camkit rebuild --project foo.cmproj --keep "1:46.3-60.0" --dry-run
camkit rebuild --project foo.cmproj --keep "1:46.3-60.0"
camkit open --project foo.cmproj          # review in Camtasia
```
