import { describe, expect, test } from "bun:test";
import { parseKeep, parseKeepJson, planRebuild, applyRebuild } from "../src/rebuild.ts";
import { tracks } from "../src/project.ts";

const ED = 705600000;

/** Minimal two-track doc mirroring the real structure: a screen capture
 * (ScreenVMFile) on track 0 and its synced camera+audio (UnifiedMedia,
 * nested video/audio sharing src on .video.src) on track 1. */
function makeDoc(): any {
  const screen = {
    _type: "ScreenVMFile",
    id: 10,
    src: 1,
    start: 0,
    duration: 200 * ED,
    mediaStart: 0,
    mediaDuration: 200 * ED,
    effects: [],
    animationTracks: {},
  };
  const unified = {
    _type: "UnifiedMedia",
    id: 11,
    start: 0,
    duration: 200 * ED,
    mediaStart: 0,
    mediaDuration: 200 * ED,
    video: { _type: "VMFile", id: 12, src: 1, start: 0, duration: 200 * ED, mediaStart: 0, mediaDuration: 200 * ED },
    audio: { _type: "AMFile", id: 13, src: 1, start: 0, duration: 200 * ED, mediaStart: 0, mediaDuration: 200 * ED },
  };
  const solo = {
    _type: "ScreenVMFile",
    id: 14,
    src: 2,
    start: 200 * ED,
    duration: 100 * ED,
    mediaStart: 0,
    mediaDuration: 100 * ED,
  };
  return {
    editRate: ED,
    width: 1920,
    height: 1080,
    videoFormatFrameRate: 30,
    sourceBin: [
      { id: 1, src: "rec1.trec", sourceTracks: [{ range: [0, 200 * 44100], editRate: 44100 }] },
      { id: 2, src: "rec2.trec", sourceTracks: [{ range: [0, 100 * 44100], editRate: 44100 }] },
    ],
    timeline: {
      sceneTrack: {
        scenes: [
          {
            csml: {
              tracks: [
                { trackIndex: 0, medias: [screen, solo] },
                { trackIndex: 1, medias: [unified] },
              ],
            },
          },
        ],
      },
    },
  };
}

describe("parseKeep", () => {
  test("parses ordered segments", () => {
    expect(parseKeep("1:159.8-179.2 2:46.3-60.0")).toEqual([
      { src: 1, start: 159.8, end: 179.2 },
      { src: 2, start: 46.3, end: 60.0 },
    ]);
  });

  test("rejects malformed tokens", () => {
    expect(() => parseKeep("1:abc-2")).toThrow(/Bad keep segment/);
  });

  test("rejects end <= start", () => {
    expect(() => parseKeep("1:10-10")).toThrow(/end <= start/);
    expect(() => parseKeep("1:10-5")).toThrow(/end <= start/);
  });

  test("tolerates extra whitespace", () => {
    expect(parseKeep("  1:0-5   2:1-2 ")).toHaveLength(2);
  });
});

describe("parseKeepJson", () => {
  test("accepts a bare array or {keep:[...]}", () => {
    const seg = { src: 1, start: 0, end: 5 };
    expect(parseKeepJson([seg])).toEqual([seg]);
    expect(parseKeepJson({ keep: [seg] })).toEqual([seg]);
  });
});

