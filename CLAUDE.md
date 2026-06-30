# camkit - agent guide

`camkit` is a CLI over Camtasia Mac projects (`packages/core` logic, `packages/cli` commands, `packages/darwin` AppleScript control, `packages/mcp` stub).

## Automation reach - read before asking a human

Default to driving the machine yourself. The Camtasia GUI is fully scriptable via Accessibility (System Events): keystrokes, menu clicks, save sheets, and the file dialog (`Cmd+Shift+G` to type a path). If a task looks like "the user has to click this in Camtasia," first check whether you can drive it.
Ask a human only for the genuinely un-automatable: interactive login, a physical action, or a judgment call that is theirs to make.

Worked example: creating an empty project template *looked* like a human job (AppleScript can't save) - but File > New + `Cmd+S` + filling the save sheet via System Events did it with no human. Captured at `packages/core/templates/empty-project.json`.

## Camtasia AppleScript suite - verified capabilities (build 2026.1.3)

The hidden suite (`CamtasiaGo.sdef`) is mostly broken for editing. Don't re-probe; don't assume something works because the sdef declares it.

| Works | Broken (-10000 / -1708, or silently ignored) |
|-------|-----|
| `make new document` | `add` / addMedia (no live media insert) |
| open / close / name / document list / `path of` | `save`, `sources of`, any project element access |
| `playheadTime` read | `playheadTime` set (silently ignored), `project N` refs |

Consequence: **all live timeline mutation must go through Accessibility menu-driving, not the AppleScript suite** - including moving the playhead. Project creation/edit instead writes `project.tscproj` JSON on disk then `open`s it (the rebuild engine's approach). An empty project omits `sourceBin` entirely - an empty array crashes the app on open.

## Pointers

- `HANDOFF-live-cut.md` - live cut/split/trim design, full probe log, T0-T6 task plan.
- Conventions: no em dashes; one sentence per line in long Markdown; don't hand-edit CHANGELOG.md.
- Verify edits E2E against a real open Camtasia project before claiming done.
