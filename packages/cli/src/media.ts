/**
 * ffmpeg/Whisper runners for the CLI. Port of transcribe.ts: extract audio
 * from a recording (.trec is a QuickTime container — audio and h264 are
 * readable, the tscc2 video stream is not), downsample to a small mono mp3,
 * send to the OpenAI transcription API (whisper-1 — the only model returning
 * word-level timestamps), write the stable transcript JSON contract.
 * Never touches source media; Camtasia stays the final renderer.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { shapeTranscript, toSrt, type AudioSeg } from "@camkit/core";

const API_URL = "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_BIN = process.env.CAMKIT_WHISPER_BIN ?? "whisper-cli";
// The ggml model Camtasia downloads for its built-in captions; reused as the
// default local model. Tiny/quantized — fast, lower fidelity. Override with
// CAMKIT_WHISPER_MODEL to point at a larger ggml-*.bin.
const CAMTASIA_MODEL =
  "/Applications/Camtasia.app/Contents/Resources/models/speechToText/ggml-tiny-q5_1.bin";
// OpenAI hard-rejects uploads over 25 MB. Mono 16 kHz mp3 @ 64 kbps is ~8 KB/s,
// so even a 30-minute take lands around 14 MB — comfortably under the limit.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", rej);
    p.on("close", (code) =>
      code === 0 ? res() : rej(new Error(`${cmd} exited ${code}:\n${err.trim().split("\n").slice(-5).join("\n")}`)),
    );
  });
}

/** Run ffmpeg silencedetect on a recording's first audio stream; resolve with stderr. */
export function runSilencedetect(input: string, db: string, min: string): Promise<string> {
  return new Promise((res, rej) => {
    const child = spawn("ffmpeg", [
      "-i", input, "-map", "0:a:0",
      "-af", `silencedetect=noise=${db}dB:d=${min}`,
      "-f", "null", "-",
    ]);
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", rej);
    child.on("close", (code) => (code === 0 ? res(err) : rej(new Error(err))));
  });
}

