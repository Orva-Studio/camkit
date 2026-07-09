# Transcription engines

`camkit transcribe` resolves an engine by precedence (highest wins): an
explicit `--engine openai|replicate|whisper-cpp` flag, then environment, then
the `auto` default. `auto` picks:

1. **`OPENAI_API_KEY` set → OpenAI `whisper-1`** (best quality). Note: this is
   pinned to `whisper-1`, not a "newer" model — the `gpt-4o-transcribe` models
   don't return the word-level timestamps the rebuild step needs.
2. **Else `REPLICATE_API_TOKEN` set → Replicate** hosted
   `vaibhavs10/incredibly-fast-whisper` (word-level timestamps). Beats local
   whisper-cpp whenever the token is present — use `--engine whisper-cpp` to
   force local. Model version is pinned in code; refresh via Replicate's
   `/v1/models/.../versions` API if predictions start failing.
3. **Else `whisper-cli` on PATH → local whisper.cpp.** By default it reuses the
   `ggml` model Camtasia downloads to
   `Camtasia.app/Contents/Resources/models/speechToText/` (tiny/quantized —
   fast, lower fidelity). Override with `CAMKIT_WHISPER_MODEL` (path to a
   larger `ggml-*.bin`) or `CAMKIT_WHISPER_BIN`.
4. **None → an error** telling you to set `OPENAI_API_KEY` or
   `REPLICATE_API_TOKEN`, or run `brew install whisper-cpp`. camkit never
   auto-installs (no silent `brew`).

camkit reuses Camtasia's *model file* but not its bundled `libwhisper.dylib`
(private, code-signed, undocumented ABI) — you bring your own `whisper-cli`
runner. The tiny local model has coarser word timestamps, so cross-checking
with `camkit silences` matters even more on the local path.
