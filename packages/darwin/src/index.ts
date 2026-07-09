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

/** Escape a string for embedding in a double-quoted AppleScript literal. */
function asLiteral(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
  const b = asLiteral(bundle);
  osascript(`tell application "Camtasia"
    activate
    open POSIX file "${b}"
  end tell`);
}

/** Map a camkit --codec value to Camtasia's "Compression Type" menu label.
 * Only prores422 is required for v1; add rows here for prores4444/h264. */
const CODEC_LABELS: Record<string, string> = {
  prores422: "Apple ProRes 422",
};

/**
 * Render a Camtasia document's timeline to a .mov via UI scripting.
 *
 * The AppleScript suite has NO working export verb on 2026.1.3 (export is a
 * bare exportToFile: stub with no file/codec parameters — see issue #10 spike),
 * so this drives the GUI: Export ▸ Local File… → File format "QuickTime Movie"
 * → Options… → Compression Type "Apple ProRes 422" → set name+folder → Export.
 * Verified against Camtasia 2026.1.3. Brittle across versions and needs
 * Accessibility permission for the controlling terminal (System Events).
 *
 * Only kicks off the export UI — does not wait for the render to finish.
 * Callers should poll for `opts.out` if they need a completion signal.
 *
 * ponytail: UI scripting is the only path Camtasia exposes; no abstraction
 * layer until a second codec/version actually needs different element paths.
 */
export function exportVideo(opts: {
  out: string;
  codec?: string;
  /** Open document / .cmproj bundle name to raise before exporting (e.g. "foo.cmproj"). */
  documentName?: string;
}): void {
  assertDarwin();
  const codec = opts.codec ?? "prores422";
  const label = CODEC_LABELS[codec];
  if (!label) {
    throw new Error(`Unsupported --codec "${codec}". Supported: ${Object.keys(CODEC_LABELS).join(", ")}.`);
  }
  if (camtasiaDocs().length === 0) {
    throw new Error("No project open in Camtasia. Open it first (camkit open) — export renders the front timeline.");
  }
  const dir = asLiteral(dirname(opts.out));
  const base = asLiteral(opts.out.split("/").pop() ?? opts.out);
  const labelLit = asLiteral(label);
  // Window titles usually include the project title without .cmproj; match both.
  const raiseNeedle = asLiteral(
    (opts.documentName ?? "").replace(/\.cmproj$/i, "") || (opts.documentName ?? ""),
  );

  const raiseBlock =
    raiseNeedle.length > 0
      ? `
    -- raise the target editor window (Welcome steals focus and disables Export)
    try
      perform action "AXRaise" of (first window whose name contains "${raiseNeedle}")
    end try
    set frontmost to true
    delay 0.4
`
      : `
    set frontmost to true
    delay 0.4
`;

  osascript(`
tell application "Camtasia" to activate
delay 0.5
tell application "System Events"
  if not (UI elements enabled) then error "Accessibility permission required — grant your terminal under System Settings ▸ Privacy & Security ▸ Accessibility."
  tell process "Camtasia"
${raiseBlock}
    click menu item "Local File..." of menu 1 of menu bar item "Export" of menu bar 1
    delay 1.5
    -- the save sheet attaches to whichever window; find it
    set swin to 0
    repeat with i from 1 to (count of windows)
      try
        if (count of sheets of window i) > 0 then set swin to i
      end try
    end repeat
    if swin = 0 then error "Export dialog did not appear."
    set sg to splitter group 1 of sheet 1 of window swin

    -- File format ▸ QuickTime Movie (.mov)
    set fp to pop up button 2 of sg
    click fp
    delay 0.4
    click menu item "Export to QuickTime Movie (.mov)" of menu 1 of fp
    delay 0.6

    -- Options… ▸ Advanced Export Options ▸ Compression Type
    click (item 1 of (buttons of sg whose name is "Options..."))
    delay 1.2
    set adv to window "Advanced Export Options"
    set picked to false
    repeat with p in (pop up buttons of group "Video" of adv)
      if not picked then
        try
          click p
          delay 0.3
          if (exists menu item "${labelLit}" of menu 1 of p) then
            click menu item "${labelLit}" of menu 1 of p
            set picked to true
          else
            key code 53
          end if
        end try
      end if
    end repeat
    if not picked then
      click button "Cancel" of adv
      error "Compression Type \\"${labelLit}\\" not found in Advanced Export Options."
    end if
    click button "OK" of adv
    delay 0.6

    -- filename + destination folder
    set value of text field "Export As:" of sg to "${base}"
    delay 0.2
    keystroke "g" using {command down, shift down}
    delay 0.5
    keystroke "${dir}"
    delay 0.3
    keystroke return
    delay 0.6

    click button "Export" of sg
    delay 0.6
    -- overwrite confirmation, if the file already exists
    try
      if (count of sheets of window swin) > 0 then
        click button "Replace" of sheet 1 of window swin
      end if
    end try
  end tell
end tell`);
}
