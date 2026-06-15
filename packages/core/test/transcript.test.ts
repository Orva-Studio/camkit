import { expect, test } from "bun:test";
import { shapeTranscript, toSrt, type Transcript } from "../src/transcript.ts";

test("shapeTranscript keeps the stable contract and tolerates missing fields", () => {
  const raw = {
    duration: 3.5,
    text: "hello world",
    words: [{ word: "hello", start: 0, end: 0.5 }],
    segments: [{ id: 0, start: 0, end: 1, text: "hello world" }],
  };
  const t = shapeTranscript(raw, "take.trec", "whisper-1");
  expect(t.source).toBe("take.trec");
  expect(t.model).toBe("whisper-1");
  expect(t.words).toEqual([{ word: "hello", start: 0, end: 0.5 }]);

  const empty = shapeTranscript({}, "x", "m");
  expect(empty.duration).toBeNull();
  expect(empty.words).toEqual([]);
});

test("toSrt renders 1-based, comma-millisecond, blank-line-separated cues", () => {
  const t: Transcript = {
    source: "x",
    model: "m",
    duration: null,
    text: "",
    words: [],
    segments: [
      { id: 0, start: 0, end: 1.5, text: "  Hello there  " },
      { id: 1, start: 1.5, end: 3661.25, text: "world" },
    ],
  };
  expect(toSrt(t)).toBe(
    "1\n00:00:00,000 --> 00:00:01,500\nHello there\n" +
      "\n" +
      "2\n00:00:01,500 --> 01:01:01,250\nworld\n" +
      "\n",
  );
});
