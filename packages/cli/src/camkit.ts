#!/usr/bin/env bun
/**
 * camkit — Camtasia project CLI over @camkit/core + @camkit/darwin.
 * Port of edit-videos/cam.ts with identical command behavior and output.
 *
 *   camkit info|clips|sources|rebuild|silences|transcribe|status|close|open|docs|takes|words
 *
 * --project accepts a .cmproj dir or project.tscproj path; defaults to
 * ./search.cmproj/project.tscproj. Read commands never mutate; rebuild backs
 * up to .bak and refuses to run with a ~project.tscproj lock or an existing
 * backup unless --force.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  applyRebuild,
  createProject,
  addMediaToProject,
  injectDynamicCaptions,
  filterSilences,
  listClips,
  listSources,
  loadProject,
  parseKeep,
  parseKeepJson,
  parseRange,
  parseSilences,
  planAudioExport,
  planRebuild,
  projectInfo,
  bundleName,
  resolveProjectPath,
  secondsToUnits,
  segmentTakes,
  tracks,
  wordsInRange,
  type KeepSeg,
} from "@camkit/core";
import { camtasiaDocPaths, closeProject, openProject, projectStatus } from "@camkit/darwin";
import { exportAudio, probeMedia, runSilencedetect, transcribeRecording } from "./media.ts";
import { listPresets, resolvePreset } from "./presets.ts";
import { version } from "../package.json";

/** Load for read-only commands: --project, else the ./search.cmproj default,
 * else (macOS) whatever single project Camtasia has open right now. */
function loadProjectForRead(argv: string[]) {
  const explicit = flag(argv, "--project");
  try {
    return loadProject(explicit);
  } catch (e: any) {
    if (explicit || process.platform !== "darwin") {
      throw new Error(`${e.message}\n  Pass --project PATH (a .cmproj dir or project.tscproj).`);
    }
    let open: ReturnType<typeof camtasiaDocPaths> = [];
    try {
      open = camtasiaDocPaths();
    } catch {
      throw e;
    }
    if (open.length === 1) {
      process.stderr.write(`(no --project given; using the project open in Camtasia: ${open[0].name})\n`);
      return loadProject(open[0].path);
    }
    if (open.length > 1) {
      throw new Error(
        `No --project given and several projects are open in Camtasia:\n` +
          open.map((d) => `  --project "${d.path}"`).join("\n"),
      );
    }
    throw new Error(`${e.message}\n  Pass --project PATH, or open the project in Camtasia first.`);
  }
}

