/**
 * Dynamic Caption injection. Camtasia's animated word-by-word captions are two
 * cooperating pieces, bound implicitly (no id links them):
 *
 *   1. The word stream lives on the SOURCE asset, not the timeline: at
 *      sourceBin[i].sourceTracks[j] (the audio track, type 2) as
 *      parameters.transcription.keyframes — one keyframe per word, with the
 *      word's SOURCE-relative time in project editRate units — plus the
 *      sourceTrack flag transcriptionSet:true.
 *   2. A `Callout` media (modifier "dynamicCaption") on its own timeline track
 *      carries only the visual style, copied verbatim from a preset's
 *      effect.json. It has no reference to the source; Camtasia pairs the two
 *      by scene. So we write the word stream AND drop in a styled Callout.
 *
 * The preset `def` is resolved by the CLI (it lives outside the project, under
 * ~/Library/Application Support/TechSmith/Camtasia/DynamicCaptions) and passed
 * in here, so this module stays pure — mirroring how rebuild planning is pure.
 */
import { tracks } from "./project.ts";
import { secondsToUnits } from "./time.ts";
import type { Transcript } from "./transcript.ts";

/** A source's audio track holds the transcription; type 2 is audio (0 is video). */
const AUDIO_SOURCETRACK_TYPE = 2;

export interface CaptionKeyframe {
  endTime: number;
  time: number;
  value: string;
  duration: number;
}

/**
 * One keyframe per word, at the word's SOURCE-relative start in editRate units.
 * Observed projects set time === endTime and duration 0 (Camtasia derives each
 * word's highlight window from the gap to the next keyframe).
 */
export function transcriptionKeyframes(transcript: Transcript, editRate: number): CaptionKeyframe[] {
  return transcript.words
    .map((w) => {
      const t = secondsToUnits(w.start, editRate);
      return { endTime: t, time: t, value: w.word.trim(), duration: 0 };
    })
    .filter((k) => k.value.length > 0);
}

/** The biggest numeric "id" anywhere in the doc, +1 — so new ids never collide. */
function nextId(doc: any): number {
  return 1 + Math.max(...JSON.stringify(doc).match(/"id"\s*:\s*(\d+)/g)!.map((m) => +m.replace(/\D/g, "")));
}

/**
 * Build the timeline Callout that renders the captions. `def` is the resolved
 * preset block (a preset's effect.json, verbatim); we only swap its placeholder
 * text. The envelope mirrors a Camtasia-authored dynamic-caption Callout.
 */
export function buildCalloutMedia(opts: { id: number; def: any; startUnits: number; durationUnits: number }): any {
  const def = { ...opts.def, text: "" };
  return {
    id: opts.id,
    _type: "Callout",
    def,
    attributes: { ident: "", autoRotateText: true },
    parameters: { translation1: -338.0, geometryCrop0: 0.0, geometryCrop1: 0.0, geometryCrop2: 0.0, geometryCrop3: 0.0 },
    effects: [],
    start: opts.startUnits,
    duration: opts.durationUnits,
    mediaStart: 0,
    mediaDuration: opts.durationUnits,
    scalar: 1,
    metadata: { AppliedThemeId: "", audiateLinkedSession: "", effectApplied: "none" },
    animationTracks: {},
  };
}

export interface InjectResult {
  srcId: number;
  wordCount: number;
  trackIndex: number;
  calloutId: number;
}

/**
 * Mutate the doc to add a dynamic caption track from `transcript`:
 *   - write transcription keyframes + transcriptionSet onto the target source's
 *     audio sourceTrack (chosen by `srcId`, else the first source that has one);
 *   - append a new timeline track carrying a styled Callout spanning the project.
 *
 * The Callout spans the whole project by default; the user can trim/move it in
 * Camtasia. Throws if the chosen source has no audio sourceTrack to attach to.
 */
export function injectDynamicCaptions(doc: any, opts: { transcript: Transcript; presetDef: any; srcId?: number }): InjectResult {
  const editRate = doc.editRate;
  const bin: any[] = doc.sourceBin ?? [];

  const candidates = opts.srcId != null ? bin.filter((s) => s.id === opts.srcId) : bin;
  let target: { entry: any; track: any } | undefined;
  for (const entry of candidates) {
    const track = (entry.sourceTracks ?? []).find((t: any) => t.type === AUDIO_SOURCETRACK_TYPE);
    if (track) {
      target = { entry, track };
      break;
    }
  }
  if (!target) {
    const where = opts.srcId != null ? `source ${opts.srcId}` : "any source";
    throw new Error(`No audio sourceTrack on ${where} to attach captions to.`);
  }

  const keyframes = transcriptionKeyframes(opts.transcript, editRate);
  if (!keyframes.length) throw new Error("Transcript has no words to caption.");

  target.track.transcriptionSet = true;
  target.track.parameters = { ...(target.track.parameters ?? {}), transcription: { type: "string", keyframes } };

  const ts = tracks(doc);
  const trackIndex = ts.length;
  const totalUnits = Math.max(
    0,
    ...ts.flatMap((t: any) => (t.medias ?? []).map((m: any) => (m.start ?? 0) + (m.duration ?? 0))),
  );
  const calloutId = nextId(doc);
  const callout = buildCalloutMedia({ id: calloutId, def: opts.presetDef, startUnits: 0, durationUnits: totalUnits });

  ts.push({ trackIndex, parameters: {}, medias: [callout] });
  const attrs = doc.timeline.trackAttributes;
  if (Array.isArray(attrs)) {
    attrs.push({
      ident: "",
      audioMuted: false,
      videoHidden: false,
      magnetic: false,
      matte: 0,
      solo: false,
      metadata: { IsLocked: "False", trackHeight: "54" },
    });
  }

  return { srcId: target.entry.id, wordCount: keyframes.length, trackIndex, calloutId };
}
