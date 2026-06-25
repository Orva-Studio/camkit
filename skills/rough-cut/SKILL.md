---
name: rough-cut
description: Rough-cut the Camtasia project currently open in Camtasia — transcribe the on-timeline recordings with Whisper, then cut silences, filler, false starts, and bad retakes so the talk flows. Use when the user says "rough cut", "tidy the recording", "cut the silences/filler", "clean up the timeline", or similar. Optionally aligned to a script the user supplies; works without one too.
---

# rough-cut

Turn raw long-take recordings on a Camtasia timeline into a tight rough cut, using `camkit`. The user records long, this cuts the dead air, filler, false starts, and losing takes so the result flows.

## Hard rules

- **Only edit what is on the timeline.** Run `camkit clips` / `camkit sources` and operate on `on timeline` sources only. Never touch `bin only` sources.
- **Silences are the #1 failure.** Whisper folds pauses into stretched word timestamps, so word gaps alone hide dead air. You have missed silences before. For every source you MUST run `camkit silences` and use ITS timestamps to find/cut dead air. Do not trust the transcript's word times to find pauses.
- **Always `--dry-run` first.** `camkit rebuild` is destructive; review the plan before writing.
- **Script is optional.** If the user gives a script path, align to it (pick the take matching each line, keep script order, drop retakes). If not, just cut silences + filler + false starts and keep the natural order.

## Workflow

### 1. Find the open project
```sh
camkit status      # confirms Camtasia is running + which doc is open
camkit docs        # open .cmproj names + full paths
```
`camkit docs` prints `<name>\t<full path>` per open project. Capture the path for the project you want to cut:
```sh
P=$(camkit docs | grep '<doc-name>' | cut -f2)
```
Use it as `--project` for every command, or rely on the read-command fallback to the open project. Keep the path in a shell var.

### 2. Inspect the timeline
```sh
camkit clips   --project "$P"     # what's laid down, in order, with src= ids + .trec paths
camkit sources --project "$P"     # which sources are on timeline vs bin only
camkit info    --project "$P"
```
Note each on-timeline `src=N` and its `.trec` path. Two-track screen+camera sources show on both tracks — that's fine, `rebuild` clones every track a source touches, so sync is preserved. Reference the source ONCE in the keep list.

