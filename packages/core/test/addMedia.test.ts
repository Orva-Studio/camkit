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

test("addMediaToProject adds a source and a timeline clip with correct timing", () => {
  const doc = freshDoc();
  const id = addMediaToProject(
    doc,
    { relPath: "./media/1/x.mov", name: "x.mov", width: 1920, height: 1080, durationS: 10, fps: 30, audio: { channels: 2, sampleRate: 44100 } },
    { at: 5, track: 0 },
  );

  // source registered
  const src = doc.sourceBin.find((s: any) => s.id === id);
  expect(src.src).toBe("./media/1/x.mov");
  expect(src.rect).toEqual([0, 0, 1920, 1080]);
  expect(src.sourceTracks.length).toBe(2); // video + audio
  expect(src.sourceTracks[0].sampleRate).toBe(30); // fps on the video track
  expect(src.sourceTracks[1].numChannels).toBe(2);

  // clip on track 0 with project-editRate timing
  const clip = doc.timeline.sceneTrack.scenes[0].csml.tracks[0].medias[0];
  expect(clip._type).toBe("VMFile");
  expect(clip.src).toBe(id);
  expect(clip.start).toBe(5 * PROJECT_EDIT_RATE);
  expect(clip.duration).toBe(10 * PROJECT_EDIT_RATE);
  expect(clip.id).not.toBe(id); // distinct ids
});

test("addMediaToProject omits the audio track for video-only media", () => {
  const doc = freshDoc();
  addMediaToProject(doc, { relPath: "./media/1/v.mp4", name: "v.mp4", width: 1280, height: 720, durationS: 3, fps: 25 });
  const src = doc.sourceBin[0];
  expect(src.sourceTracks.length).toBe(1);
  expect(src.sourceTracks[0].type).toBe(0);
});

test("addMediaToProject throws on a missing track index", () => {
  const doc = freshDoc();
  expect(() =>
    addMediaToProject(doc, { relPath: "x", name: "x", width: 1, height: 1, durationS: 1, fps: 1 }, { track: 9 }),
  ).toThrow(/track/);
});
