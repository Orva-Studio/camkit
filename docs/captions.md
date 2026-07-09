# Captions in the Camtasia UI

To get higher-quality captions than Camtasia's built-in tiny model: transcribe
with camkit (OpenAI or a larger local model), then either bring the result into
Camtasia via SRT import (File ▸ Import ▸ Captions), or use `camkit captions` to
inject an animated **Dynamic Caption** track straight into the project. Do
**not** swap Camtasia's bundled model file — it's redownloaded on update and
unsupported.

`camkit captions --from take.transcript.json --preset "Bebas 3 Line Word Red"`
writes the word-level stream onto the source and adds a styled caption track via
the same `close → edit → open` cycle as rebuild (with a `.bak` backup). The
style comes from a Camtasia Dynamic Caption preset, resolved on demand from
Camtasia's app-support dir — list them with `camkit captions --list-presets`,
including any custom presets you've saved. Classic (non-animated) captions
aren't supported; they can't do the per-word highlight, and you can promote a
Dynamic track's styling further in Camtasia's UI.
