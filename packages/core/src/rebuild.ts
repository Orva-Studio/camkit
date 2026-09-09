/** Source-time rough cuts for simple media timelines. Existing edits are never flattened silently. */
import { clipSrc, tracks } from "./project.ts";
import { secondsToFrameUnits, unitsToSeconds } from "./time.ts";

export interface KeepSeg {
  src: number;
  start: number;
  end: number;
}
/** First source is the reference clock; offset is source time minus reference time, in seconds. */
export interface SyncGroup {
  sources: { src: number; offset?: number }[];
}
export interface RebuildOptions {
  syncGroups?: SyncGroup[];
}

function validateSegment(s: any): asserts s is KeepSeg {
  if (
    !s ||
    !Number.isSafeInteger(s.src) ||
    s.src < 0 ||
    !Number.isFinite(s.start) ||
    !Number.isFinite(s.end) ||
    s.start < 0
  ) {
    throw new Error(
      "Keep segments require a non-negative integer src and finite non-negative start/end seconds.",
    );
  }
  if (s.end <= s.start) throw new Error("Keep segment has end <= start.");
}
export function parseKeep(spec: string): KeepSeg[] {
  return spec
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((tok) => {
      const m = tok.match(/^(\d+):([\d.]+)-([\d.]+)$/);
      if (!m)
        throw new Error(`Bad keep segment "${tok}" (want src:start-end).`);
      const s = { src: +m[1], start: +m[2], end: +m[3] };
      validateSegment(s);
      return s;
    });
}
export function parseKeepJson(json: any): KeepSeg[] {
  const arr = Array.isArray(json) ? json : json?.keep;
  if (!Array.isArray(arr))
    throw new Error("Expected a keep array or {keep:[...]}.");
  return arr.map((s) => {
    validateSegment(s);
    return { src: s.src, start: s.start, end: s.end };
  });
}

export function setTiming(
  clip: any,
  startU: number,
  mediaStartU: number,
  durU: number,
): void {
  Object.assign(clip, {
    start: startU,
    duration: durU,
    mediaStart: mediaStartU,
    mediaDuration: durU,
  });
  for (const sub of ["video", "audio"] as const)
    if (clip[sub]) setTiming(clip[sub], startU, mediaStartU, durU);
}

function populated(value: any): boolean {
  return (
    value != null &&
    (typeof value === "object" ? Object.keys(value).length > 0 : !!value)
  );
}
/** Fail closed for timing-dependent properties we cannot safely retime. Static framing/gain is supported. */
export function assertSimpleClip(m: any): void {
  if (
    !["ScreenVMFile", "VMFile", "AMFile", "UnifiedMedia"].includes(m?._type)
  ) {
    throw new Error(
      `Unsupported media ${m?._type}; rebuild cannot preserve this timeline.`,
    );
  }
  if (
    (m.scalar ?? 1) !== 1 ||
    populated(m.effects) ||
    populated(m.animationTracks) ||
    populated(m.transitions) ||
    populated(m.markers) ||
    populated(m.metadata?.audiateLinkedSession)
  ) {
    throw new Error(
      "Rebuild cannot preserve effects, animations, transitions, speed changes, markers or Audiate links.",
    );
  }
  for (const p of Object.values(m.parameters ?? {}) as any[]) {
    if (
      p &&
      typeof p === "object" &&
      Object.keys(p).some(
        (k) => !["type", "defaultValue", "interp"].includes(k),
      )
    ) {
      throw new Error("Rebuild cannot preserve keyframed parameters.");
    }
  }
  if (m._type === "UnifiedMedia") {
    if (!m.video || !m.audio || m.video.src !== m.audio.src)
      throw new Error("Unsupported mixed-source UnifiedMedia.");
    for (const sub of [m.video, m.audio]) {
      assertSimpleClip(sub);
      for (const k of ["start", "duration", "mediaStart", "mediaDuration"]) {
        if (sub[k] !== m[k])
          throw new Error(
            "UnifiedMedia timing differs between its parent and child streams.",
          );
      }
    }
  }
}
export function assertSimpleTimeline(doc: any): void {
  if (doc.timeline?.sceneTrack?.scenes?.length !== 1)
    throw new Error("Only single-scene timelines are supported.");
  if (
    populated(doc.timeline.markers) ||
    populated(doc.timeline.captionData) ||
    populated(doc.timeline.parameters)
  ) {
    throw new Error("Unsupported timeline markers, captions or parameters.");
  }
  for (const t of tracks(doc)) {
    const seen = new Set<number>();
    for (const m of t.medias ?? []) {
      assertSimpleClip(m);
      const src = clipSrc(m);
      if (src == null) throw new Error("Media has no source.");
      if (seen.has(src))
        throw new Error(
          "Already-cut timeline: multiple clips of one source on a track. Use the uncut original.",
        );
      seen.add(src);
    }
  }
}

