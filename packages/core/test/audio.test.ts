import { describe, expect, test } from "bun:test";
import { planAudioExport } from "../src/project.ts";

const ED = 705600000;

/** Doc mirroring a real timeline for audio export:
 *  - track 0: a standalone music bed (AMFile, src 3)
 *  - track 1: a screen capture (ScreenVMFile, no audio, src 1) — skipped
 *  - track 2: the synced camera+mic take (UnifiedMedia, audio nested on
 *    .audio sharing the same src 1 as the screen clip) — counted once
 * trackAttributes carries per-track mute/solo, indexed by trackIndex. */
function makeDoc(): any {
  const music = {
    _type: "AMFile",
    id: 30,
    src: 3,
    start: 0,
    duration: 100 * ED,
    mediaStart: 0,
    attributes: { gain: 1 },
    parameters: { volume: 1 },
  };
  const screen = {
    _type: "ScreenVMFile",
    id: 10,
    src: 1,
    start: 0,
    duration: 200 * ED,
    mediaStart: 0,
  };
  const unified = {
    _type: "UnifiedMedia",
    id: 11,
    start: 20 * ED,
    duration: 200 * ED,
    video: { _type: "VMFile", id: 12, src: 1, start: 0, duration: 200 * ED, mediaStart: 0 },
    audio: {
      _type: "AMFile",
      id: 13,
      src: 1,
      start: 0,
      duration: 200 * ED,
      mediaStart: 5 * ED,
      attributes: { gain: 1 },
      parameters: { volume: 1 },
    },
  };
  return {
    editRate: ED,
    sourceBin: [
      { id: 1, src: "rec1.trec" },
      { id: 3, src: "music.m4a" },
    ],
    timeline: {
      trackAttributes: [{}, {}, {}],
      sceneTrack: {
        scenes: [
          {
            csml: {
              tracks: [
                { trackIndex: 0, medias: [music] },
                { trackIndex: 1, medias: [screen] },
                { trackIndex: 2, medias: [unified] },
              ],
            },
          },
        ],
      },
    },
  };
}

describe("planAudioExport", () => {
  test("collects audio-bearing clips only, sorted by timeline start", () => {
    const segs = planAudioExport(makeDoc());
    // music (start 0) then camera (start 20); screen-only clip is skipped
    expect(segs.map((s) => s.src)).toEqual([3, 1]);
    expect(segs.map((s) => s.timelineStart)).toEqual([0, 20]);
  });

  test("resolves source files and reads timing in seconds", () => {
    const cam = planAudioExport(makeDoc()).find((s) => s.src === 1)!;
    expect(cam.file).toBe("rec1.trec");
    expect(cam.timelineStart).toBe(20);
    expect(cam.sourceStart).toBe(5); // from audio.mediaStart, not the clip's
    expect(cam.duration).toBe(200);
  });

  test("does not count a screen+camera take twice", () => {
    // screen (src 1) and camera audio (src 1) share one .trec; only audio counts
    const segs = planAudioExport(makeDoc());
    expect(segs.filter((s) => s.src === 1)).toHaveLength(1);
  });

  test("drops muted tracks", () => {
    const doc = makeDoc();
    doc.timeline.trackAttributes[0].audioMuted = true; // mute the music bed
    expect(planAudioExport(doc).map((s) => s.src)).toEqual([1]);
  });

  test("solo keeps only soloed tracks", () => {
    const doc = makeDoc();
    doc.timeline.trackAttributes[2].solo = true; // solo the camera track
    expect(planAudioExport(doc).map((s) => s.src)).toEqual([1]);
  });

  test("folds clip gain × scalar volume into gain", () => {
    const doc = makeDoc();
    doc.timeline.sceneTrack.scenes[0].csml.tracks[0].medias[0].attributes.gain = 0.5;
    doc.timeline.sceneTrack.scenes[0].csml.tracks[0].medias[0].parameters.volume = 0.5;
    const music = planAudioExport(doc).find((s) => s.src === 3)!;
    expect(music.gain).toBeCloseTo(0.25);
  });

  test("drops clips at gain 0 (muted on the timeline)", () => {
    const doc = makeDoc();
    doc.timeline.sceneTrack.scenes[0].csml.tracks[0].medias[0].attributes.gain = 0;
    expect(planAudioExport(doc).map((s) => s.src)).toEqual([1]);
  });

  test("leaves a keyframed volume envelope at unity", () => {
    const doc = makeDoc();
    // an automation envelope is an array of keyframes, not a scalar
    doc.timeline.sceneTrack.scenes[0].csml.tracks[0].medias[0].parameters.volume = [
      { time: 0, value: 0.2 },
      { time: 10, value: 1 },
    ];
    const music = planAudioExport(doc).find((s) => s.src === 3)!;
    expect(music.gain).toBe(1);
  });

  test("rejects a clip whose src is missing from the source bin", () => {
    const doc = makeDoc();
    doc.sourceBin = doc.sourceBin.filter((s: any) => s.id !== 3); // drop the music source
    expect(() => planAudioExport(doc)).toThrow(/src 3 not in the source bin/);
  });

  test("raw mode ignores mute, solo, and gain", () => {
    const doc = makeDoc();
    doc.timeline.trackAttributes[0].audioMuted = true;
    doc.timeline.trackAttributes[2].solo = true;
    doc.timeline.sceneTrack.scenes[0].csml.tracks[0].medias[0].attributes.gain = 0.3;
    const segs = planAudioExport(doc, { raw: true });
    expect(segs.map((s) => s.src)).toEqual([3, 1]); // nothing dropped
    expect(segs.every((s) => s.gain === 1)).toBe(true); // all unity
  });
});
