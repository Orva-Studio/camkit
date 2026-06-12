/**
 * ffmpeg/Whisper runners for the CLI. Port of transcribe.ts: extract audio
 * from a recording (.trec is a QuickTime container — audio and h264 are
 * readable, the tscc2 video stream is not), downsample to a small mono mp3,
 * send to the OpenAI transcription API (whisper-1 — the only model returning
 * word-level timestamps), write the stable transcript JSON contract.
 * Never touches source media; Camtasia stays the final renderer.
 */
import { spawn } from "node:child_process";
import { readFile, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { shapeTranscript } from "@camkit/core";

const API_URL = "https://api.openai.com/v1/audio/transcriptions";
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

/** Extract + downsample to a small mono mp3 for upload. Never touches the source. */
async function toUploadAudio(input: string): Promise<string> {
  const audioPath = join(tmpdir(), `cam-transcribe-${basename(input, extname(input))}.mp3`);
  // -vn drop video (tscc2 is undecodable anyway), 16 kHz mono is plenty for ASR.
  await run("ffmpeg", ["-y", "-i", input, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "64k", audioPath]);
  const { size } = await stat(audioPath);
  if (size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `Downsampled audio is ${(size / 1024 / 1024).toFixed(1)} MB, over the 25 MB API limit. ` +
        `Split the recording or lower the bitrate.`,
    );
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

export interface TranscribeOpts {
  input: string;
  out?: string;
  model: string;
  keepAudio: boolean;
}

export async function transcribeRecording(opts: TranscribeOpts): Promise<void> {
  const out = opts.out
    ? resolve(opts.out)
    : resolve(`${basename(opts.input, extname(opts.input))}.transcript.json`);
  process.stderr.write(`→ extracting audio from ${basename(opts.input)}…\n`);
  const audioPath = await toUploadAudio(opts.input);
  try {
    process.stderr.write(`→ transcribing with ${opts.model}…\n`);
    const raw = await callWhisper(audioPath, opts.model);
    const result = shapeTranscript(raw, opts.input, opts.model);
    await writeFile(out, JSON.stringify(result, null, 2));
    process.stderr.write(
      `✓ ${result.words.length} words, ${result.segments.length} segments, ` +
        `${result.duration ?? "?"}s → ${out}\n`,
    );
  } finally {
    if (!opts.keepAudio) await unlink(audioPath).catch(() => {});
  }
}