const HELP: Record<string, { usage: string; about: string[] }> = {
  info: {
    usage: "camkit info [--project PATH]",
    about: ["Project summary: dimensions, fps, editRate, track/source count, duration."],
  },
  clips: {
    usage: "camkit clips [--project PATH] [--json]",
    about: [
      "List timeline clips (track, type, source id, start/end in seconds) and",
      "which recordings are actually on the timeline. Use this to pick what to",
      "transcribe — raw takes in recordings/ aren't necessarily placed yet.",
    ],
  },
  sources: {
    usage: "camkit sources [--project PATH] [--json]",
    about: [
      "Media-bin listing: every imported source with duration and whether it's",
      "placed on the timeline (clips shows the timeline; sources shows the bin",
      "including unplaced takes).",
    ],
  },
  rebuild: {
    usage: 'camkit rebuild [--project PATH] --keep "SRC:start-end ..." | --from FILE [--dry-run] [--force]',
    about: [
      "The core rough-cut op. Rewrites the timeline to keep only the listed",
      "source segments, in order, ripple-laid with no gaps (seconds → editRate",
      "units). Every track a source touches is cloned at the same position, so",
      "two-track screen+camera recordings stay in sync.",
      "",
      '  --keep "1:159.8-179.2 2:46.3-60.0"   keep src-1 159.8–179.2s, then src-2 46.3–60.0s',
      "  --from FILE    JSON [{src,start,end}] or {keep:[...]}",
      "  --dry-run      print the plan, write nothing (ALWAYS do this first)",
      "  --force        override a stale ~project.tscproj lock / overwrite an existing .bak",
      "",
      "Safety: backs up to project.tscproj.bak before writing; refuses to run",
      "if the lock file is present or the backup would be clobbered (no --force).",
      "To RECUT after a rebuild, first restore the backup (cp .bak over the",
      "project) — otherwise you back up the already-cut file.",
    ],
  },
  "export-audio": {
    usage: "camkit export-audio [--project PATH] [--out FILE] [--format m4a|wav|flac|mp3] [--raw]",
    about: [
      "Flat-mix the CURRENT timeline's audio into a single file for cleanup in",
      "Audacity, Auphonic, etc. Reads timeline timing as-is (run after rebuild",
      "to export the edited cut). Each audio clip is sliced from its source and",
      "summed at its timeline position; screen-only tracks are skipped so a",
      "screen+camera take isn't doubled. Never touches source media or Camtasia.",
      "",
      "Honours the timeline's mix by default: muted/soloed tracks and per-clip",
      "gain+volume are applied (clips at gain 0 are dropped). Keyframed volume",
      "fades can't be folded into one number, so they export at unity.",
      "",
      "  --out FILE     output path (default ./<project>.m4a); extension wins",
      "  --format FMT   container/codec when --out is omitted (default m4a)",
      "  --raw          ignore mute/solo/gain — dry unity sum of every clip",
    ],
  },
  captions: {
    usage:
      "camkit captions [--project PATH] --from FILE.transcript.json (--preset NAME | --preset-file PATH) [--list-presets] [--src ID] [--strip-punctuation] [--strip-apostrophes] [--dry-run] [--force]",
    about: [
      "Inject an animated Dynamic Caption track straight into the project, so",
      "captions appear on the timeline with no manual SRT import. Uses camkit's",
      "word-level transcript (better model) for the per-word highlight timing,",
      "and a Camtasia style preset for the look.",
      "",
      "Two writes: the word stream goes on the SOURCE asset's audio track; a",
      "styled Callout (the preset) is added on a new timeline track spanning the",
      "project (drag/trim it in Camtasia afterwards).",
      "",
      "  --from FILE       a *.transcript.json from `camkit transcribe`",
      "  --preset NAME     a preset by display name or id (see --list-presets)",
      "  --preset-file P   use an effect.json directly (bypasses preset lookup)",
      "  --list-presets    list available presets and exit",
      "  --src ID          attach to this source id (default: first with audio)",
      "  --strip-punctuation  drop .,!?;:\" from caption words (keeps contractions)",
      "  --strip-apostrophes  also drop apostrophes (I'm → Im); implies the above",
      "  --dry-run         print what would change, write nothing",
      "  --force           override a stale lock / overwrite an existing .bak",
      "",
      "Presets live in Camtasia's app-support dir, resolved on demand. Classic",
      "(non-animated) captions aren't supported — they can't do the per-word",
      "Shorts look. Same safety as rebuild: backs up to .bak, refuses to run",
      "with the ~project.tscproj lock present (close the project first).",
    ],
  },
  silences: {
    usage: "camkit silences <input.trec> [--range a-b] [--db -35] [--min 0.4]",
    about: [
      "ffmpeg silencedetect on a recording's audio. Run this on every kept",
      "range before finalizing a cut: Whisper folds pauses into stretched word",
      "timestamps, so transcripts alone miss dead air — and apparent gaps in",
      "word times can hide a clean retake.",
    ],
  },
  transcribe: {
    usage:
      "camkit transcribe <input> [--engine openai|whisper-cpp] [--out FILE] [--model whisper-1] [--srt [FILE]] [--keep-audio]",
    about: [
      "Word-level transcription (needs ffmpeg). Engine by precedence: --engine,",
      "then OPENAI_API_KEY (OpenAI whisper-1, best quality), then local",
      "whisper.cpp if `whisper-cli` is on PATH (brew install whisper-cpp). The",
      "local engine reuses Camtasia's tiny model by default — override with",
      "CAMKIT_WHISPER_MODEL / CAMKIT_WHISPER_BIN. OpenAI model must be whisper-1;",
      "the gpt-4o-transcribe models don't return word timestamps. Extracts +",
      "downsamples audio, never touches source media. Writes {source, model,",
      "duration, text, words, segments}; --srt also emits SRT captions for",
      "Camtasia import (File ▸ Import ▸ Captions).",
    ],
  },
  status: {
    usage: "camkit status [--project PATH]",
    about: [
      "Whether THIS project is open in Camtasia (the app staying running with",
      "other projects open is normal). Exit 2 if open — do not edit the JSON",
      "while it is. macOS only.",
    ],
  },
  close: {
    usage: "camkit close [--project PATH]",
    about: [
      "Save-and-close the project's document (never quits the app, never",
      "touches other open projects). Edit cycle for an open project:",
      "close → edit project.tscproj → open. macOS only.",
    ],
  },
  open: {
    usage: "camkit open [--project PATH]",
    about: ["(Re)open the project in Camtasia, e.g. after a rebuild. macOS only."],
  },
  docs: {
    usage: "camkit docs",
    about: ["List all projects currently open in Camtasia with their full", "paths. macOS only."],
  },
  takes: {
    usage: "camkit takes <transcript.json> [gap]",
    about: [
      "Segment a transcript's word list into takes by splitting on inter-word",
      "gaps larger than `gap` seconds (default 1.2). Prints one line per take:",
      '  [start-end] (dur Nw) text',
      "Degenerate Whisper padding words (zero-length stamps at clip ends) are",
      "stripped before boundaries are computed, so durations match audible",
      "speech. Use this to find the clean final take of each beat.",
    ],
  },
  words: {
    usage: "camkit words <transcript.json> <start> <end>",
    about: [
      "Print every word (with its index + timestamps) inside the inclusive",
      "[start, end] window. Use it to set precise cut points inside a take,",
      "isolate a clean tail, or inspect a stretched-word dead-air artifact.",
    ],
  },
};

