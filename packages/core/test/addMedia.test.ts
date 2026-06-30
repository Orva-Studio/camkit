import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../src/newProject.ts";
import { addMediaToProject, PROJECT_EDIT_RATE } from "../src/addMedia.ts";

function freshDoc() {
  const bundle = join(mkdtempSync(join(tmpdir(), "camkit-add-")), "p.cmproj");
  const tscproj = createProject(bundle);
  return JSON.parse(readFileSync(tscproj, "utf8"));
}

test("video+audio lands as a UnifiedMedia with VMFile + AMFile children", () => {
  const doc = freshDoc();
  const id = addMediaToProject(
    doc,
    { relPath: "./media/1/x.mov", name: "x.mov", durationS: 10, video: { width: 1920, height: 1080, fps: 30 }, audio: { channels: 2, sampleRate: 44100 } },
    { at: 5, track: 0 },
  );

  // source registered: millisecond range, fps on video track, channels on audio
  const src = doc.sourceBin.find((s: any) => s.id === id);
  expect(src.src).toBe("./media/1/x.mov");
  expect(src.rect).toEqual([0, 0, 1920, 1080]);
  expect(src.sourceTracks.length).toBe(2);
  expect(src.sourceTracks[0].editRate).toBe(1000);
  expect(src.sourceTracks[0].range).toEqual([0, 10000]);
  expect(src.sourceTracks[0].sampleRate).toBe(30);
  expect(src.sourceTracks[1].numChannels).toBe(2);

  const clip = doc.timeline.sceneTrack.scenes[0].csml.tracks[0].medias[0];
  expect(clip._type).toBe("UnifiedMedia");
  expect(clip.video._type).toBe("VMFile");
  expect(clip.audio._type).toBe("AMFile");
  expect(clip.video.src).toBe(id);
  expect(clip.audio.src).toBe(id);
  expect(clip.video.trackNumber).toBe(0);
  expect(clip.audio.trackNumber).toBe(1);
  expect(clip.start).toBe(5 * PROJECT_EDIT_RATE);
  expect(clip.duration).toBe(10 * PROJECT_EDIT_RATE);
  // geometryCrop is a parameter object, not a bare double
  expect(clip.video.parameters.geometryCrop0).toEqual({ type: "double", defaultValue: 0.0, interp: "eioe" });
});

test("audio-only lands as a bare AMFile and one audio sourceTrack", () => {
  const doc = freshDoc();
  addMediaToProject(doc, { relPath: "./media/1/a.m4a", name: "a.m4a", durationS: 133, audio: { channels: 1, sampleRate: 44100 } });
  const src = doc.sourceBin[0];
  expect(src.sourceTracks.length).toBe(1);
  expect(src.sourceTracks[0].type).toBe(2);

  const clip = doc.timeline.sceneTrack.scenes[0].csml.tracks[0].medias[0];
  expect(clip._type).toBe("AMFile");
  expect(clip.attributes.ident).toBe("a");
  expect(clip.duration).toBe(133 * PROJECT_EDIT_RATE);
});

test("video-only omits the audio sourceTrack", () => {
  const doc = freshDoc();
  addMediaToProject(doc, { relPath: "./media/1/v.mp4", name: "v.mp4", durationS: 3, video: { width: 1280, height: 720, fps: 25 } });
  const src = doc.sourceBin[0];
  expect(src.sourceTracks.length).toBe(1);
  expect(src.sourceTracks[0].type).toBe(0);
});

test("throws when media has no streams", () => {
  const doc = freshDoc();
  expect(() => addMediaToProject(doc, { relPath: "x", name: "x", durationS: 1 })).toThrow(/neither/);
});

test("throws on a missing track index", () => {
  const doc = freshDoc();
  expect(() =>
    addMediaToProject(doc, { relPath: "x", name: "x", durationS: 1, video: { width: 1, height: 1, fps: 1 } }, { track: 9 }),
  ).toThrow(/track/);
});
