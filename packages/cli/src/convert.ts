import { spawn } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import {
  loadProject,
  planSeparateMedia,
  type ConvertedStream,
} from "@camkit/core";

function run(command: string, args: string[]): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "",
      err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err = (err + d).slice(-12000)));
    p.on("error", rej);
    p.on("close", (code) =>
      code === 0
        ? res(out)
        : rej(new Error(`${command} exited ${code}: ${err}`)),
    );
  });
}
export async function convertMedia(opts: {
  project: string;
  out: string;
  dryRun?: boolean;
  acknowledgeCursorLoss?: boolean;
}) {
  const { path, doc } = loadProject(opts.project);
  const out = resolve(opts.out);
  if (!out.endsWith(".cmproj"))
    throw new Error("--out must be a new .cmproj directory.");
  if (existsSync(out)) throw new Error(`Output already exists: ${out}`);
  // First validate the project without invoking ffmpeg or creating any output.
  // Only stream metadata belonging to the placed source is used (bin can contain unused recordings).
  const clips =
    doc.timeline?.sceneTrack?.scenes?.[0]?.csml?.tracks?.flatMap(
      (t: any) => t.medias ?? [],
    ) ?? [];
  const first = clips[0];
  const src = first?._type === "UnifiedMedia" ? first.video?.src : first?.src;
  const bin = (doc.sourceBin ?? []).find((s: any) => s.id === src);
  const preliminary = planSeparateMedia(
    doc,
    (bin?.sourceTracks ?? []).map((t: any, n: number) => ({
      trackNumber: n,
      file: `./media/stream-${n}.${t.type === 2 ? "wav" : "mp4"}`,
      kind: t.type === 2 ? "audio" : "video",
      width: t.trackRect?.[2],
      height: t.trackRect?.[3],
      sampleRate: Number(t.sampleRate),
      channels: t.numChannels,
    })),
  );
  const input = resolve(dirname(path), preliminary.sourcePath);
  const probe = JSON.parse(
    await run("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      input,
    ]),
  );
  const converted: ConvertedStream[] = [];
  const args = [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-nostdin",
    "-n",
    "-copyts",
    "-i",
    input,
  ];
  const used = preliminary.doc.sourceBin.map((s: any) =>
    Number(s.src.match(/stream-(\d+)/)[1]),
  );
  for (const n of used) {
    const st = probe.streams?.find((s: any) => s.index === n);
    const sourceTrack = bin.sourceTracks[n];
    const audio = sourceTrack.type === 2;
    if (!st || st.codec_type !== (audio ? "audio" : "video"))
      throw new Error(`Cannot map TREC track ${n} to ffmpeg stream safely.`);
    const start = Number(st.start_time),
      duration = Number(st.duration);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(duration) ||
      start < 0 ||
      start >= preliminary.durationSeconds ||
      duration + start < preliminary.durationSeconds
    )
      throw new Error(`Stream ${n} does not cover the requested duration.`);
    if (
      !audio &&
      (start !== 0 ||
        st.width !== sourceTrack.trackRect?.[2] ||
        st.height !== sourceTrack.trackRect?.[3])
    )
      throw new Error(`Unsupported video timing or dimensions on stream ${n}.`);
    const s: ConvertedStream = {
      trackNumber: n,
      file: `./media/stream-${n}.${audio ? "wav" : "mp4"}`,
      kind: audio ? "audio" : "video",
      width: st.width,
      height: st.height,
      sampleRate: Number(st.sample_rate),
      channels: st.channels,
    };
    converted.push(s);
    args.push("-map", `0:${n}`, "-t", String(preliminary.durationSeconds));
    if (audio)
      args.push("-af", "aresample=async=1:first_pts=0", "-c:a", "pcm_s16le");
    else
      args.push(
        "-vf",
        `fps=${doc.videoFormatFrameRate}:start_time=0,tpad=stop_mode=clone:stop_duration=1`,
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-an",
        "-movflags",
        "+faststart",
      );
    args.push(resolve(out, s.file));
  }
  const plan = planSeparateMedia(doc, converted);
  if (opts.dryRun)
    return {
      out,
      durationSeconds: plan.durationSeconds,
      syncGroups: plan.syncGroups,
      warnings: plan.warnings,
      ffmpeg: args,
    };
  if (!opts.acknowledgeCursorLoss)
    throw new Error(
      "Conversion loses native cursor data; pass --acknowledge-cursor-loss after reviewing --dry-run.",
    );
  // Exclusive mkdir: never overwrite an existing bundle, even when two invocations race.
  mkdirSync(out);
  try {
    mkdirSync(join(out, "media"));
    await run("ffmpeg", args);
    for (const s of converted) {
      const check = JSON.parse(
        await run("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-of",
          "json",
          resolve(out, s.file),
        ]),
      );
      const st = check.streams?.[0];
      const tolerance =
        s.kind === "audio" ? 1 / s.sampleRate! : 1 / doc.videoFormatFrameRate;
      if (
        check.streams?.length !== 1 ||
        st.codec_type !== s.kind ||
        !Number.isFinite(Number(st.duration)) ||
        Math.abs(Number(st.duration) - plan.durationSeconds) >
          tolerance + 1e-6 ||
        Math.abs(Number(st.start_time ?? 0)) > 1e-6
      )
        throw new Error(
          `Converted stream failed duration/start validation: ${s.file} (start=${st?.start_time}, duration=${st?.duration}, expected=${plan.durationSeconds})`,
        );
    }
    writeFileSync(
      join(out, "conversion.json"),
      JSON.stringify(
        {
          sourceProject: path,
          sourceMedia: input,
          durationSeconds: plan.durationSeconds,
          syncGroups: plan.syncGroups,
          warnings: plan.warnings,
        },
        null,
        2,
      ),
    );
    writeFileSync(
      join(out, "sync-groups.json"),
      JSON.stringify(plan.syncGroups, null, 2),
    );
    // Write the project last so a failed conversion never looks like a usable project.
    writeFileSync(
      join(out, "project.tscproj"),
      JSON.stringify(plan.doc, null, 2),
    );
    return {
      out,
      durationSeconds: plan.durationSeconds,
      syncGroups: plan.syncGroups,
      warnings: plan.warnings,
    };
  } catch (e) {
    rmSync(out, { recursive: true, force: true }); // only the directory exclusively created by this invocation
    throw e;
  }
}
