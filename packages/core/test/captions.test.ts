import { describe, expect, test } from "bun:test";
import { injectDynamicCaptions, transcriptionKeyframes } from "../src/captions.ts";
import type { Transcript } from "../src/transcript.ts";

const ED = 705600000;

function transcript(words: { word: string; start: number; end: number }[]): Transcript {
  return { source: "take.trec", model: "whisper-1", duration: null, text: "", words, segments: [] };
}

/** Minimal doc: one source with a video (type 0) + audio (type 2) sourceTrack,
 * one timeline clip spanning 10s, and the parallel trackAttributes array. */
function doc(): any {
  return {
    editRate: ED,
    sourceBin: [
      {
        id: 1,
        src: "./media/take.mp4",
        sourceTracks: [{ type: 0, parameters: {} }, { type: 2, parameters: {} }],
      },
    ],
    timeline: {
      trackAttributes: [{ ident: "", metadata: { trackHeight: "54" } }],
      sceneTrack: {
        scenes: [{ csml: { tracks: [{ trackIndex: 0, medias: [{ id: 3, _type: "UnifiedMedia", start: 0, duration: 10 * ED }] }] } }],
      },
    },
  };
}

test("transcriptionKeyframes: one per word, source-relative editRate units, time===endTime", () => {
  const kf = transcriptionKeyframes(transcript([
    { word: "So,", start: 0.05, end: 0.1 },
    { word: " hello ", start: 0.29, end: 0.4 },
  ]), ED);
  expect(kf).toEqual([
    { endTime: 35280000, time: 35280000, value: "So,", duration: 0 },
    { endTime: 204624000, time: 204624000, value: "hello", duration: 0 },
  ]);
});

test("transcriptionKeyframes drops blank words", () => {
  expect(transcriptionKeyframes(transcript([{ word: "  ", start: 1, end: 2 }]), ED)).toEqual([]);
});

test("injectDynamicCaptions writes the word stream on the audio sourceTrack and adds a caption track", () => {
  const d = doc();
  const def = { modifier: "dynamicCaption", "dynamic-caption-preset-ID": "blockPreset6", text: "ABC" };
  const r = injectDynamicCaptions(d, { transcript: transcript([{ word: "hi", start: 0, end: 1 }]), presetDef: def });

  // word stream lands on the audio (type 2) sourceTrack, not the video one
  const audio = d.sourceBin[0].sourceTracks[1];
  expect(audio.transcriptionSet).toBe(true);
  expect(audio.parameters.transcription.keyframes).toHaveLength(1);
  expect(d.sourceBin[0].sourceTracks[0].transcriptionSet).toBeUndefined();

  // a new timeline track with a Callout spanning the project (10s)
  const tracks = d.timeline.sceneTrack.scenes[0].csml.tracks;
  expect(tracks).toHaveLength(2);
  const callout = tracks[1].medias[0];
  expect(callout._type).toBe("Callout");
  expect(callout.def.modifier).toBe("dynamicCaption");
  expect(callout.def.text).toBe(""); // placeholder swapped out
  expect(callout.duration).toBe(10 * ED);
  expect(callout.id).toBe(r.calloutId);
  expect(r.calloutId).toBeGreaterThan(3); // unique vs existing ids

  // trackAttributes kept parallel
  expect(d.timeline.trackAttributes).toHaveLength(2);
  expect(r).toMatchObject({ srcId: 1, wordCount: 1, trackIndex: 1 });
});

test("injectDynamicCaptions does not mutate the caller's preset def", () => {
  const def = { modifier: "dynamicCaption", text: "ABC" };
  injectDynamicCaptions(doc(), { transcript: transcript([{ word: "hi", start: 0, end: 1 }]), presetDef: def });
  expect(def.text).toBe("ABC");
});

describe("guards", () => {
  test("throws on a source with no audio sourceTrack", () => {
    const d = doc();
    d.sourceBin[0].sourceTracks = [{ type: 0, parameters: {} }];
    expect(() => injectDynamicCaptions(d, { transcript: transcript([{ word: "hi", start: 0, end: 1 }]), presetDef: {} })).toThrow(
      /no audio sourcetrack/i,
    );
  });

  test("throws on an empty transcript", () => {
    expect(() => injectDynamicCaptions(doc(), { transcript: transcript([]), presetDef: {} })).toThrow(/no words/i);
  });

  test("--src selects the matching source", () => {
    const d = doc();
    d.sourceBin.unshift({ id: 9, src: "./other.mp4", sourceTracks: [{ type: 2, parameters: {} }] });
    const r = injectDynamicCaptions(d, { transcript: transcript([{ word: "hi", start: 0, end: 1 }]), presetDef: {}, srcId: 1 });
    expect(r.srcId).toBe(1);
    expect(d.sourceBin[0].sourceTracks[0].transcriptionSet).toBeUndefined(); // id 9 untouched
  });
});