function printHelp(cmd?: string): void {
  if (cmd && HELP[cmd]) {
    console.log(HELP[cmd].usage);
    console.log();
    for (const l of HELP[cmd].about) console.log(`  ${l}`);
    return;
  }
  console.log(`camkit ${version} — programmatic Camtasia project editing`);
  console.log();
  console.log("Usage: camkit <command> [args]");
  console.log();
  const summaries: Record<string, string> = {
    info: "project summary (size, fps, editRate, tracks, duration)",
    clips: "list timeline clips + recordings on the timeline",
    sources: "list media-bin sources, placed or not",
    rebuild: "rewrite timeline to kept segments (rough cut)",
    "export-audio": "mix the timeline's audio to one file (m4a/wav/…)",
    captions: "inject an animated Dynamic Caption track from a transcript",
    silences: "ffmpeg silencedetect on a recording",
    transcribe: "word-level Whisper transcript of a recording",
    new: "create a new empty .cmproj and open it in Camtasia",
    add: "add a media file to a project timeline (close/write/reopen if open)",
    status: "is this project open in Camtasia? (exit 2 if so)",
    close: "save-and-close the project document in Camtasia",
    open: "(re)open the project in Camtasia",
    docs: "list projects open in Camtasia (with paths)",
    takes: "segment a transcript into takes by word gaps",
    words: "print words in a time range from a transcript",
  };
  for (const [c, s] of Object.entries(summaries)) console.log(`  ${c.padEnd(11)} ${s}`);
  console.log();
  console.log("Common flags:");
  console.log("  --project PATH   a .cmproj dir or project.tscproj path");
  console.log("                   (default ./search.cmproj/project.tscproj; if that's");
  console.log("                   missing, read commands fall back to the project");
  console.log("                   currently open in Camtasia)");
  console.log("  --json           structured output (clips, sources)");
  console.log("  --version, -v    print the camkit version");
  console.log();
  console.log("Run `camkit <command> --help` for details. Read commands never");
  console.log("mutate; rebuild always backs up first. Always rebuild --dry-run first.");
}

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const has = (argv: string[], name: string) => argv.includes(name);

