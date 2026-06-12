/**
 * tscproj load + listing. A .tscproj is plain JSON; the timeline lives at
 * doc.timeline.sceneTrack.scenes[0].csml.tracks[].medias[]. All clip timing is
 * in project editRate units. A clip's source id is m.src, except UnifiedMedia
 * which carries it on m.video.src.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface Media {
  _type: string;
  src?: number;
  start?: number;
  duration?: number;
  video?: Media;
  audio?: Media;
}

export interface LoadedProject {
  path: string;
  doc: any;
}

/** Accepts a .cmproj dir or a project.tscproj path; defaults to ./search.cmproj/project.tscproj. */
export function resolveProjectPath(p?: string, cwd: string = process.cwd()): string {
  const target = p ? resolve(cwd, p) : resolve(cwd, "search.cmproj/project.tscproj");
  if (existsSync(target) && statSync(target).isDirectory()) {
    return join(target, "project.tscproj");
  }
  return target;
}

export function loadProject(p?: string, cwd?: string): LoadedProject {
  const path = resolveProjectPath(p, cwd);
  if (!existsSync(path)) throw new Error(`Project not found: ${path}`);
  return { path, doc: JSON.parse(readFileSync(path, "utf8")) };
}

export function tracks(doc: any): any[] {
  return doc.timeline.sceneTrack.scenes[0].csml.tracks;
}

/** A timeline clip's effective source id (UnifiedMedia carries it on .video). */
export function clipSrc(m: Media): number | undefined {
  return m._type === "UnifiedMedia" ? m.video?.src : m.src;
}

/** The .cmproj bundle name a project path belongs to, e.g. "crawl.cmproj". */
export function bundleName(projectPath: string): string {
  const dir = dirname(projectPath);
  return dir.endsWith(".cmproj") ? dir.split("/").pop()! : projectPath.split("/").pop()!;
}

export interface ProjectInfo {
  path: string;
  width: number;
  height: number;
  fps: number;
  editRate: number;
  trackCount: number;
  sourceCount: number;
  durationSeconds: number;
}

export function projectInfo(path: string, doc: any): ProjectInfo {
  const ed = doc.editRate;
  const ts = tracks(doc);
  const end = Math.max(
    0,
    ...ts.flatMap((t: any) => (t.medias ?? []).map((m: Media) => (m.start ?? 0) + (m.duration ?? 0))),
  );
  return {
    path,
    width: doc.width,
    height: doc.height,
    fps: doc.videoFormatFrameRate,
    editRate: ed,
    trackCount: ts.length,
    sourceCount: doc.sourceBin.length,
    durationSeconds: end / ed,
  };
}

export interface ClipRow {
  track: number;
  type: string;
  src: number | undefined;
  recording: string | null;
  start: number; // seconds, 2dp
  end: number; // seconds, 2dp
}

export function listClips(doc: any): ClipRow[] {
  const ed = doc.editRate;
  const srcMap: Record<number, string> = {};
  for (const s of doc.sourceBin) srcMap[s.id] = s.src;

  const rows: ClipRow[] = [];
  for (const t of tracks(doc)) {
    for (const m of t.medias ?? []) {
      const src = clipSrc(m);
      rows.push({
        track: t.trackIndex,
        type: m._type,
        src,
        recording: src != null ? srcMap[src] : null,
        start: +((m.start ?? 0) / ed).toFixed(2),
        end: +(((m.start ?? 0) + (m.duration ?? 0)) / ed).toFixed(2),
      });
    }
  }
  return rows;
}

export interface SourceRow {
  id: number;
  src: string;
  duration: number | null; // seconds
  onTimeline: boolean;
}

export function listSources(doc: any): SourceRow[] {
  const onTimeline = new Set<number>();
  for (const t of tracks(doc))
    for (const m of t.medias ?? []) {
      const src = clipSrc(m);
      if (src != null) onTimeline.add(src);
    }
  return doc.sourceBin.map((s: any) => {
    const range = s.sourceTracks?.[0];
    const dur = range ? (range.range[1] - range.range[0]) / range.editRate : null;
    return { id: s.id, src: s.src, duration: dur, onTimeline: onTimeline.has(s.id) };
  });
}
