import { expect, test } from "bun:test";
import { shapeWhisperCpp } from "../src/media.ts";

// A trimmed whisper.cpp `--output-json-full` payload: one segment, tokens whose
// offsets are in milliseconds. Tokens starting a new word carry a leading space;
// control tokens ([_BEG_], <|...|>) must be dropped.
const fixture = {
  transcription: [
    {
      offsets: { from: 0, to: 1500 },
      text: " Hello world",
      tokens: [
        { text: "[_BEG_]", offsets: { from: 0, to: 0 } },
        { text: " Hello", offsets: { from: 0, to: 600 } },
        { text: " wor", offsets: { from: 600, to: 1100 } },
        { text: "ld", offsets: { from: 1100, to: 1500 } },
        { text: "<|endoftext|>", offsets: { from: 1500, to: 1500 } },
      ],
    },
  ],
};

test("shapeWhisperCpp stitches sub-word tokens, drops control tokens, ms→s", () => {
  const out = shapeWhisperCpp(fixture);

  // Segments mirror whisper.cpp segments with ms offsets converted to seconds.
  expect(out.segments).toEqual([{ id: 0, start: 0, end: 1.5, text: " Hello world" }]);

  // "wor" + "ld" merge into one word spanning both token offsets; control
  // tokens are skipped; each word keeps its leading-space boundary.
  expect(out.words).toEqual([
    { word: " Hello", start: 0, end: 0.6 },
    { word: " world", start: 0.6, end: 1.5 },
  ]);

  // duration is the last segment's end; text is the trimmed concatenation.
  expect(out.duration).toBe(1.5);
  expect(out.text).toBe("Hello world");
});

test("shapeWhisperCpp tolerates an empty payload", () => {
  const out = shapeWhisperCpp({});
  expect(out).toEqual({ duration: null, text: "", words: [], segments: [] });
});