function cmdInfo(argv: string[]) {
  const { path, doc } = loadProjectForRead(argv);
  const info = projectInfo(path, doc);
  console.log(`project:   ${info.path}`);
  console.log(`size:      ${info.width}x${info.height} @ ${info.fps}fps`);
  console.log(`editRate:  ${info.editRate} units/s`);
  console.log(`tracks:    ${info.trackCount}`);
  console.log(`sources:   ${info.sourceCount}`);
  console.log(`duration:  ${info.durationSeconds.toFixed(1)}s`);
}

function cmdClips(argv: string[]) {
  const { doc } = loadProjectForRead(argv);
  const rows = listClips(doc);
  if (has(argv, "--json")) {
    const used = [...new Set(rows.map((r) => r.src).filter((s) => s != null))];
    console.log(JSON.stringify({ clips: rows, usedSrcIds: used }, null, 2));
    return;
  }
  for (const r of rows) {
    console.log(
      `track ${r.track}  ${r.type.padEnd(14)} src=${r.src}  ${String(r.start).padStart(7)}-${String(r.end).padStart(7)}s  ${r.recording ?? ""}`,
    );
  }
  const used = rows.filter((r) => r.src != null);
  const recs = [...new Set(used.map((r) => r.recording))];
  console.log(`\non timeline: ${recs.length} recording(s):`);
  for (const rec of recs) console.log(`  ${rec}`);
}

function cmdSources(argv: string[]) {
  const { doc } = loadProjectForRead(argv);
  const rows = listSources(doc);
  if (has(argv, "--json")) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }
  for (const r of rows) {
    const dur = r.duration != null ? `${r.duration.toFixed(1)}s`.padStart(7) : "      ?";
    console.log(`src=${String(r.id).padEnd(3)} ${dur}  ${r.onTimeline ? "on timeline " : "bin only    "} ${r.src}`);
  }
}

function cmdRebuild(argv: string[]) {
  const force = has(argv, "--force");
  const dryRun = has(argv, "--dry-run");
  const { path, doc } = loadProject(flag(argv, "--project"));

  let segs: KeepSeg[];
  const fromFile = flag(argv, "--from");
  if (fromFile) {
    segs = parseKeepJson(JSON.parse(readFileSync(resolve(fromFile), "utf8")));
  } else {
    const keep = flag(argv, "--keep");
    if (!keep) throw new Error('rebuild needs --keep "src:start-end ..." or --from FILE');
    segs = parseKeep(keep);
  }

  const plan = planRebuild(doc, segs);
  console.log(`rebuild plan (${plan.segmentCount} segments, ${plan.totalSeconds.toFixed(1)}s total):`);
  for (const e of plan.entries) {
    console.log(
      `  src ${e.src}  ${e.sourceStart.toFixed(2)}-${e.sourceEnd.toFixed(2)}s  →  timeline ${e.timelineStart.toFixed(2)}-${e.timelineEnd.toFixed(2)}s  (${e.trackCount} track[s])`,
    );
  }
  if (dryRun) {
    console.log("\n--dry-run: no files written.");
    return;
  }

  // Safety: never edit while Camtasia holds the project; never clobber the only backup.
  const lock = join(dirname(path), "~project.tscproj");
  if (existsSync(lock) && !force) {
    throw new Error(`Lock file ${lock} present (Camtasia may be open). Close it, or pass --force if stale.`);
  }
  const bak = path + ".bak";
  if (existsSync(bak) && !force) {
    throw new Error(`Backup ${bak} already exists; refusing to clobber it. Pass --force to overwrite.`);
  }
  copyFileSync(path, bak);

  applyRebuild(doc, plan);
  writeFileSync(path, JSON.stringify(doc, null, 2));
  console.log(`\n✓ backed up → ${bak}`);
  console.log(`✓ wrote ${path}`);
}

async function cmdExportAudio(argv: string[]) {
  const { path, doc } = loadProjectForRead(argv);
  const segs = planAudioExport(doc, { raw: has(argv, "--raw") });
  const fmt = (flag(argv, "--format") ?? "m4a").replace(/^\./, "");
  const base = bundleName(path).replace(/\.(cmproj|tscproj)$/, "");
  const out = flag(argv, "--out") ? resolve(flag(argv, "--out")!) : resolve(`${base}.${fmt}`);
  const durationSeconds = projectInfo(path, doc).durationSeconds;
  await exportAudio({ segs, projectPath: path, out, durationSeconds });
}

