/**
 * Append a media clip to a project's timeline by constructing the exact
 * sourceBin entry + timeline elements Camtasia writes for an imported file.
 *
 * The AppleScript `add` verb is dead on Camtasia Mac 2026.1.3 (see CLAUDE.md),
 * so we build the JSON directly. The shapes here are not guesses — they were
 * captured by driving Camtasia's File > Import on a real mp4 (video+audio) and
 * a real m4a (audio-only), saving, and reading back the resulting
 * project.tscproj (see HANDOFF-live-cut.md, T1 ground-truth capture).
 *
 * Ground truth, summarised:
 *  - sourceBin sourceTracks use editRate 1000 (millisecond ranges), NOT 44100.
 *  - A video+audio clip lands on the timeline as a `UnifiedMedia` wrapper
 *    holding a `video` (VMFile, trackNumber 0) and an `audio` (AMFile,
 *    trackNumber 1) child. An audio-only clip lands as a bare `AMFile`.
 *  - geometryCrop params are {type,defaultValue,interp} objects, not bare 0.0.
 */

/** Camtasia's project-level time base: units per second on the timeline. */
export const PROJECT_EDIT_RATE = 705600000;
/** Source-track time base Camtasia uses for sourceBin ranges (milliseconds). */
const SOURCE_EDIT_RATE = 1000;

export interface MediaProbe {
  /** Path stored in the project, relative to the bundle (e.g. ./media/<ts>/x.mp4). */
  relPath: string;
  /** Bare filename, used in metaData fields. */
  name: string;
  /** Duration in seconds. */
  durationS: number;
  /** Video stream; omitted for audio-only media. */
  video?: { width: number; height: number; fps: number };
  /** Audio stream; omitted for video-only media. */
  audio?: { channels: number; sampleRate: number };
  /**
   * Source file's modification time, formatted YYYYMMDDTHHMMSS, stored as the
   * sourceBin `lastMod`. Defaults to now if omitted.
   */
  lastMod?: string;
}

export interface AddMediaOptions {
  /** Timeline position in seconds (default 0). */
  at?: number;
  /** Track index to place the clip on (default 0). */
  track?: number;
}

/** Highest numeric `id` anywhere in the doc, so we can mint unique ones. */
function maxId(o: any): number {
  let m = 0;
  const walk = (v: any) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (typeof v.id === "number") m = Math.max(m, v.id);
      for (const k in v) walk(v[k]);
    }
  };
  walk(o);
  return m;
}

/** Camtasia timestamp: 20260630T163047 (local time, no separators). */
function stamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** geometryCropN parameter object as Camtasia writes it. */
function geometryCrops() {
  const crop = { type: "double", defaultValue: 0.0, interp: "eioe" };
  return { geometryCrop0: { ...crop }, geometryCrop1: { ...crop }, geometryCrop2: { ...crop }, geometryCrop3: { ...crop } };
}

/**
 * Mutates `doc` in place: adds the source to `sourceBin` and a clip to the
 * given timeline track. Returns the new source id.
 */
export function addMediaToProject(doc: any, probe: MediaProbe, opts: AddMediaOptions = {}): number {
  if (!probe.video && !probe.audio) throw new Error(`${probe.name} has neither a video nor an audio stream.`);

  const at = opts.at ?? 0;
  const trackIndex = opts.track ?? 0;
  const ident = probe.name.replace(/\.[^.]+$/, "");
  const now = new Date();

  const sourceId = maxId(doc) + 1;
  const sourceRange = [0, Math.round(probe.durationS * SOURCE_EDIT_RATE)];
  const w = probe.video?.width ?? 0;
  const h = probe.video?.height ?? 0;

  const sourceTracks: any[] = [];
  if (probe.video) {
    sourceTracks.push({
      range: sourceRange,
      type: 0, // video
      editRate: SOURCE_EDIT_RATE,
      trackRect: [0, 0, w, h],
      sampleRate: probe.video.fps,
      bitDepth: 0,
      numChannels: 0,
      integratedLUFS: 100.0,
      peakLevel: -1.0,
      tag: 0,
      metaData: `${probe.name};`,
      parameters: {},
    });
  }
  if (probe.audio) {
    sourceTracks.push({
      range: sourceRange,
      type: 2, // audio
      editRate: SOURCE_EDIT_RATE,
      trackRect: [0, 0, 0, 0],
      sampleRate: probe.audio.sampleRate,
      bitDepth: 0,
      numChannels: probe.audio.channels,
      // ponytail: real Camtasia measures LUFS/peak here. We disable
      // loudnessNormalization (below) so these placeholders are never used.
      // Add an ffmpeg loudnorm pass if auto-normalize ever matters.
      integratedLUFS: 100.0,
      peakLevel: -1.0,
      tag: 0,
      metaData: `${probe.name};`,
      parameters: {},
    });
  }

  doc.sourceBin ??= [];
  doc.sourceBin.push({
    id: sourceId,
    src: probe.relPath,
    rect: [0, 0, w, h],
    lastMod: probe.lastMod ?? stamp(now),
    loudnessNormalization: false,
    sourceTracks,
    metadata: { timeAdded: stamp(now) },
  });

  const dur = Math.round(probe.durationS * PROJECT_EDIT_RATE);
  const start = Math.round(at * PROJECT_EDIT_RATE);
  const span = { start, duration: dur, mediaStart: 0, mediaDuration: dur, scalar: 1 };

  const audioChild = () => ({
    id: maxId(doc) + 1,
    _type: "AMFile",
    src: sourceId,
    trackNumber: probe.video ? 1 : 0,
    attributes: { ident: probe.video ? "" : ident, gain: 1.0, mixToMono: false, loudnessNormalization: false, sourceFileOffset: 0 },
    channelNumber: "0",
    parameters: {},
    effects: [],
    ...span,
    animationTracks: {},
  });

  let clip: any;
  if (probe.video) {
    const video = {
      id: maxId(doc) + 1,
      _type: "VMFile",
      src: sourceId,
      trackNumber: 0,
      attributes: { ident },
      parameters: geometryCrops(),
      effects: [],
      ...span,
      animationTracks: {},
    };
    const audio = probe.audio ? audioChild() : undefined;
    clip = {
      id: maxId(doc) + 1,
      _type: "UnifiedMedia",
      video,
      ...(audio ? { audio } : {}),
      ...span,
      metadata: {
        audiateLinkedSession: "",
        clipSpeedAttribute: { type: "bool", value: false },
        colorAttribute: { type: "color", value: [0, 0, 0, 0] },
        "default-scale": "1",
        effectApplied: "none",
        lockAspectRatio: { type: "bool", value: true },
      },
    };
  } else {
    clip = {
      ...audioChild(),
      metadata: {
        audiateLinkedSession: "",
        clipSpeedAttribute: { type: "bool", value: false },
        colorAttribute: { type: "color", value: [0, 0, 0, 0] },
        effectApplied: "none",
      },
    };
  }

  const tracks = doc.timeline?.sceneTrack?.scenes?.[0]?.csml?.tracks;
  if (!Array.isArray(tracks)) throw new Error("Project has no timeline tracks.");
  const track = tracks[trackIndex];
  if (!track) throw new Error(`No track at index ${trackIndex} (have ${tracks.length}).`);
  (track.medias ??= []).push(clip);

  return sourceId;
}
