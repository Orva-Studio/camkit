/**
 * Append a media clip to a project's timeline by constructing the sourceBin
 * entry + VMFile timeline element Camtasia writes for an imported file.
 *
 * The AppleScript `add` verb is dead on Camtasia Mac 2026.1.3 (see CLAUDE.md),
 * so we build the JSON directly — modelled on what Camtasia itself produces
 * for a plain mp4/mov source. This is the pure builder; the CLI ffprobes the
 * file and copies it into the bundle, then calls this.
 */

/** Camtasia's project-level time base: units per second on the timeline. */
export const PROJECT_EDIT_RATE = 705600000;
/** Source-track time base Camtasia uses for sourceBin ranges. */
const SOURCE_EDIT_RATE = 44100;

export interface MediaProbe {
  /** Path stored in the project, relative to the bundle (e.g. ./media/<ts>/x.mov). */
  relPath: string;
  /** Bare filename, used in metaData / ident fields. */
  name: string;
  width: number;
  height: number;
  /** Duration in seconds. */
  durationS: number;
  /** Video frame rate (stored as the video sourceTrack sampleRate). */
  fps: number;
  /** Audio stream, omitted for video-only media. */
  audio?: { channels: number; sampleRate: number };
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

/**
 * Mutates `doc` in place: adds the source to `sourceBin` and a clip to the
 * given timeline track. Returns the new source id.
 */
export function addMediaToProject(doc: any, probe: MediaProbe, opts: AddMediaOptions = {}): number {
  const at = opts.at ?? 0;
  const trackIndex = opts.track ?? 0;

  const sourceId = maxId(doc) + 1;
  const sourceRange = [0, Math.round(probe.durationS * SOURCE_EDIT_RATE)];
  const lastMod = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "T");

  const sourceTracks: any[] = [
    {
      range: sourceRange,
      type: 0, // video
      editRate: SOURCE_EDIT_RATE,
      trackRect: [0, 0, probe.width, probe.height],
      sampleRate: probe.fps,
      bitDepth: 0,
      numChannels: 0,
      integratedLUFS: 100.0,
      peakLevel: -1.0,
      tag: 0,
      metaData: `${probe.name};`,
      parameters: {},
    },
  ];
  if (probe.audio) {
    sourceTracks.push({
      range: sourceRange,
      type: 2, // audio
      editRate: SOURCE_EDIT_RATE,
      trackRect: [0, 0, 0, 0],
      sampleRate: probe.audio.sampleRate,
      bitDepth: 0,
      numChannels: probe.audio.channels,
      // ponytail: skip ffmpeg loudnorm analysis; disable normalization below
      // so these placeholders are never used. Add real LUFS if auto-normalize matters.
      integratedLUFS: 100.0,
      peakLevel: -1.0,
      tag: 0,
      metaData: `${probe.name};`,
      parameters: {},
    });
  }

  const source = {
    id: sourceId,
    src: probe.relPath,
    rect: [0, 0, probe.width, probe.height],
    lastMod,
    loudnessNormalization: false,
    sourceTracks,
    metadata: { timeAdded: lastMod },
  };
  (doc.sourceBin ??= []).push(source);

  const durUnits = Math.round(probe.durationS * PROJECT_EDIT_RATE);
  const clip = {
    id: maxId(doc) + 1,
    _type: "VMFile",
    src: sourceId,
    trackNumber: trackIndex,
    attributes: { ident: probe.name },
    parameters: { geometryCrop0: 0.0, geometryCrop1: 0.0, geometryCrop2: 0.0, geometryCrop3: 0.0 },
    effects: [],
    start: Math.round(at * PROJECT_EDIT_RATE),
    duration: durUnits,
    mediaStart: 0,
    mediaDuration: durUnits,
    scalar: 1,
    metadata: {
      "default-width": { type: "double", value: probe.width },
      "default-height": { type: "double", value: probe.height },
      "default-scale0": { type: "double", value: 1.0 },
      "default-scale1": { type: "double", value: 1.0 },
      lockAspectRatio: { type: "bool", value: true },
      effectApplied: "none",
    },
    animationTracks: {},
  };

  const tracks = doc.timeline?.sceneTrack?.scenes?.[0]?.csml?.tracks;
  if (!Array.isArray(tracks)) throw new Error("Project has no timeline tracks.");
  const track = tracks[trackIndex];
  if (!track) throw new Error(`No track at index ${trackIndex} (have ${tracks.length}).`);
  (track.medias ??= []).push(clip);

  return sourceId;
}
