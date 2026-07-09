import { expect, test } from "bun:test";
import { shapeReplicateOutput, shapeWhisperCpp } from "../src/media.ts";

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

test("shapeReplicateOutput maps chunks to words and groups segments on gaps", () => {
  const out = shapeReplicateOutput({
    text: "hello world goodbye",
    chunks: [
      { text: " hello", timestamp: [0, 0.4] },
      { text: " world", timestamp: [0.5, 0.9] },
      // >1.2s gap → new segment
      { text: " goodbye", timestamp: [2.5, 3.0] },
      { text: "   ", timestamp: [3.0, 3.1] }, // empty after trim → dropped
    ],
  });

  expect(out.words).toEqual([
    { word: "hello", start: 0, end: 0.4 },
    { word: "world", start: 0.5, end: 0.9 },
    { word: "goodbye", start: 2.5, end: 3.0 },
  ]);
  expect(out.segments).toEqual([
    { id: 0, start: 0, end: 0.9, text: "hello world" },
    { id: 1, start: 2.5, end: 3.0, text: "goodbye" },
  ]);
  expect(out.duration).toBe(3.0);
  expect(out.text).toBe("hello world goodbye");
});

test("shapeReplicateOutput fills null end times from the next chunk", () => {
  const out = shapeReplicateOutput({
    chunks: [
      { text: "a", timestamp: [0, null] },
      { text: "b", timestamp: [0.5, 1.0] },
    ],
  });
  expect(out.words).toEqual([
    { word: "a", start: 0, end: 0.5 },
    { word: "b", start: 0.5, end: 1.0 },
  ]);
  expect(out.duration).toBe(1.0);
});

test("shapeReplicateOutput tolerates empty output", () => {
  expect(shapeReplicateOutput({})).toEqual({ duration: null, text: "", words: [], segments: [] });
});