describe("planRebuild", () => {
  test("ripple-lays segments with no gaps, in order", () => {
    const plan = planRebuild(makeDoc(), [
      { src: 1, start: 10, end: 15 },
      { src: 2, start: 2, end: 4 },
      { src: 1, start: 50, end: 50.5 },
    ]);
    expect(plan.entries.map((e) => [e.timelineStart, e.timelineEnd])).toEqual([
      [0, 5],
      [5, 7],
      [7, 7.5],
    ]);
    expect(plan.totalSeconds).toBeCloseTo(7.5);
    expect(plan.totalUnits).toBe(Math.round(7.5 * ED));
  });

  test("clones every track a source touches, at the same position", () => {
    const plan = planRebuild(makeDoc(), [{ src: 1, start: 10, end: 15 }]);
    expect(plan.entries[0].trackCount).toBe(2);
    const t0 = plan.newMedias[0][0];
    const t1 = plan.newMedias[1][0];
    expect(t0._type).toBe("ScreenVMFile");
    expect(t1._type).toBe("UnifiedMedia");
    // identical timing on both tracks keeps screen + camera in sync
    for (const c of [t0, t1]) {
      expect(c.start).toBe(0);
      expect(c.duration).toBe(5 * ED);
      expect(c.mediaStart).toBe(10 * ED);
      expect(c.mediaDuration).toBe(5 * ED);
    }
    // nested video/audio blocks mirror the parent timing
    expect(t1.video.start).toBe(0);
    expect(t1.video.mediaStart).toBe(10 * ED);
    expect(t1.audio.duration).toBe(5 * ED);
  });

  test("dedups templates per (src, track) on an already-cut timeline", () => {
    const doc = makeDoc();
    // simulate a prior cut: two clips of src 1 on track 0
    const second = JSON.parse(JSON.stringify(doc.timeline.sceneTrack.scenes[0].csml.tracks[0].medias[0]));
    second.id = 99;
    second.start = 50 * ED;
    doc.timeline.sceneTrack.scenes[0].csml.tracks[0].medias.push(second);

    const plan = planRebuild(doc, [{ src: 1, start: 0, end: 5 }]);
    // one clone per track, not per existing clip
    expect(plan.entries[0].trackCount).toBe(2);
    expect(plan.newMedias[0]).toHaveLength(1);
    expect(plan.newMedias[1]).toHaveLength(1);
  });

  test("assigns fresh non-colliding ids, including nested video/audio", () => {
    const doc = makeDoc();
    const plan = planRebuild(doc, [
      { src: 1, start: 0, end: 1 },
      { src: 1, start: 2, end: 3 },
    ]);
    const ids: number[] = [];
    for (const medias of Object.values(plan.newMedias))
      for (const m of medias) {
        ids.push(m.id);
        if (m.video) ids.push(m.video.id);
        if (m.audio) ids.push(m.audio.id);
      }
    expect(new Set(ids).size).toBe(ids.length); // no duplicates among clones
    const maxExisting = 14;
    expect(Math.min(...ids)).toBeGreaterThan(maxExisting); // none collide with originals
  });

  test("seconds → units uses Math.round, not truncation", () => {
    const plan = planRebuild(makeDoc(), [{ src: 1, start: 46.3, end: 60.0 }]);
    const clone = plan.newMedias[0][0];
    expect(clone.mediaStart).toBe(Math.round(46.3 * ED));
    expect(clone.duration).toBe(Math.round((60.0 - 46.3) * ED));
    expect(Number.isInteger(clone.duration)).toBe(true);
  });

  test("rejects a src with no timeline clip", () => {
    expect(() => planRebuild(makeDoc(), [{ src: 7, start: 0, end: 1 }])).toThrow(/No timeline clip uses src 7/);
  });

  test("rejects an empty segment list", () => {
    expect(() => planRebuild(makeDoc(), [])).toThrow(/No keep segments/);
  });

  test("does not mutate the input doc", () => {
    const doc = makeDoc();
    const before = JSON.stringify(doc);
    planRebuild(doc, [{ src: 1, start: 0, end: 5 }]);
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe("applyRebuild", () => {
  test("replaces each track's medias with the plan", () => {
    const doc = makeDoc();
    const plan = planRebuild(doc, [{ src: 1, start: 10, end: 15 }]);
    applyRebuild(doc, plan);
    const ts = tracks(doc);
    expect(ts[0].medias).toHaveLength(1);
    expect(ts[1].medias).toHaveLength(1);
    expect(ts[0].medias[0].duration).toBe(5 * ED);
  });
});
