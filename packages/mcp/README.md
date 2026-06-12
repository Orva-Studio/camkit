# @camkit/mcp

Placeholder. This package will wrap `@camkit/core` (and `@camkit/darwin` on
macOS) as an MCP server, exposing the same operations as the `camkit` CLI —
project info, clips/sources listing, rebuild planning, transcription — as
typed tools for non-shell clients (Claude desktop/web, other machines).

Per the design notes (`cam-cli.md`): don't build both interfaces
speculatively. The CLI is the engine; add this thin adapter (~50 lines over
core) only when a non-CLI client actually needs it.