function cmdCaptions(argv: string[]) {
  if (has(argv, "--list-presets")) {
    const presets = listPresets();
    if (!presets.length) {
      console.log("No dynamic-caption presets found. Open Camtasia once to populate them.");
      return;
    }
    for (const p of presets) console.log(`  ${p.dir.padEnd(38)} ${p.name}`);
    return;
  }

  const force = has(argv, "--force");
  const dryRun = has(argv, "--dry-run");
  const { path, doc } = loadProject(flag(argv, "--project"));

  const fromFile = flag(argv, "--from");
  if (!fromFile) throw new Error("captions needs --from FILE.transcript.json");
  const transcript = JSON.parse(readFileSync(resolve(fromFile), "utf8"));
  if (!Array.isArray(transcript.words)) {
    throw new Error(`${fromFile} has no word-level "words" array (transcribe with whisper-1).`);
  }

  const presetFile = flag(argv, "--preset-file");
  const presetName = flag(argv, "--preset");
  if (!presetFile && !presetName) {
    throw new Error("captions needs --preset NAME or --preset-file PATH (see --list-presets).");
  }
  const presetDef = presetFile
    ? JSON.parse(readFileSync(resolve(presetFile), "utf8"))
    : resolvePreset(presetName!).def;
  const presetLabel = presetFile ?? presetName;

  const srcId = flag(argv, "--src") != null ? Number(flag(argv, "--src")) : undefined;
  const stripApostrophes = has(argv, "--strip-apostrophes");
  const clean = { stripPunctuation: has(argv, "--strip-punctuation") || stripApostrophes, stripApostrophes };

  if (dryRun) {
    const words = transcript.words.filter((w: any) => (w.word ?? "").trim().length > 0).length;
    console.log(`captions plan:`);
    console.log(`  source:   ${srcId != null ? `src ${srcId}` : "first source with audio"}`);
    console.log(`  preset:   ${presetLabel}`);
    console.log(`  words:    ${words}`);
    if (clean.stripPunctuation) {
      console.log(`  clean:    strip punctuation${clean.stripApostrophes ? " (incl. apostrophes)" : " (keep contractions)"}`);
    }
    console.log(`  adds:     1 timeline track with a Dynamic Caption Callout`);
    console.log("\n--dry-run: no files written.");
    return;
  }

  // Same safety as rebuild: never edit under Camtasia's lock; never clobber the backup.
  const lock = join(dirname(path), "~project.tscproj");
  if (existsSync(lock) && !force) {
    throw new Error(`Lock file ${lock} present (Camtasia may be open). Close it, or pass --force if stale.`);
  }
  const bak = path + ".bak";
  if (existsSync(bak) && !force) {
    throw new Error(`Backup ${bak} already exists; refusing to clobber it. Pass --force to overwrite.`);
  }
  copyFileSync(path, bak);

  const result = injectDynamicCaptions(doc, { transcript, presetDef, srcId, clean });
  writeFileSync(path, JSON.stringify(doc, null, 2));
  console.log(`captions: ${result.wordCount} words on src ${result.srcId}, preset "${presetLabel}"`);
  console.log(`✓ backed up → ${bak}`);
  console.log(`✓ wrote ${path}  (new track ${result.trackIndex}, callout id ${result.calloutId})`);
  console.log(`  reopen in Camtasia to see the caption track.`);
}

async function cmdSilences(argv: string[]) {
  const flagVals = new Set([flag(argv, "--range"), flag(argv, "--db"), flag(argv, "--min")]);
  const input = argv.find((a) => !a.startsWith("--") && !flagVals.has(a));
  if (!input) throw new Error("silences needs an input recording path");
  const db = flag(argv, "--db") ?? "-35";
  const min = flag(argv, "--min") ?? "0.4";
  let lo = 0,
    hi = Infinity;
  const range = flag(argv, "--range");
  if (range) [lo, hi] = parseRange(range);

  const stderr = await runSilencedetect(resolve(input), db, min);
  for (const sil of filterSilences(parseSilences(stderr), lo, hi)) {
    console.log(`silence  ${sil.start.toFixed(2)}-${sil.end.toFixed(2)}s  (${(sil.end - sil.start).toFixed(2)}s)`);
  }
}

