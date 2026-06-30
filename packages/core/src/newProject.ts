/**
 * Create a new, empty Camtasia project on disk from a canonical template.
 *
 * The AppleScript suite cannot create or save projects on Camtasia Mac
 * 2026.1.3 (every project-scoped verb throws -10000; a hand-built tscproj
 * crashes the app on open). So `camkit new` copies a real empty project that
 * Camtasia itself produced — embedded here as JSON so it survives
 * `bun build --compile`, where on-disk template files would not be bundled.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
// A real empty project.tscproj saved by Camtasia 2026.1.3 (thumbnail stripped).
import emptyTemplate from "../templates/empty-project.json" with { type: "json" };

export interface NewProjectOptions {
  /** Frame width in px (default: template's 1920). */
  width?: number;
  /** Frame height in px (default: template's 1080). */
  height?: number;
}

/**
 * Write an empty `.cmproj` bundle at `bundlePath`. Returns the path to the
 * project.tscproj inside it. Throws if the bundle already exists (never
 * clobber an existing project).
 */
export function createProject(bundlePath: string, opts: NewProjectOptions = {}): string {
  if (!bundlePath.endsWith(".cmproj")) {
    throw new Error(`Project path must end in .cmproj: ${bundlePath}`);
  }
  if (existsSync(bundlePath)) {
    throw new Error(`Already exists: ${bundlePath}`);
  }

  const doc = structuredClone(emptyTemplate) as any;
  // Title is cosmetic in Camtasia but keep it in sync with the bundle name.
  doc.title = basename(bundlePath, ".cmproj");
  if (opts.width != null) doc.width = opts.width;
  if (opts.height != null) doc.height = opts.height;

  // Recreate the bundle's directory structure. Camtasia writes these sidecar
  // dirs for recordings/media it manages; an empty project opens fine with
  // them empty, but their absence has caused odd behaviour, so create them.
  mkdirSync(bundlePath, { recursive: true });
  for (const sub of ["media", "recordings", "audiate"]) {
    mkdirSync(join(bundlePath, sub), { recursive: true });
  }
  const tscproj = join(bundlePath, "project.tscproj");
  writeFileSync(tscproj, JSON.stringify(doc, null, 1));
  return tscproj;
}