/** Probe a media file's dimensions, duration, fps, and audio via ffprobe. */
export function probeMedia(file: string): {
  durationS: number;
  video?: { width: number; height: number; fps: number };
  audio?: { channels: number; sampleRate: number };
} {
  const r = spawnSync(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed for ${file}: ${r.stderr?.trim() ?? ""}`);
  const data = JSON.parse(r.stdout);
  const streams: any[] = data.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  if (!v && !a) throw new Error(`${file} has neither a video nor an audio stream.`);

  const durationS = Number(data.format?.duration ?? v?.duration ?? a?.duration ?? 0);
  if (!durationS) throw new Error(`Could not read duration of ${file}.`);

  let video: { width: number; height: number; fps: number } | undefined;
  if (v) {
    const [num, den] = String(v.r_frame_rate ?? "30/1").split("/").map(Number);
    const fps = den ? num / den : num;
    video = { width: Number(v.width), height: Number(v.height), fps: Math.round(fps) };
  }

  return {
    durationS,
    video,
    audio: a ? { channels: Number(a.channels), sampleRate: Number(a.sample_rate) } : undefined,
  };
}

/**
 * Extract + downsample mono 16 kHz audio. mp3 (64 kbps) for the OpenAI upload;
 * wav (16-bit PCM) for whisper.cpp, which decodes WAV only. Never touches the
 * source (-vn drops the undecodable tscc2 video stream).
 */
async function toAudio(input: string, format: "mp3" | "wav"): Promise<string> {
  const audioPath = join(tmpdir(), `cam-transcribe-${basename(input, extname(input))}.${format}`);
  const codec = format === "mp3" ? ["-b:a", "64k"] : ["-acodec", "pcm_s16le"];
  await run("ffmpeg", ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", ...codec, audioPath]);
  if (format === "mp3") {
    const { size } = await stat(audioPath);
    if (size > MAX_UPLOAD_BYTES) {
      throw new Error(
        `Downsampled audio is ${(size / 1024 / 1024).toFixed(1)} MB, over the 25 MB API limit. ` +
          `Split the recording or lower the bitrate.`,
      );
    }
  }
  return audioPath;
}

async function callWhisper(audioPath: string, model: string): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const buf = await readFile(audioPath);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "audio/mpeg" }), basename(audioPath));
  form.append("model", model);
  form.append("response_format", "verbose_json");
  // Word-level timestamps are the whole point — segment-level is the default.
  form.append("timestamp_granularities[]", "word");
  form.append("timestamp_granularities[]", "segment");

  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!resp.ok) {
    throw new Error(`OpenAI API ${resp.status}: ${(await resp.text()).slice(0, 500)}`);
  }
  return resp.json();
}

/**
 * Transcribe locally with whisper.cpp's `whisper-cli`, shaping its full-JSON
 * output into the same verbose_json contract as the OpenAI path. Word times
 * come from the per-token offsets (`--output-json-full`); tokens beginning a
 * new word start with a leading space, so they bound each word. Offsets are in
 * milliseconds.
 */
async function callWhisperCpp(audioPath: string, modelPath: string): Promise<any> {
  const outBase = audioPath.replace(/\.wav$/, "");
  // -oj writes <outBase>.json with token offsets; -np keeps stdout quiet.
  await run(WHISPER_BIN, ["-m", modelPath, "-f", audioPath, "-oj", "-of", outBase, "-np"]);
  const jsonPath = `${outBase}.json`;
  const data = JSON.parse(await readFile(jsonPath, "utf8"));
  await unlink(jsonPath).catch(() => {});
  return shapeWhisperCpp(data);
}

/**
 * Shape whisper.cpp's `--output-json-full` payload into the same verbose_json
 * contract as the OpenAI path. Word times come from the per-token offsets;
 * tokens beginning a new word carry a leading space, so they bound each word.
 * Offsets are in milliseconds. Pure — the I/O lives in `callWhisperCpp`.
 */
export function shapeWhisperCpp(data: any): any {
  const segments: any[] = [];
  const words: any[] = [];
  let id = 0;
  for (const seg of data.transcription ?? []) {
    segments.push({
      id: id++,
      start: (seg.offsets?.from ?? 0) / 1000,
      end: (seg.offsets?.to ?? 0) / 1000,
      text: seg.text ?? "",
    });
    let cur: { word: string; start: number; end: number } | null = null;
    for (const tok of seg.tokens ?? []) {
      const text: string = tok.text ?? "";
      if (text.startsWith("[") || text.startsWith("<")) continue; // skip [_BEG_], <|...|>
      const from = (tok.offsets?.from ?? 0) / 1000;
      const to = (tok.offsets?.to ?? 0) / 1000;
      if (text.startsWith(" ") || cur === null) {
        if (cur) words.push(cur);
        cur = { word: text, start: from, end: to };
      } else {
        cur.word += text;
        cur.end = to;
      }
    }
    if (cur) words.push(cur);
  }
  const lastEnd = segments.length ? segments[segments.length - 1].end : null;
  const text = segments.map((s) => s.text).join("").trim();
  return { duration: lastEnd, text, words, segments };
}

export type Engine = "openai" | "whisper-cpp";

/**
 * Resolve the transcription engine by precedence: explicit choice, then env,
 * then auto (OpenAI if a key is set, else local whisper.cpp if installed).
 * Throws a helpful message when neither is available — never auto-installs.
 */
function resolveEngine(explicit?: string): Engine {
  if (explicit === "openai" || explicit === "whisper-cpp") return explicit;
  if (explicit) throw new Error(`Unknown --engine "${explicit}" (use openai or whisper-cpp).`);
  if (process.env.OPENAI_API_KEY) return "openai";
  if (Bun.which(WHISPER_BIN)) return "whisper-cpp";
  throw new Error(
    "No transcription engine available. Set OPENAI_API_KEY for the OpenAI engine, " +
      "or install the local engine with `brew install whisper-cpp`.",
  );
}

export interface TranscribeOpts {
  input: string;
  out?: string;
  model: string;
  engine?: string;
  srt?: string | true;
  keepAudio: boolean;
}

export async function transcribeRecording(opts: TranscribeOpts): Promise<void> {
  const engine = resolveEngine(opts.engine);
  const out = opts.out
    ? resolve(opts.out)
    : resolve(`${basename(opts.input, extname(opts.input))}.transcript.json`);

  process.stderr.write(`→ extracting audio from ${basename(opts.input)}…\n`);
  const audioPath = await toAudio(opts.input, engine === "openai" ? "mp3" : "wav");
  try {
    let raw: any;
    let modelLabel: string;
    if (engine === "openai") {
      modelLabel = opts.model;
      process.stderr.write(`→ transcribing with OpenAI ${modelLabel}…\n`);
      raw = await callWhisper(audioPath, opts.model);
    } else {
      const modelPath = process.env.CAMKIT_WHISPER_MODEL ?? CAMTASIA_MODEL;
      modelLabel = `whisper.cpp ${basename(modelPath)}`;
      process.stderr.write(`→ transcribing locally with ${modelLabel}…\n`);
      raw = await callWhisperCpp(audioPath, modelPath);
    }
    const result = shapeTranscript(raw, opts.input, modelLabel);
    await writeFile(out, JSON.stringify(result, null, 2));
    process.stderr.write(
      `✓ ${result.words.length} words, ${result.segments.length} segments, ` +
        `${result.duration ?? "?"}s → ${out}\n`,
    );

    if (opts.srt) {
      const srtPath = opts.srt === true ? out.replace(/(\.transcript)?\.json$/, ".srt") : resolve(opts.srt);
      await writeFile(srtPath, toSrt(result));
      process.stderr.write(`✓ ${result.segments.length} captions → ${srtPath}\n`);
    }
  } finally {
    if (!opts.keepAudio) await unlink(audioPath).catch(() => {});
  }
}

export interface ExportAudioOpts {
  segs: AudioSeg[];
  projectPath: string;
  out: string;
  /** Total timeline length (s); the mix is padded/trimmed to exactly this. */
  durationSeconds: number;
}

/** Resolve a source-bin path against the project dir, falling back to media/. */
function resolveSource(file: string, projectDir: string): string {
  const direct = resolve(projectDir, file);
  if (existsSync(direct)) return direct;
  const inMedia = resolve(projectDir, "media", file);
  if (existsSync(inMedia)) return inMedia;
  throw new Error(`Source media not found: ${file} (looked in ${projectDir} and media/)`);
}

/**
 * Flat-mix the timeline's audio segments into one file with ffmpeg. Each
 * segment is sliced from its source (-ss/-t), delayed to its timeline position
 * (adelay), and summed (amix). Codec/container follow the output extension, so
 * `.m4a` → AAC, `.wav` → PCM, `.flac`, `.mp3`, etc. Never touches source media.
 */
export async function exportAudio(opts: ExportAudioOpts): Promise<void> {
  if (!opts.segs.length) throw new Error("No audio clips on the timeline to export.");
  const projectDir = dirname(opts.projectPath);

  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  opts.segs.forEach((s, i) => {
    const file = resolveSource(s.file, projectDir);
    inputs.push("-ss", s.sourceStart.toFixed(6), "-t", s.duration.toFixed(6), "-i", file);
    const ms = Math.round(s.timelineStart * 1000);
    const vol = s.gain !== 1 ? `volume=${s.gain.toFixed(6)},` : "";
    filters.push(`[${i}:a]${vol}adelay=${ms}:all=1[a${i}]`);
    labels.push(`[a${i}]`);
  });

  let filter: string;
  let mixed: string;
  if (opts.segs.length === 1) {
    filter = filters[0];
    mixed = "[a0]";
  } else {
    filter =
      filters.join(";") +
      ";" +
      labels.join("") +
      `amix=inputs=${opts.segs.length}:normalize=0:dropout_transition=0[mix]`;
    mixed = "[mix]";
  }
  // Per-segment seek/delay rounding loses a few samples each; pad then hard-trim
  // so the mix is exactly the timeline length, never drifting short.
  filter += `;${mixed}apad[out]`;

  process.stderr.write(`→ mixing ${opts.segs.length} audio segment(s) → ${basename(opts.out)}…\n`);
  await run("ffmpeg", [
    "-y", ...inputs,
    "-filter_complex", filter,
    "-map", "[out]",
    // Force stereo: mono sources (e.g. a mic .trec) become centred dual-mono,
    // matching Camtasia's exporter; genuine stereo sources pass through.
    "-ac", "2",
    "-t", opts.durationSeconds.toFixed(6),
    opts.out,
  ]);
  process.stderr.write(`✓ wrote ${opts.out}\n`);
}
