# Handoff: live timeline editing (cut / split / trim) for camkit

Scratch handoff doc. Delete before merging. A companion memory file is auto-loaded each session: `camtasia-applescript-live-edit.md` - read it, it has the raw probe results.

## Re-probe results 2026-06-30 (build 2026.1.3) - READ FIRST

Re-probed the AppleScript suite live this session. The project-scoped suite is **more broken than the handoff implies**:

| Op | Result |
|----|--------|
| `make new document` | ✅ creates "Untitled" with an id |
| open / close / name / docs / paths (existing code) | ✅ |
| `playheadTime of document N` (read) | ✅ |
| `playheadTime of document N` (set) | ❌ silently ignored - set 3.5, reads back 0.0, no error |
| `add <doc> file ... at time` (addMedia:) | ❌ -1708 on `document`, -10000 on `project` |
| `save`, `sources of`, any project element access | ❌ -10000 |
| `project N` reference | ❌ broken - every op -10000; the real object is `document N` (its `class` reports `document` but it answers project props like playheadTime) |

**Consequences:**
- The hidden suite **cannot add media, cannot save, cannot set the playhead.** Confirms (and extends) the "suite can't address clips" finding. ALL live mutation must go through Accessibility / System Events menu driving (T2) - including moving the playhead (use keyboard/menu, NOT the `playheadTime` setter).
- `add` has no live AppleScript path. Two options for T1, undecided - see below.
- The "uncommitted new/add verified last session" work is gone AND could not have used AppleScript `add` (it's dead here); it was likely Accessibility-drag or JSON-generation. Treat T1 as greenfield.

### T1 `new` - schema-from-scratch is OUT (crashed Camtasia)

Tried hand-building a minimal empty `project.tscproj` (real top-level fields, empty `sourceBin`, empty `csml.tracks`). Opening it **crashed Camtasia** (app quit; `open` then returns -609 "Connection is invalid"). The skeleton is missing required structure - generating tscproj from a guessed schema is too fragile to pursue.

**Robust approach instead: check in a real empty `.cmproj` template.**
1. User does File > New in Camtasia, saves an empty project once.
2. Commit that `project.tscproj` as `packages/core/templates/empty.tscproj`.
3. `camkit new <path>` = copy template into a new `.cmproj` bundle, patch `width`/`height`/`editRate`/`title`, then `open`. No schema guessing.
4. `camkit add` (below, Option B) appends a real sourceBin entry + timeline media to that file before/after open.

This makes `new`/`add` deterministic and the JSON the source of truth Camtasia itself produced.

### T1 STATUS (session 2026-06-30 end)

- **`camkit new` DONE + verified.** Copies embedded `empty-project.json`, patches dims, opens. Commit `b5d65a7`. Camtasia opens it cleanly.
- **`camkit add` IMPLEMENTED but BROKEN - crashes Camtasia on open.** Pure builder `addMediaToProject` (packages/core/src/addMedia.ts) + CLI `cmdAdd` (ffprobe via `probeMedia`, copies media into `media/<epoch.micros>/`, close/write/reopen). Unit tests pass (pure JSON shape), but the live schema is wrong: opening a generated project gives -609 / app quits.

**Why it likely crashes / NEXT STEPS (do this first next session):**
1. **Ground-truth capture.** Camtasia is the source of truth - reverse-engineering from edited projects (map.cmproj) is what produced the broken schema. Drive: `make new document` → menu **File > Import** (submenu found; needs exploring) → pick an mp4 via the open dialog (`Cmd+Shift+G` to type path) → drag bin clip to timeline OR just import + save → read the resulting `project.tscproj`. Diff its sourceBin + timeline media against what `cmdAdd` writes.
2. **Known schema gap:** an mp4 *with audio* is NOT one VMFile. Camtasia splits it into a **VMFile (video)** and a separate **AMFile (audio)** media (AMFile has a `channelNumber` field), often on different tracks. My builder emits a single VMFile referencing a source with both sourceTracks - probably the crash. Replicate the VMFile+AMFile split.
3. Other suspect fields to verify against ground truth: `loudnessNormalization` (I set false; real=true), source `metadata.timeAdded` micros, clip `metadata` (real has audiateLinkedSession/clipSpeedAttribute/colorAttribute), and whether tracks need matching `trackAttributes`.
4. Re-verify E2E: generated project must OPEN in Camtasia without crashing AND show the clip on the timeline. Do not mark add done until both hold.

Code is committed as WIP (clearly marked) so it is not lost - fix the schema, don't rewrite from scratch.

### T1 `add` - decision (decided: Option B, JSON-generate + open)
- **Option A (true live):** Accessibility import + drag media to timeline. Fragile (drag coords), matches the live-edit spirit.
- **Option B (robust, recommended):** generate/extend the `project.tscproj` JSON on disk, then `open`. For project *creation* nothing is open yet, so the live constraint does not apply. Reuses the JSON engine, headless-testable. Core currently only *rewrites* an existing doc (clones a template media) - it has no from-scratch project builder, so Option B needs either a checked-in empty `.cmproj` template or a minimal-tscproj writer.

## Goal

Add **live** timeline-editing subcommands to camkit that edit a project **open in Camtasia**, with no close/edit-JSON/reopen cycle. The headline op is **ripple cut** (`camkit cut --from S --to S`). `split` and `trim` fall out of the same primitive.

This was proven possible by empirical probing of Camtasia Mac 2026.1.3 (see "Verified recipe" below). It is **macOS-only** and **fragile across TechSmith updates** - that tradeoff is accepted.

## Branch & current state

- Branch: `live-timeline-editing`, based on `main` (a999db4).
- **Uncommitted** in the working tree: `camkit new` + `camkit add` (the live create + add-clip commands), built and verified last session, plus README edits. Files: `packages/darwin/src/index.ts`, `packages/cli/src/camkit.ts`, `README.md`.
  - **First decision for the new session:** commit this `new`/`add` work as its own commit before starting `cut`/`split`/`trim`, so history is clean. (No co-author line in commit messages - see CLAUDE.md.)
- Tests pass (56), typecheck clean, as of the build.

## Architecture decision (already settled with the user - do not relitigate)

Two editing engines, **both kept**, complementary:
- **JSON rewrite** (`rebuild`, `captions`): doc must be **closed**. Bulk, precise (editRate units, per-(src,track) template dedup), cross-platform, headless, tested, reproducible (`.bak`, `--dry-run`). The workhorse for the rough-cut pipeline.
- **Live (Accessibility)**: doc must be **open**. A few interactive in-session edits. Fragile, macOS-only, slow/sequential, limited to what menus expose.

The engine is implied by doc state, so **no `--live` flag and no `live` namespace** - flat verbs, grouped in help text. JSON commands already refuse to run while the doc is open (lock/status guard); that's the natural collision guard.

## The command set to build

Live group (operate on the open project; macOS):
- `new <path.cmproj>` - DONE (uncommitted)
- `add <media...> [--at S]` - DONE (uncommitted)
- `split --at S` - split all tracks at a time
- `cut --from S --to S` - **ripple cut**: remove the range, close the gap. Defaults to ripple. Add `--lift` to leave a gap (plain delete) instead.
- `trim [--start S] [--end S]` - trim the clip at the playhead to a time (uses Trim Start/End to Playhead)

JSON group unchanged: `rebuild`, `captions`. Read/analysis unchanged: `info`, `clips`, `sources`, `export-audio`, `silences`, `transcribe`, `status`, `open`, `close`, `docs`.

Settled decisions: `cut` defaults to ripple; `rebuild` stays JSON-only/keep-list-based (don't merge with `cut`); build `cut` first, `split`/`trim` reuse its primitive.

## Verified recipe (the core primitive)

The hidden AppleScript suite CANNOT address existing clips - `media of track`, all clip getters/setters, `split`/`trim`/`move` verbs, `export` all throw AppleEvent **-10000**. So we drive the **menu commands via Accessibility (System Events)** instead. Verified end-to-end on 2026.1.3: split at 30s then ripple-cut 30-60s on a 133s clip → `0-30` + `30-103.47` (exact ripple).

The loop, in order (ALL steps matter):

1. **Raise the editor window first.** Camtasia often shows a "Welcome" window on top; while it is frontmost EVERY timeline menu item (even Select All) is **disabled**. This is the #1 gotcha.
   ```applescript
   tell application "System Events" to tell process "Camtasia"
     perform action "AXRaise" of (first window whose name contains "<projname>")
     set frontmost to true
   end tell
   ```
2. **Move the playhead** via the Camtasia app (NOT System Events). `playheadTime` is writable, in **editRate units** (seconds × 705600000). Small values (<1 frame) round to 0.
   ```applescript
   tell application "Camtasia" to set playheadTime of front document to <units>
   ```
3. **Click menu items** via System Events. Menu path pattern:
   - Split all tracks at playhead: `click menu item "Split All" of menu 1 of menu bar item "Edit" of menu bar 1`
   - Select the clip at playhead: `click menu item "First or Next Media at Playhead" of menu 1 of menu item "Select" of menu 1 of menu bar item "Edit" of menu bar 1`
   - Remove + close gap: `click menu item "Ripple Delete" of menu 1 of menu bar item "Edit" of menu bar 1`
   - Other relevant Edit items: `Cut`, `Ripple Cut`, `Delete`, `Split`, `Stitch Selected Media`; submenu `Trim Start to Playhead` / `Trim End to Playhead` / `Extend Frame to Playhead`; `Select` submenu also has `All Media at Playhead`, `To Beginning/End Of Media`, `All Timeline to Left/Right`.
4. Put `delay 0.3-0.4` between steps (UI needs to settle). `save front document` to persist; the doc stays open.

### Ripple-cut implementation sketch (cut --from F --to T)
```
raise editor window
set playheadTime to T (units)   ; Split All        -> boundary at T
set playheadTime to F (units)   ; Split All        -> boundary at F  (segment F..T now isolated)
set playheadTime to midpoint(F,T) (units)
Select > First or Next Media at Playhead            -> selects the F..T segment
Edit > Ripple Delete (or Delete if --lift)          -> removes it, ripples left
save front document
```
Verify by re-reading the saved `project.tscproj` (loadProject) and checking clip boundaries - same verification style as the `add` command.

### Multi-cut safety (when you extend to a keep-list / multiple ranges)
Ripple shifts all later timecodes left, so **apply cuts back-to-front** (largest start first) so earlier cut points stay valid. A single `cut --from --to` doesn't need this; a future `rebuild --live` would.

## Gotchas / quirks (all empirically confirmed, 2026.1.3)

- Welcome window steals focus → commands disabled. Always raise the editor window.
- `playheadTime` is editRate UNITS, not seconds. Use `secondsToUnits` from `@camkit/core`.
- AppleScript boolean coercion: `... & someBool` throws; use `(b as text)`. (Cost me two failed runs.)
- Bare shell `delay` is not a command - delays must be INSIDE the osascript.
- Needs **Accessibility permission** for whatever process runs `osascript` (System Events controlling Camtasia). The command should detect the -25211/permission error and print a clear "grant Accessibility to <Terminal/app>" message.
- Menu-item names and window-focus behavior are version-specific. Consider reading the menu (System Events) to assert the items exist before clicking, and failing with a helpful message if Camtasia changed them.
- `add` has a separate quirk: Camtasia silently drops the FIRST `add` to a freshly loaded doc - the existing `addMediaLive`/`camkit add` already self-corrects by re-reading saved JSON; mirror that verify-and-report style.

## Code locations & conventions

- AppleScript primitives live in `packages/darwin/src/index.ts` (`@camkit/darwin`). It already has `osascript()` helper, `assertDarwin()`, `asLiteral()` (escape for AppleScript string literals), and `newDocument`/`addMediaLive`/`LiveAddItem` from last session. Add `liveSplit`, `liveRippleCut` ({fromSeconds,toSeconds,lift?}), `liveTrim` here. Throw on non-darwin.
- CLI wiring in `packages/cli/src/camkit.ts`: add a `HELP[...]` entry, a one-line summary in `printHelp`'s `summaries`, a `cmdX` function, and register in the `COMMANDS` map. Helpers already added: `positionals(argv, valueFlags)`, `mediaCount(doc)`. `flag(argv, name)` / `has(argv, name)` exist. `loadProject(flag(argv,"--project"))` resolves the project (and `dirname(path)` is the `.cmproj` bundle to open).
- Time math: `secondsToUnits(seconds, editRate)` from `@camkit/core`; editRate from `loadProject(...).doc.editRate` (705600000 default). `tracks(doc)` returns the track array.
- Style (CLAUDE.md): each full sentence on its own line in long Markdown; no em dashes; never auto-add agent as commit co-author; never edit CHANGELOG.md (auto-generated). Bug fixes: reproduce E2E first.

## How to test (E2E, the way an end user hits it)

There are no .cmproj fixtures in the repo. Build a scratch project with the already-working commands, then drive the new command, then assert on the saved JSON via `camkit clips`:
```
PROJ=/tmp/cut.cmproj   # use the session scratchpad dir, not /tmp, per harness
bun packages/cli/src/camkit.ts new "$PROJ"
bun packages/cli/src/camkit.ts add /Users/robray/camkit/crawl.m4a --at 0   # ~133s audio clip, handy test media
bun packages/cli/src/camkit.ts cut --from 30 --to 60 --project "$PROJ"
bun packages/cli/src/camkit.ts clips --project "$PROJ"   # expect 0-30 then 30-~103
```
Camtasia must be running and licensed; the user is on macOS with it installed. Pure helpers (e.g. midpoint math, back-to-front ordering) should get unit tests in `packages/core/test` to match the existing 56-test suite. The darwin AppleScript glue is untested by convention (platform-bound).

## Task breakdown

The live-edit work is split into independently shippable tasks, ordered so each step is verifiable before the next.
T0-T2 need no Camtasia; T3-T5 each need Camtasia open + a manual eyeball, so they are natural one-session-each units.

Note: the `new`/`add` work the branch state above calls "uncommitted" was lost - it is NOT in the tree.
T1 rebuilds it.

- **T0 - Branch hygiene + 6ms skill pad.**
  Move the SKILL.md 6ms-pad edit onto `live-timeline-editing`, commit. Optionally commit this handoff as the design doc. No Camtasia needed.
- **T1 - Rebuild `new`/`add` live commands.**
  `liveNewDocument` + `liveAddMedia` in `packages/darwin/src/index.ts`, `camkit new`/`add` in CLI. Needed for every cut E2E scratch project. Verify via `new` then `clips`.
- **T2 - Accessibility plumbing.**
  `raiseEditorWindow`, permission-error detection (-25211 → clear "grant Accessibility" message), menu-item-exists assertion helper. The fragile, version-specific core - isolate and harden alone.
- **T3 - `split --at S`.**
  Playhead + "Split All" menu. Proves the move-playhead→click-menu→save→re-read-JSON loop. `cut` reuses this primitive.
- **T4 - `cut --from --to` (ripple).**
  Headline op: split@T + split@F + select-at-midpoint + Ripple Delete; `--lift` for plain delete. Builds on T3. E2E per the test recipe above.
- **T5 - `trim --start/--end`.**
  Trim Start/End to Playhead. Reuses T2/T3 plumbing.
- **T6 - Polish.**
  README live group section, pure-logic unit tests (midpoint, back-to-front ordering) in `packages/core/test`, then delete this handoff file.
