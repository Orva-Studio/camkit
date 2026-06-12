/**
 * macOS Camtasia app control via AppleScript.
 *
 * Camtasia Mac ships a hidden AppleScript suite (CamtasiaGo.sdef,
 * NSAppleScriptEnabled=YES). Verified working on 2026.1.3: document list,
 * standard-suite open / close saving yes. Verified broken: media-element
 * access (AppleEvent -10000), some project properties — so live timeline
 * editing is not dependable; use close (saves) → edit project.tscproj →
 * open (reloads). Camtasia never re-reads project.tscproj while a document
 * is open and overwrites it on save. Re-probe after Camtasia updates.
 */
import { spawnSync } from "node:child_process";
import { dirname } from "node:path";
import { bundleName } from "@camkit/core";

function assertDarwin(): void {
  if (process.platform !== "darwin") {
    throw new Error("Camtasia app control is macOS-only (AppleScript).");
  }
}

function osascript(script: string): string {
  assertDarwin();
  const r = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`osascript failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
}

/** Names of documents open in Camtasia ([] if the app isn't running).
 * Uses the app's own AppleScript document list — more reliable than window
 * titles and needs no Accessibility permission. */
export function camtasiaDocs(): string[] {
  assertDarwin();
  if (spawnSync("pgrep", ["-i", "camtasia"]).status !== 0) return [];
  const out = osascript(`tell application "Camtasia"
    set out to ""
    repeat with d in documents
      set out to out & (name of d) & "\\n"
    end repeat
    return out
  end tell`);
  return out.split("\n").map((s) => s.trim()).filter(Boolean);
}

export interface OpenDoc {
  name: string;
  /** POSIX path to the .cmproj bundle. */
  path: string;
}

/** Open documents with their bundle paths (verified: `path of document`
 * returns a file:// URL on 2026.1.3). [] if the app isn't running. */
export function camtasiaDocPaths(): OpenDoc[] {
  assertDarwin();
  if (spawnSync("pgrep", ["-i", "camtasia"]).status !== 0) return [];
  const out = osascript(`tell application "Camtasia"
    set out to ""
    repeat with d in documents
      set out to out & (name of d) & "\\t" & (path of d) & "\\n"
    end repeat
    return out
  end tell`);
  return out
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, url] = line.split("\t");
      const path = url.startsWith("file://") ? decodeURIComponent(new URL(url).pathname).replace(/\/$/, "") : url;
      return { name, path };
    });
}

export interface ProjectStatus {
  bundle: string;
  openDocs: string[];
  open: boolean;
}

/** Whether a specific project is open in Camtasia. The app being running is
 * not enough — it keeps other projects open; only the target project's
 * document blocks editing. */
export function projectStatus(projectPath: string): ProjectStatus {
  const bundle = bundleName(projectPath);
  const openDocs = camtasiaDocs();
  return { bundle, openDocs, open: openDocs.includes(bundle) };
}

export type CloseResult = "closed" | "not-open";

/** Save-and-close one project document (never quits the app, never touches
 * other open projects). "saving yes" persists any unsaved user edits first. */
export function closeProject(projectPath: string): CloseResult {
  const name = bundleName(projectPath);
  if (!camtasiaDocs().includes(name)) return "not-open";
  osascript(`tell application "Camtasia" to close document "${name}" saving yes`);
  if (camtasiaDocs().includes(name)) {
    throw new Error(`${name} is still open — a Camtasia dialog may need attention.`);
  }
  return "closed";
}

/** Reopen a project bundle in Camtasia (e.g. after a rebuild). */
export function openProject(projectPath: string): void {
  const bundle = dirname(projectPath);
  osascript(`tell application "Camtasia"
    activate
    open POSIX file "${bundle}"
  end tell`);
}
