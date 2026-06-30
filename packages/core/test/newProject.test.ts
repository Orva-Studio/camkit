import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../src/newProject.ts";

test("createProject writes a valid bundle with patched dimensions", () => {
  const dir = mkdtempSync(join(tmpdir(), "camkit-new-"));
  const bundle = join(dir, "demo.cmproj");
  const tscproj = createProject(bundle, { width: 1280, height: 720 });

  expect(existsSync(tscproj)).toBe(true);
  const doc = JSON.parse(readFileSync(tscproj, "utf8"));
  expect(doc.width).toBe(1280);
  expect(doc.height).toBe(720);
  expect(doc.title).toBe("demo");
  // Empty Camtasia projects omit sourceBin entirely (an empty array crashes
  // the app on open) and ship two empty tracks.
  expect("sourceBin" in doc).toBe(false);
  expect(doc.timeline.sceneTrack.scenes[0].csml.tracks.length).toBe(2);
  // Sidecar dirs Camtasia expects.
  for (const sub of ["media", "recordings", "audiate"]) {
    expect(existsSync(join(bundle, sub))).toBe(true);
  }
});

test("createProject refuses non-.cmproj paths and existing bundles", () => {
  const dir = mkdtempSync(join(tmpdir(), "camkit-new-"));
  expect(() => createProject(join(dir, "x.foo"))).toThrow(/\.cmproj/);

  const bundle = join(dir, "dupe.cmproj");
  createProject(bundle);
  expect(() => createProject(bundle)).toThrow(/exists/);
});