### 3. Transcribe + detect silences for each on-timeline source
Create a scratch dir in the project (survives reboots, scoped to this project):
```sh
RC="$P/.camkit/rc"
mkdir -p "$RC"
```
For every on-timeline source (run these in parallel — they're independent):
```sh
camkit transcribe "<trec>" --out "$RC/srcN.json"       # word-level Whisper (OpenAI whisper-1)
camkit silences   "<trec>" --db -35 --min 0.4          # dead-air ranges from ffmpeg
```
Loop over them in one backgrounded batch and `wait`; ~45 min across 8 sources finishes in a couple of minutes.
- `--db` / `--min` tune sensitivity. Start `-35 dB`, `0.4 s`. Adjust if needed (quieter mic → `-30`; only long pauses → `--min 0.8`).
- The transcript JSON is `{text, words:[{word,start,end}], segments}`. Use word times for content boundaries; use `silences` for pauses.
- **`silences` output format** is `silence  START-ENDs  (DURs)` per line (e.g. `silence  12.30-15.40s  (3.10s)`). Parse the two float timestamps, not raw `silence_start:` lines.

#### The dead-air-inside-a-take trap (the silences you've missed)
Whisper does NOT emit a gap for a pause mid-sentence — it **stretches one word** to span it. A line in the words dump like `233.00-239.74 of` (a 6.7 s "of") is 6 s of silence hiding inside a kept take. Two defences, use both:
1. For every kept range, scan the word list inside it for any single word whose `end-start` is large (> ~1 s). Split the range around it.
2. Cross-check each kept range against the `silences` list; if a silence sits inside it, split it out.

### 4. Read the script (if provided) + find the keeper takes

These recordings are **heavy retake material**: the presenter says each beat many times, restarting, until the last pass is clean. The keeper for a beat is almost always the **final complete clean delivery**; everything before it is false starts to cut.

Reading 3000+ raw words per source into context is wasteful. Two `camkit` subcommands make it tractable:
- **`camkit takes <transcript.json> [gap]`** — segments a source's words into takes by splitting on word-gaps > `gap` (default 1.2 s) and prints `[start-end] (dur Nw) text` per take. Degenerate Whisper padding words are stripped automatically. Collapses the chaos to a readable list; the keeper is usually the last full take of each beat.
- **`camkit words <transcript.json> <start> <end>`** — prints `idx start-end word` for words in `[start,end]`. Use it to set precise cut points inside a take (isolating a clean tail from leading stammers, or splitting out stretched-word dead air).

```sh
camkit takes "$RC/src5.json"                # scan the takes for src 5
camkit words "$RC/src5.json" 120.0 140.0    # drill into a specific range
```

Map script lines to takes, pick the final clean delivery of each, drop retakes. Honor the script's order — `rebuild` lays kept ranges in the order you list them. (When no script: keep the natural take order, still picking the clean final pass of each beat.)

Whisper pads clip ends with degenerate zero-length words at one frozen timestamp (e.g. 20 words all at `223.78`). `camkit takes` already strips these — but when building keep ranges by hand, end the last range before they start.

### 5. Build the keep list
Write the plan as a JSON file for `--from` (cleaner than a long `--keep` string): `{"keep":[{"src":N,"start":S,"end":E}, ...]}` in final playback order. For each kept span:
- **Trim dead air** at the head/tail using the `silences` ranges, not word times.
- **Drop long mid-span pauses** by splitting one span into two around the silence (`N:a-b N:c-d`).
- **Cut filler** ("um", "uh", "so", "you know", false starts, restarts, "let me redo that").
- **Cut losing retakes** entirely.
- Leave ~0.15-0.25 s of breath at cut points so it doesn't sound clipped.
- Cross-check: for every kept range, confirm no `silences` entry and no stretched word sits inside it un-cut. If one does, split it out. This is the step that catches the silences you've missed before.

```sh
camkit rebuild --project "$P" --from "$RC/keep.json" --dry-run
```

### 6. Dry-run, review, apply
```sh
camkit rebuild --project "$P" --from "$RC/keep.json" --dry-run   # read the plan: segment count, total duration
```
Writing needs Camtasia to release the project. The close→rebuild handoff has a lock quirk — handle it:
```sh
camkit close --project "$P"                              # save-and-close in Camtasia
camkit docs                                              # confirm: no open documents
```
Camtasia releases the document but often leaves a **stale `~project.tscproj` lock file** behind, so an immediate `rebuild` fails with "Lock file present". Once `camkit docs` shows nothing open, that lock is stale and `--force` is correct:
```sh
camkit rebuild --project "$P" --from "$RC/keep.json" --force   # backs up to project.tscproj.bak, then writes
camkit open --project "$P"                               # reopen for the user to review
camkit info --project "$P" | grep duration               # sanity-check the new duration
```
Only `--force` past the lock once `camkit docs` confirms the project is closed — never while it's genuinely open in Camtasia. **Never script or automate `--force`** — it must only follow a human-readable `camkit docs` showing no open documents.

## Recutting
`rebuild` backs up to `project.tscproj.bak`. To cut again from the ORIGINAL (not the already-cut file), restore first or you'll cut the cut:
```sh
cp "$P/project.tscproj.bak" "$P/project.tscproj"
```
Then redo from step 5. Transcripts/silences from step 3 are still valid (sources are untouched), so no need to re-transcribe.

## Notes
- `transcribe` needs `ffmpeg` + an engine: `OPENAI_API_KEY` (whisper-1, best) or local `whisper-cpp`. It never mutates source media.
- Long recordings: transcription of ~45 min across several sources takes minutes and costs OpenAI credits. Run sources concurrently.
- Sanity-check the dry-run duration against your expectation (a tight cut of a 45 min take is usually 12–25 min). A surprising number means the keep list is wrong.
