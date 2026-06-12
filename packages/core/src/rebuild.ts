/**
 * Rebuild planning: rewrite the timeline to keep only the listed source
 * segments, in order, ripple-laid with no gaps (seconds → editRate units).
 *
 * A single screen recording occupies two tracks (ScreenVMFile screen capture +
 * UnifiedMedia camera/audio) sharing identical timing; they must be cut
 * together to stay in sync. So every track a source touches gets a clone of
 * that track's template clip at the same timeline position — one template per
 * (src, track), because an already-cut timeline holds many clips of the same
 * source per track but each kept segment clones once per track.
 */
import { clipSrc, tracks } from "./project.ts";
import { secondsToFrameUnits, unitsToSeconds } from "./time.ts";

export interface KeepSeg {
  src: number;
  start: number; // seconds
  end: number; // seconds
}

/** Parse "1:159.8-179.2 2:46.3-60.0" → [{src,start,end}, ...] (order preserved). */
export function parseKeep(spec: string): KeepSeg[] {
  return spec
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const m = tok.match(/^(\d+):([\d.]+)-([\d.]+)$/);
      if (!m) throw new Error(`Bad keep segment "${tok}" (want src:start-end, e.g. 2:46.3-60.0)`);
      const [, src, start, end] = m;
      if (+end <= +start) throw new Error(`Segment "${tok}" has end <= start`);
      return { src: +src, start: +start, end: +end };
    });
}

/** Parse a --from file's JSON: [{src,start,end}] or {keep:[...]}. */
export function parseKeepJson(json: any): KeepSeg[] {
  const arr = Array.isArray(json) ? json : json.keep;
  return arr.map((s: any) => ({ src: s.src, start: s.start, end: s.end }));
}

/** Set a clip's timeline position + source in/out, recursing into video/audio. */
export function setTiming(clip: any, startU: number, mediaStartU: number, durU: number): void {
  clip.start = startU;
  clip.duration = durU;
  clip.mediaStart = mediaStartU;
  clip.mediaDuration = durU;
  for (const sub of ["video", "audio"] as const) {
    if (clip[sub]) setTiming(clip[sub], startU, mediaStartU, durU);
  }
}

export interface PlanEntry {
  src: number;
  sourceStart: number; // seconds
  sourceEnd: number; // seconds
  timelineStart: number; // seconds
  timelineEnd: number; // seconds
  trackCount: number;
}

export interface RebuildPlan {
  entries: PlanEntry[];
  /** trackIdx → replacement medias array */
  newMedias: Record<number, any[]>;
  totalUnits: number;
  totalSeconds: number;
  segmentCount: number;
}

/** Compute the rebuild without touching the doc or any files. */
export function planRebuild(doc: any, segs: KeepSeg[]): RebuildPlan {
  if (!segs.length) throw new Error("No keep segments given.");
  const ed = doc.editRate;
  const fps = doc.videoFormatFrameRate ?? 30;
  const ts = tracks(doc);

  // Map each source id → the timeline clips that reference it (a src can appear
  // on multiple tracks, e.g. a screen capture + its synced camera/audio).
  const templates: Record<number, { trackIdx: number; clip: any }[]> = {};
  ts.forEach((t: any, trackIdx: number) => {
    for (const m of t.medias ?? []) {
      const src = clipSrc(m);
      if (src == null) continue;
      const list = (templates[src] ??= []);
      if (!list.some((t) => t.trackIdx === trackIdx)) list.push({ trackIdx, clip: m });
    }
  });
  for (const s of segs) {
    if (!templates[s.src]) throw new Error(`No timeline clip uses src ${s.src}; can't rebuild from it.`);
  }

  // Fresh ids so cloned clips never collide.
  let nextId = 1 + Math.max(...JSON.stringify(doc).match(/"id"\s*:\s*(\d+)/g)!.map((m) => +m.replace(/\D/g, "")));
  const reId = (clip: any) => {
    clip.id = nextId++;
    for (const sub of ["video", "audio"] as const) if (clip[sub]) clip[sub].id = nextId++;
  };

  const newMedias: Record<number, any[]> = {};
  ts.forEach((_: any, i: number) => (newMedias[i] = []));
  let posU = 0;
  const entries: PlanEntry[] = [];
  for (const s of segs) {
    const durU = secondsToFrameUnits(s.end - s.start, ed, fps);
    const startU = secondsToFrameUnits(s.start, ed, fps);
    for (const { trackIdx, clip } of templates[s.src]) {
      const clone = JSON.parse(JSON.stringify(clip));
      reId(clone);
      setTiming(clone, posU, startU, durU);
      newMedias[trackIdx].push(clone);
    }
    entries.push({
      src: s.src,
      sourceStart: s.start,
      sourceEnd: s.end,
      timelineStart: unitsToSeconds(posU, ed),
      timelineEnd: unitsToSeconds(posU + durU, ed),
      trackCount: templates[s.src].length,
    });
    posU += durU;
  }

  return {
    entries,
    newMedias,
    totalUnits: posU,
    totalSeconds: unitsToSeconds(posU, ed),
    segmentCount: segs.length,
  };
}

/** Mutate the doc's tracks to the planned medias. */
export function applyRebuild(doc: any, plan: RebuildPlan): void {
  tracks(doc).forEach((t: any, i: number) => (t.medias = plan.newMedias[i]));
}
