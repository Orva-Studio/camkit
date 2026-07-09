# Why `export-video` drives the GUI

Every other camkit command works on `project.tscproj` directly — that file
*describes* the timeline, and a description is just data we can read and
rewrite. **Rendering is different**: turning that description into a `.mov`
means compositing every track, effect, transition and Dynamic Caption,
decoding the `.trec` `tscc2` screen-recording stream (which ffmpeg can't), and
encoding ProRes. Only Camtasia's engine does that. No file you can write makes
the rendered video appear — something has to run the renderer. So `export-video`
has to invoke Camtasia, not edit JSON.

That left the question of *how* to invoke it. Options tried, in order of
preference, verified against **Camtasia 2026.1.3**:

1. **AppleScript `export` verb — the right way. Dead.** `sdef
   /Applications/Camtasia.app` shows `project` only `responds-to "export"`
   (`exportToFile:`) — there is no `<command name="export">` block, so the verb
   declares **no parameters** (no file, no codec, no preset). Tested live:
   `export (project 1 …) file "…"` → syntax error (destination has no grammar
   to attach to); `tell (project 1 …) export file "…"` → `doesn't understand
   "export" (-1708)`; bare `export (project 1 …)` → dispatches then dies `Can't
   continue export. (-1708)`. It routes to `exportToFile:` but there's no way to
   supply the file argument, and it won't run without one. Consistent with the
   already-documented broken suite (`-10000` on media elements). Re-check this
   each Camtasia release — if TechSmith fixes the suite, it should replace UI
   scripting.

2. **A headless render/CLI binary in the app bundle.** Ruled out:
   `Camtasia.app/Contents/MacOS` ships only `Camtasia` and `CamtasiaSupport.app`
   — no standalone exporter. The render code is internal dylibs
   (`libCSRenderLib.dylib`, `libCSEncodeLib.dylib`) driven by GUI-only Obj-C
   controllers (`ExportMenuControllerProtocol`, …). No documented command-line
   entry point.

3. **Re-encode the `.tscproj` ourselves with ffmpeg.** Rejected by design — see
   above: `.trec` `tscc2` is undecodable and Camtasia's effects/transitions
   aren't reproducible. camkit's principle is "Camtasia stays the final
   renderer."

4. **UI scripting via macOS Accessibility (what shipped).** Drive the real
   on-screen export UI through `osascript` → `System Events`: Export ▸ Local
   File → File format *QuickTime Movie* → Options → Compression Type *Apple
   ProRes 422* → set name/folder → Export. This is the **only** path that
   actually produces a file today.

Consequences of (4): **not headless.** It needs Camtasia running and frontmost
on a logged-in GUI session (no `ssh`/daemon), the controlling terminal must
have **Accessibility** permission (System Settings ▸ Privacy & Security ▸
Accessibility), and the render blocks the GUI while it runs. It's also brittle
across Camtasia versions — the element paths are verified only on 2026.1.3.