async function cmdTranscribe(argv: string[]) {
  const valued = ["--out", "--model", "--engine", "--srt"];
  const positional = argv.filter((a, i) => !a.startsWith("--") && !valued.includes(argv[i - 1]));
  if (positional.length !== 1) {
    throw new Error(
      "Usage: camkit transcribe <input> [--engine openai|whisper-cpp] [--out file.json] " +
        "[--model whisper-1] [--srt [file.srt]] [--keep-audio]",
    );
  }
  // --srt is optional-valued: bare flag derives the path, or takes an explicit one.
  const srtIdx = argv.indexOf("--srt");
  const srtNext = srtIdx >= 0 ? argv[srtIdx + 1] : undefined;
  const srt = srtIdx < 0 ? undefined : srtNext && !srtNext.startsWith("--") ? srtNext : true;
  await transcribeRecording({
    input: resolve(positional[0]),
    out: flag(argv, "--out"),
    model: flag(argv, "--model") ?? "whisper-1",
    engine: flag(argv, "--engine"),
    srt,
    keepAudio: has(argv, "--keep-audio"),
  });
}

function cmdStatus(argv: string[]) {
  const path = resolveProjectPath(flag(argv, "--project"));
  const st = projectStatus(path);
  console.log(`camtasia running:  ${st.openDocs.length > 0 ? "yes" : "yes/no docs or not running"}`);
  console.log(`open documents:    ${st.openDocs.join(", ") || "(none)"}`);
  console.log(`${st.bundle} open:  ${st.open ? "YES — do not edit project.tscproj" : "no — safe to edit"}`);
  process.exitCode = st.open ? 2 : 0;
}

function cmdClose(argv: string[]) {
  const path = resolveProjectPath(flag(argv, "--project"));
  const result = closeProject(path);
  const name = bundleName(path);
  if (result === "not-open") {
    console.log(`${name} is not open in Camtasia; nothing to close.`);
    return;
  }
  console.log(`✓ saved and closed ${name}`);
}

function cmdOpen(argv: string[]) {
  const path = resolveProjectPath(flag(argv, "--project"));
  openProject(path);
  console.log(`✓ opened ${bundleName(path)}`);
}

function cmdNew(argv: string[]) {
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (positional.length < 1) {
    throw new Error("Usage: camkit new <path.cmproj> [--width N] [--height N] [--no-open]");
  }
  let bundle = resolve(positional[0]);
  if (!bundle.endsWith(".cmproj")) bundle += ".cmproj";

  const w = flag(argv, "--width");
  const h = flag(argv, "--height");
  const width = w != null ? Number(w) : undefined;
  const height = h != null ? Number(h) : undefined;
  if ((w != null && Number.isNaN(width)) || (h != null && Number.isNaN(height))) {
    throw new Error("--width / --height must be numbers (px).");
  }

  createProject(bundle, { width, height });
  console.log(`✓ created ${bundleName(bundle)}`);

  if (!argv.includes("--no-open") && process.platform === "darwin") {
    openProject(join(bundle, "project.tscproj"));
    console.log(`✓ opened in Camtasia`);
  }
}