export interface PlanEntry {
  src: number;
  sourceStart: number;
  sourceEnd: number;
  timelineStart: number;
  timelineEnd: number;
  trackCount: number;
  sources: { src: number; sourceStart: number; sourceEnd: number }[];
}
export interface RebuildPlan {
  entries: PlanEntry[];
  newMedias: Record<number, any[]>;
  totalUnits: number;
  totalSeconds: number;
  segmentCount: number;
}

export function planRebuild(
  doc: any,
  segs: KeepSeg[],
  opts: RebuildOptions = {},
): RebuildPlan {
  if (!Array.isArray(segs) || !segs.length)
    throw new Error("No keep segments given.");
  segs.forEach(validateSegment);
  const ed = doc.editRate,
    fps = doc.videoFormatFrameRate;
  if (!Number.isFinite(ed) || ed <= 0 || !Number.isFinite(fps) || fps <= 0)
    throw new Error("Invalid editRate or videoFormatFrameRate.");
  assertSimpleTimeline(doc);
  const templates = new Map<number, { trackIdx: number; clip: any }[]>();
  tracks(doc).forEach((t, trackIdx) => {
    for (const clip of t.medias ?? []) {
      const src = clipSrc(clip)!;
      templates.set(src, [...(templates.get(src) ?? []), { trackIdx, clip }]);
    }
  });
  const groups = new Map<number, SyncGroup>();
  const grouped = new Set<number>();
  if (opts.syncGroups != null && !Array.isArray(opts.syncGroups))
    throw new Error("syncGroups must be an array.");
  for (const group of opts.syncGroups ?? []) {
    if (!Array.isArray(group?.sources) || group.sources.length < 2)
      throw new Error("A sync group needs at least two sources.");
    const occupied = new Set<number>();
    for (const s of group.sources) {
      if (
        !Number.isSafeInteger(s.src) ||
        grouped.has(s.src) ||
        !Number.isFinite(s.offset ?? 0)
      )
        throw new Error("Invalid or repeated synchronized source.");
      if (!templates.has(s.src))
        throw new Error(`No timeline clip uses src ${s.src}.`);
      for (const t of templates.get(s.src)!) {
        if (occupied.has(t.trackIdx))
          throw new Error("Synchronized sources must occupy distinct tracks.");
        occupied.add(t.trackIdx);
      }
      grouped.add(s.src);
    }
    if ((group.sources[0].offset ?? 0) !== 0)
      throw new Error("The reference source offset must be zero.");
    groups.set(group.sources[0].src, group);
  }
  // Source media ranges must be known; never infer file length from an edited clip.
  function checkBounds(clip: any, lo: number, hi: number) {
    for (const m of clip._type === "UnifiedMedia"
      ? [clip.video, clip.audio]
      : [clip]) {
      const bins = (doc.sourceBin ?? []).filter((s: any) => s.id === m.src);
      if (bins.length !== 1)
        throw new Error(`Missing or duplicate source ${m.src}.`);
      const sts = bins[0].sourceTracks ?? [];
      const selected = m.trackNumber == null ? sts : [sts[m.trackNumber]];
      if (!selected.length)
        throw new Error(`Unknown duration for source ${m.src}.`);
      for (const st of selected) {
        if (
          !st ||
          !Array.isArray(st.range) ||
          st.range.length !== 2 ||
          !Number.isFinite(st.editRate) ||
          st.editRate <= 0 ||
          !st.range.every(Number.isFinite)
        )
          throw new Error(`Invalid range for source ${m.src}.`);
        if (
          lo < st.range[0] / st.editRate - 1e-9 ||
          hi > st.range[1] / st.editRate + 1e-9
        )
          throw new Error(`Keep range exceeds source ${m.src} bounds.`);
      }
    }
  }
  let nextId = 1;
  function scan(v: any) {
    if (!v || typeof v !== "object") return;
    if (Number.isSafeInteger(v.id)) nextId = Math.max(nextId, v.id + 1);
    Object.values(v).forEach(scan);
  }
  scan(doc);
  function reId(m: any) {
    m.id = nextId++;
    for (const sub of ["video", "audio"]) if (m[sub]) reId(m[sub]);
  }
  const newMedias: Record<number, any[]> = {};
  tracks(doc).forEach((_, i) => (newMedias[i] = []));
  const entries: PlanEntry[] = [];
  let posU = 0;
  for (const s of segs) {
    if (!templates.has(s.src))
      throw new Error(
        `No timeline clip uses src ${s.src}; can't rebuild from it.`,
      );
    if (grouped.has(s.src) && !groups.has(s.src))
      throw new Error(
        "Keep ranges must use the sync group's reference source.",
      );
    const lo = secondsToFrameUnits(s.start, ed, fps),
      hi = secondsToFrameUnits(s.end, ed, fps);
    const dur = hi - lo;
    if (
      !Number.isSafeInteger(lo) ||
      !Number.isSafeInteger(hi) ||
      dur <= 0 ||
      !Number.isSafeInteger(posU + dur)
    )
      throw new Error(
        "Keep range collapses after frame rounding or exceeds safe timing precision.",
      );
    const sources = [];
    let trackCount = 0;
    for (const member of groups.get(s.src)?.sources ?? [
      { src: s.src, offset: 0 },
    ]) {
      // Round offset once in project units, never independently round source in/out.
      const offsetU = Math.round((member.offset ?? 0) * ed);
      const sourceLo = lo + offsetU,
        sourceHi = sourceLo + dur;
      if (!Number.isSafeInteger(sourceLo) || !Number.isSafeInteger(sourceHi))
        throw new Error("Invalid synchronized timing.");
      for (const { trackIdx, clip } of templates.get(member.src)!) {
        checkBounds(
          clip,
          s.start + (member.offset ?? 0),
          s.end + (member.offset ?? 0),
        );
        checkBounds(clip, sourceLo / ed, sourceHi / ed);
        const copy = structuredClone(clip);
        reId(copy);
        setTiming(copy, posU, sourceLo, dur);
        newMedias[trackIdx].push(copy);
        trackCount++;
      }
      sources.push({
        src: member.src,
        sourceStart: sourceLo / ed,
        sourceEnd: sourceHi / ed,
      });
    }
    entries.push({
      src: s.src,
      sourceStart: lo / ed,
      sourceEnd: hi / ed,
      timelineStart: posU / ed,
      timelineEnd: (posU + dur) / ed,
      trackCount,
      sources,
    });
    posU += dur;
  }
  return {
    entries,
    newMedias,
    totalUnits: posU,
    totalSeconds: unitsToSeconds(posU, ed),
    segmentCount: segs.length,
  };
}
export function applyRebuild(doc: any, plan: RebuildPlan): void {
  tracks(doc).forEach((t, i) => (t.medias = plan.newMedias[i]));
}