function cmdAdd(argv: string[]) {
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (positional.length < 1) {
    throw new Error("Usage: camkit add <media> [--project P] [--at S] [--track N]");
  }
  const media = resolve(positional[0]);
  if (!existsSync(media)) throw new Error(`No such file: ${media}`);

  const tscproj = resolveProjectPath(flag(argv, "--project"));
  const bundle = dirname(tscproj);

  const at = flag(argv, "--at") != null ? Number(flag(argv, "--at")) : 0;
  const track = flag(argv, "--track") != null ? Number(flag(argv, "--track")) : 0;
  if (Number.isNaN(at) || Number.isNaN(track)) throw new Error("--at / --track must be numbers.");

  // Camtasia never re-reads project.tscproj while the doc is open and
  // overwrites it on save, so close (saving any GUI edits) before writing,
  // then reopen so the user sees the new clip.
  const wasOpen = process.platform === "darwin" && projectStatus(tscproj).open;
  if (wasOpen) closeProject(tscproj);

  const probe = probeMedia(media);

  // Camtasia copies imported media into the bundle under media/<epoch.micros>/.
  const stamp = (Date.now() / 1000).toFixed(6);
  const destDir = join(bundle, "media", stamp);
  mkdirSync(destDir, { recursive: true });
  const name = basename(media);
  copyFileSync(media, join(destDir, name));

  const doc = JSON.parse(readFileSync(tscproj, "utf8"));
  addMediaToProject(doc, { relPath: `./media/${stamp}/${name}`, name, ...probe }, { at, track });
  copyFileSync(tscproj, `${tscproj}.bak`);
  writeFileSync(tscproj, JSON.stringify(doc, null, 1));
  console.log(`✓ added ${name} at ${at}s on track ${track}`);

  if (wasOpen) {
    openProject(tscproj);
    console.log("✓ reopened in Camtasia");
  }
}

function cmdDocs() {
  const docs = camtasiaDocPaths();
  if (!docs.length) {
    console.log("Camtasia is not running, or has no projects open.");
    return;
  }
  for (const d of docs) console.log(`${d.name}\t${d.path}`);
}

function cmdTakes(argv: string[]) {
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (positional.length < 1) throw new Error("Usage: camkit takes <transcript.json> [gap]");
  const file = resolve(positional[0]);
  if (!existsSync(file)) throw new Error(`No such file: ${file}`);
  const gap = positional[1] != null ? Number(positional[1]) : 1.2;
  if (Number.isNaN(gap)) throw new Error("gap must be a number of seconds");

  const transcript = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(transcript.words)) {
    throw new Error(`${file} has no word-level "words" array (transcribe with whisper-1).`);
  }
  const takes = segmentTakes(transcript.words, gap);
  for (const t of takes) {
    console.log(`[${t.start.toFixed(2).padStart(7)}-${t.end.toFixed(2).padStart(7)}] (${(t.end - t.start).toFixed(1).padStart(5)}s ${String(t.words.length).padStart(3)}w) ${t.text}`);
  }
}

function cmdWords(argv: string[]) {
  const positional = argv.filter((a) => !a.startsWith("--"));
  if (positional.length < 3) {
    throw new Error("Usage: camkit words <transcript.json> <start> <end>");
  }
  const file = resolve(positional[0]);
  if (!existsSync(file)) throw new Error(`No such file: ${file}`);
  const start = Number(positional[1]);
  const end = Number(positional[2]);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error("start and end must be numbers (seconds).");
  }

  const transcript = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(transcript.words)) {
    throw new Error(`${file} has no word-level "words" array (transcribe with whisper-1).`);
  }
  for (const w of wordsInRange(transcript.words, start, end)) {
    console.log(`${String(w.idx).padStart(4)} ${w.start.toFixed(2).padStart(7)}-${w.end.toFixed(2).padStart(7)}  ${w.word}`);
  }
}

const COMMANDS: Record<string, (argv: string[]) => void | Promise<void>> = {
  info: cmdInfo,
  clips: cmdClips,
  sources: cmdSources,
  rebuild: cmdRebuild,
  "export-audio": cmdExportAudio,
  captions: cmdCaptions,
  silences: cmdSilences,
  transcribe: cmdTranscribe,
  status: cmdStatus,
  new: cmdNew,
  add: cmdAdd,
  close: cmdClose,
  open: cmdOpen,
  docs: cmdDocs,
  takes: cmdTakes,
  words: cmdWords,
};

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === "--version" || cmd === "-v" || cmd === "version") {
  console.log(`camkit ${version}`);
  process.exit(0);
}
if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
  printHelp(rest[0]);
  process.exit(0);
}
if (!COMMANDS[cmd]) {
  console.error(`Unknown command "${cmd}". Run camkit --help.`);
  process.exit(1);
}
if (rest.includes("--help") || rest.includes("-h")) {
  printHelp(cmd);
  process.exit(0);
}
try {
  await COMMANDS[cmd](rest);
} catch (e: any) {
  process.stderr.write(`✗ ${e.message}\n`);
  process.exit(1);
}
